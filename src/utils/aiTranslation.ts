/**
 * AI翻译主逻辑模块
 * 实现session循环和批量翻译功能
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ApiConfig } from "../stores/apiConfigStore";
import type { SessionState, SearchResult } from "./aiPrompts";
import { buildMessages } from "./aiPrompts";
import {
  toolDefinitions,
  executeSearch,
  executeApply,
  executeSkip,
  preprocessBatch,
  type SearchExecutionResult,
} from "./aiTools";

const MIN_SEARCH_BUDGET = 8;
const MAX_SEARCH_BUDGET = 30;

function computeSearchBudget(entries: Array<{ text: string }>) {
  if (!entries || entries.length === 0) {
    return MIN_SEARCH_BUDGET;
  }

  const totalCount = entries.length;
  const totalLength = entries.reduce(
    (sum, entry) => sum + (entry.text?.length ?? 0),
    0,
  );

  // 约每4条分配1次预算，长文本按每600字符补贴一次
  const entryFactor = Math.ceil(totalCount / 4);
  const lengthFactor = Math.ceil(totalLength / 600);
  const rough = entryFactor + lengthFactor;

  return Math.min(MAX_SEARCH_BUDGET, Math.max(MIN_SEARCH_BUDGET, rough));
}

/**
 * 翻译条目（输入）
 */
export interface TranslationEntry {
  /** 批处理索引（用于内部映射） */
  index: number;
  /** ESP记录索引 */
  recordIndex: number;
  /** Form ID */
  formId: string;
  /** Record Type */
  recordType: string;
  /** Subrecord Type */
  subrecordType: string;
  /** 原文 */
  originalText: string;
}

/**
 * 翻译结果
 */
export interface TranslationResult {
  success: boolean;
  translatedCount: number;
  error?: string;
}

/**
 * 进度回调类型
 */
export type ProgressCallback = (completed: number, total: number) => void;

/**
 * Apply回调类型（用于更新UI）
 */
export type ApplyCallback = (
  index: number,
  recordIndex: number,
  formId: string,
  recordType: string,
  subrecordType: string,
  translated: string,
) => void;

/**
 * AI状态更新
 */
export type AiStatusType = "info" | "success" | "error";

export interface AiStatusUpdate {
  id: string;
  type: AiStatusType;
  message: string;
  timestamp: number;
  isHeartbeat?: boolean;
}

/**
 * 取消令牌接口
 */
export interface CancellationToken {
  cancel: () => void;
  isCancelled: () => boolean;
}

/**
 * 批量AI翻译主函数
 * @param entries 待翻译条目列表
 * @param apiConfig API配置
 * @param onProgress 进度回调
 * @param onApply Apply回调（更新UI）
 * @param cancellationToken 取消令牌（可选）
 * @param onStatusChange 状态更新回调
 * @returns 翻译结果
 */
export async function translateBatchWithAI(
  entries: TranslationEntry[],
  apiConfig: ApiConfig,
  onProgress: ProgressCallback,
  onApply: ApplyCallback,
  cancellationToken?: CancellationToken,
  onStatusChange?: (status: AiStatusUpdate) => void,
  onIterationChange?: (iteration: number) => void,
  initialSearchCache?: Record<string, SearchResult>,
): Promise<TranslationResult> {
  if (entries.length === 0) {
    return { success: true, translatedCount: 0 };
  }

  // 创建OpenAI客户端
  const client = new OpenAI({
    apiKey: apiConfig.apiKey,
    baseURL: apiConfig.endpoint,
    maxRetries: 3,
    timeout: 60000, // 60秒超时
    dangerouslyAllowBrowser: true, // Tauri是桌面应用，API密钥存储在本地，相对安全
  });

  // 初始化Session状态（在try外面声明，以便catch块访问）
  let sessionState: SessionState | null = null;
  let statusIdCounter = 0;
  const emitStatus = (
    type: AiStatusType,
    message: string,
    isHeartbeat = false,
  ) => {
    onStatusChange?.({
      id: `status-${Date.now()}-${statusIdCounter++}`,
      type,
      message,
      timestamp: Date.now(),
      isHeartbeat,
    });
  };

  try {
    // 1. 术语预处理（批量调用replace_with_atoms）
    console.log("[AI翻译] 开始术语预处理...");
    const preprocessed = await preprocessBatch(
      entries.map((e) => ({ index: e.index, text: e.originalText })),
    );

    // 2. 初始化Session状态
    const totalCount = entries.length;
    const searchBudget = computeSearchBudget(preprocessed);
    sessionState = {
      csv: preprocessed,
      searchCache: initialSearchCache ? { ...initialSearchCache } : {},
      totalCount,
      completedCount: 0,
      searchMeta: {
        lastTerms: [],
        executedTerms: [],
        cacheHits: [],
        deferredTerms: [],
        budgetUsed: 0,
        budgetTotal: searchBudget,
      },
      recentApply: undefined,
    };

    // 3. 创建entry映射（用于apply_translations时查找完整信息）
    const entryMap = new Map<number, TranslationEntry>();
    entries.forEach((entry) => {
      entryMap.set(entry.index, entry);
    });

    // 4. 构建原文到索引的映射（用于自动扩散重复原文）
    const originalTextIndexMap = new Map<string, Set<number>>();
    entries.forEach((entry) => {
      const key = entry.originalText; // 使用原始原文作为 key
      if (!originalTextIndexMap.has(key)) {
        originalTextIndexMap.set(key, new Set());
      }
      originalTextIndexMap.get(key)!.add(entry.index);
    });

    // 5. 创建扩散 resolver：给定 index，返回所有仍在 csv 中且原文相同的其他 index
    const expandIndices = (index: number): number[] => {
      const entry = entryMap.get(index);
      if (!entry) return [];

      const sameTextIndices = originalTextIndexMap.get(entry.originalText);
      if (!sameTextIndices) return [];

      // 过滤：只返回仍在 csv 中的索引（排除已翻译的）
      const currentIndices = new Set(sessionState!.csv.map((row) => row.index));
      return Array.from(sameTextIndices).filter(
        (idx) => idx !== index && currentIndices.has(idx),
      );
    };

    let maxIterations = 50; // 最大迭代次数，防止死循环
    let currentIteration = 0;

    // 6. Session循环
    console.log(`[AI翻译] 开始翻译，共 ${totalCount} 条`);
    while (sessionState.csv.length > 0 && maxIterations > 0) {
      // 更新迭代计数
      currentIteration++;
      onIterationChange?.(currentIteration);

      // 检查是否被取消
      if (cancellationToken?.isCancelled()) {
        console.log("[AI翻译] 用户取消翻译");
        emitStatus("info", "已收到取消请求，正在停止翻译");
        return {
          success: false,
          translatedCount: totalCount - sessionState.csv.length,
          error: "用户取消翻译",
        };
      }

      maxIterations--;

      // 4.1 构造消息
      const messages = buildMessages(sessionState);

      // 4.2 调用AI
      console.log(`[AI翻译] 调用AI，剩余 ${sessionState.csv.length} 条待翻译`);
      console.log(
        "[AI翻译] 发送的messages:",
        JSON.stringify(messages, null, 2).slice(0, 1000) + "...",
      );
      let completion: OpenAI.Chat.Completions.ChatCompletion;
      try {
        completion = await client.chat.completions.create({
          model: apiConfig.modelName,
          messages: messages as ChatCompletionMessageParam[],
          tools: [
            toolDefinitions.search,
            toolDefinitions.applyTranslations,
            toolDefinitions.skip,
          ],
          tool_choice: "required",
          temperature: 0.1,
          max_tokens: apiConfig.maxTokens,
        });
      } catch (error: any) {
        console.error("[AI翻译] API调用失败:", error);
        emitStatus(
          "error",
          `AI API调用失败: ${error.message || String(error)}`,
        );
        throw new Error(`AI API调用失败: ${error.message || String(error)}`);
      }

      const message = completion.choices[0]?.message;
      if (!message) {
        throw new Error("AI返回空响应");
      }

      const aiResponsePreview = formatAiResponse(message);

      // 🔍 详细日志：AI返回的完整消息
      console.log("[AI翻译] AI返回消息:", {
        role: message.role,
        content: message.content,
        tool_calls: message.tool_calls,
        finish_reason: completion.choices[0]?.finish_reason,
      });

      // 4.3 处理工具调用
      const toolCalls = message.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        // AI没有输出工具调用，这是不允许的，重发
        console.warn("[AI翻译] AI未输出工具调用，重新发送");
        console.warn("[AI翻译] AI返回的content:", message.content);
        console.warn(
          "[AI翻译] finish_reason:",
          completion.choices[0]?.finish_reason,
        );
        const trimmedPreview =
          aiResponsePreview.length > 120
            ? `${aiResponsePreview.slice(0, 117)}...`
            : aiResponsePreview || "(空响应)";
        emitStatus(
          "error",
          `AI返回无效结果（未调用任何工具），正在重试。内容: ${trimmedPreview}`,
        );
        sessionState.lastError = {
          tool: "system",
          args: {},
          error:
            "你必须调用工具（search / apply_translations / skip），不能直接输出文本。",
          aiResponse: aiResponsePreview,
        };
        continue;
      }

      // 清除上次错误（如果有）
      delete sessionState.lastError;

      // 4.4 执行工具调用
      let hasError = false;
      for (const toolCall of toolCalls) {
        if (toolCall.type !== "function") continue;

        const toolName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);

        console.log(`[AI翻译] 执行工具: ${toolName}`, args);

        if (toolName === "search") {
          try {
            const requestedTerms: string[] = Array.isArray(args.terms)
              ? args.terms
              : [];
            const normalizedTerms = Array.from(
              new Set(
                requestedTerms
                  .map((term: string) =>
                    typeof term === "string" ? term.trim() : "",
                  )
                  .filter((term: string) => term.length > 0),
              ),
            );

            emitStatus(
              "info",
              `AI正在搜索术语，共 ${normalizedTerms.length} 个`,
            );

            if (normalizedTerms.length === 0) {
              sessionState.searchMeta = {
                ...sessionState.searchMeta,
                lastTerms: [],
                executedTerms: [],
                cacheHits: [],
                deferredTerms: [],
              };
              sessionState.lastError = {
                tool: "search",
                args,
                error: "search参数为空，无法执行查询",
                aiResponse: aiResponsePreview,
              };
              hasError = true;
              break;
            }

            const cache = sessionState.searchCache || {};
            const cacheHits = normalizedTerms.filter(
              (term) => cache[term] && cache[term].status === "ok",
            );
            const missingTerms = normalizedTerms.filter(
              (term) => !(cache[term] && cache[term].status === "ok"),
            );
            const budgetTotal =
              sessionState.searchMeta?.budgetTotal ??
              computeSearchBudget(sessionState.csv);
            const budgetUsed = sessionState.searchMeta?.budgetUsed ?? 0;
            const availableBudget = Math.max(0, budgetTotal - budgetUsed);

            const termsToQuery =
              missingTerms.length > 0 && availableBudget > 0
                ? missingTerms.slice(0, availableBudget)
                : [];
            const deferredTerms =
              missingTerms.length > termsToQuery.length
                ? missingTerms.slice(termsToQuery.length)
                : [];

            if (missingTerms.length > 0 && availableBudget === 0) {
              sessionState.searchMeta = {
                lastTerms: normalizedTerms,
                executedTerms: [],
                cacheHits,
                deferredTerms: missingTerms,
                budgetUsed,
                budgetTotal,
              };
              sessionState.lastError = {
                tool: "search",
                args,
                error: "search预算已耗尽，请使用已有信息继续翻译。",
                aiResponse: aiResponsePreview,
              };
              emitStatus("error", "search预算已耗尽，请复用现有缓存并继续翻译");
              hasError = true;
              break;
            }

            const execution: SearchExecutionResult =
              termsToQuery.length > 0
                ? await executeSearch(termsToQuery, { cache })
                : { results: {}, queriedTerms: [], cacheHits: [] };

            sessionState.searchCache = {
              ...sessionState.searchCache,
              ...execution.results,
            };

            sessionState.searchMeta = {
              lastTerms: normalizedTerms,
              executedTerms: execution.queriedTerms,
              cacheHits: Array.from(
                new Set([...cacheHits, ...execution.cacheHits]),
              ),
              deferredTerms,
              budgetUsed: Math.min(
                budgetTotal,
                budgetUsed + execution.queriedTerms.length,
              ),
              budgetTotal,
            };

            console.log(
              `[AI翻译] search完成，查询了 ${execution.queriedTerms.length} 个术语，缓存命中 ${cacheHits.length} 个`,
            );
          } catch (error: any) {
            console.error("[AI翻译] search执行失败:", error);
            emitStatus(
              "error",
              `search执行失败: ${error.message || String(error)}`,
            );
            sessionState.lastError = {
              tool: "search",
              args,
              error: error.message || String(error),
              aiResponse: aiResponsePreview,
            };
            hasError = true;
            break;
          }
        } else if (toolName === "apply_translations") {
          // 执行apply_translations
          // ⚠️ 有时AI会返回双重JSON编码的字符串，需要检查并解析
          let translations = args.translations;
          if (typeof translations === "string") {
            console.warn(
              "[AI翻译] translations是字符串，尝试解析:",
              translations.slice(0, 100),
            );
            try {
              translations = JSON.parse(translations);
            } catch (e) {
              console.error("[AI翻译] 解析translations失败:", e);
              sessionState.lastError = {
                tool: "apply_translations",
                args,
                error: `translations格式错误: ${String(e)}`,
                aiResponse: aiResponsePreview,
              };
              hasError = true;
              break;
            }
          }

          const translationItems = Array.isArray(translations)
            ? (translations as Array<{ index: number; translated: string }>)
            : [];

          const applyResult = executeApply(
            translationItems,
            sessionState,
            (index, translated) => {
              // 调用回调更新UI
              const entry = entryMap.get(index);
              if (entry) {
                onApply(
                  index,
                  entry.recordIndex,
                  entry.formId,
                  entry.recordType,
                  entry.subrecordType,
                  translated,
                );
              }
            },
            expandIndices, // 传入扩散 resolver
          );

          if (!applyResult.success) {
            console.error(
              "[AI翻译] apply_translations执行失败:",
              applyResult.error,
            );
            emitStatus(
              "error",
              `apply_translations执行失败: ${applyResult.error || "未知错误"}`,
            );
            sessionState.lastError = {
              tool: "apply_translations",
              args,
              error: applyResult.error || "未知错误",
              aiResponse: aiResponsePreview,
            };
            hasError = true;
            break;
          }

          // 日志：包含扩散信息
          const directCount = translationItems.length;
          const expandedCount = applyResult.expandedCount ?? 0;
          console.log(
            `[AI翻译] apply_translations完成，AI提交 ${directCount} 条${expandedCount > 0 ? `，自动扩散 ${expandedCount} 条` : ""}`,
          );
          // 状态回调：通知用户扩散信息
          if (expandedCount > 0) {
            emitStatus(
              "info",
              `AI提交 ${directCount} 条，自动扩散 ${expandedCount} 条重复原文`,
            );
          }
          // 更新进度与最近一次apply概览
          const completed = totalCount - sessionState.csv.length;
          sessionState.completedCount = completed;
          const appliedIndices = applyResult.appliedIndices ?? [];
          sessionState.recentApply = {
            indices: appliedIndices.slice(-5),
            preview: appliedIndices
              .slice(-3)
              .map((idx) => {
                const match = translationItems.find(
                  (item) => item.index === idx,
                );
                return {
                  index: idx,
                  translated: match ? match.translated : "",
                };
              })
              .filter((item) => item.translated.length > 0),
            timestamp: Date.now(),
          };
          sessionState.searchMeta = {
            ...sessionState.searchMeta,
            deferredTerms: [],
            budgetUsed: 0,
            budgetTotal: computeSearchBudget(sessionState.csv),
          };

          onProgress(completed, totalCount);
        } else if (toolName === "skip") {
          let entries = args.entries;
          if (typeof entries === "string") {
            try {
              entries = JSON.parse(entries);
            } catch (error) {
              sessionState.lastError = {
                tool: "skip",
                args,
                error: `entries格式错误: ${String(error)}`,
                aiResponse: aiResponsePreview,
              };
              hasError = true;
              break;
            }
          }

          const skipItems = Array.isArray(entries)
            ? (entries as Array<{ index: number; reason?: string }>)
            : [];

          const normalized = skipItems
            .map((item) => ({
              index:
                typeof item.index === "number"
                  ? item.index
                  : Number(item.index),
              reason:
                typeof item.reason === "string"
                  ? item.reason.trim().slice(0, 200)
                  : undefined,
            }))
            .filter((item) => Number.isFinite(item.index));

          if (normalized.length === 0) {
            sessionState.lastError = {
              tool: "skip",
              args,
              error: "entries不能为空，且必须包含有效的index",
              aiResponse: aiResponsePreview,
            };
            hasError = true;
            break;
          }

          const skipResult = executeSkip(normalized, sessionState);
          if (!skipResult.success) {
            console.error(
              "[AI翻译] skip执行失败:",
              skipResult.error || "未知错误",
            );
            emitStatus(
              "error",
              `skip执行失败: ${skipResult.error || "未知错误"}`,
            );
            sessionState.lastError = {
              tool: "skip",
              args,
              error: skipResult.error || "未知错误",
              aiResponse: aiResponsePreview,
            };
            hasError = true;
            break;
          }

          const skippedEntries = skipResult.skippedEntries ?? [];
          const completed = totalCount - sessionState.csv.length;
          sessionState.completedCount = completed;
          sessionState.recentSkip = {
            indices: skippedEntries.map((entry) => entry.index).slice(-5),
            preview: skippedEntries.slice(-3),
            timestamp: Date.now(),
          };

          console.log(
            `[AI翻译] skip完成，跳过了 ${skippedEntries.length} 条无需翻译的记录`,
          );
          emitStatus(
            "info",
            `AI跳过 ${skippedEntries.length} 条无需翻译的记录`,
          );
          onProgress(completed, totalCount);
        } else {
          console.warn(`[AI翻译] 收到未知工具: ${toolName}`);
          sessionState.lastError = {
            tool: toolName || "unknown",
            args,
            error: "不支持的工具调用",
            aiResponse: aiResponsePreview,
          };
          hasError = true;
          break;
        }
      }

      // 如果有错误，继续下一轮循环（让AI看到错误信息）
      if (hasError) {
        continue;
      }
    }

    // 5. 检查是否完成
    if (sessionState.csv.length > 0) {
      console.warn(
        `[AI翻译] Session未完成，剩余 ${sessionState.csv.length} 条`,
      );
      if (maxIterations === 0) {
        emitStatus(
          "error",
          `翻译未完成：达到最大迭代次数，剩余 ${sessionState.csv.length} 条待翻译`,
        );
        throw new Error(
          `翻译未完成：达到最大迭代次数，剩余 ${sessionState.csv.length} 条待翻译`,
        );
      }
    }

    console.log("[AI翻译] 翻译完成！");
    return {
      success: true,
      translatedCount: totalCount - sessionState.csv.length,
    };
  } catch (error: any) {
    console.error("[AI翻译] 翻译失败:", error);
    emitStatus("error", error.message || String(error));
    return {
      success: false,
      translatedCount: entries.length - (sessionState?.csv?.length || 0),
      error: error.message || String(error),
    };
  }
}

/**
 * 创建一个取消令牌
 */
export function createCancellationToken(): CancellationToken {
  let cancelled = false;
  return {
    cancel: () => {
      cancelled = true;
      console.log("[AI翻译] 取消令牌已触发");
    },
    isCancelled: () => cancelled,
  };
}

function formatAiResponse(
  message: OpenAI.Chat.Completions.ChatCompletionMessage,
): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return (content as Array<string | { text?: string; content?: string }>)
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object") {
          if ("text" in part && typeof part.text === "string") {
            return part.text;
          }
          if ("content" in part && typeof (part as any).content === "string") {
            return (part as any).content;
          }
        }
        return "";
      })
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  return "";
}
