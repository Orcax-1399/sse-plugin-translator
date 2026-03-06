/**
 * AI翻译主逻辑模块
 * 实现session循环和批量翻译功能
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ApiConfig } from "../stores/apiConfigStore";
import type { SessionState, TranslationMemoryEntry } from "./aiPrompts";
import { buildMessages } from "./aiPrompts";
import { toolDefinitions, preprocessBatch } from "./aiTools";
import {
  estimateContextUsage,
  type ContextUsageStats,
} from "./ai/contextUsage";
import { requestToolCallCompletion } from "./ai/providers/providerAdapter";
import { formatAiResponse } from "./ai/responseFormat";
import {
  computeSearchBudget,
  pushHistory,
} from "./ai/sessionHelpers";
import { processToolCalls } from "./ai/toolCallProcessor";

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
  contextUsedTokens?: number;
  contextTotalTokens?: number;
  contextUsedPercent?: number;
}

/**
 * 取消令牌接口
 */
export interface CancellationToken {
  cancel: () => void;
  isCancelled: () => boolean;
  onCancel: (listener: () => void) => () => void;
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
  initialTranslationMemory?: TranslationMemoryEntry[],
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
    contextUsage?: ContextUsageStats,
  ) => {
    onStatusChange?.({
      id: `status-${Date.now()}-${statusIdCounter++}`,
      type,
      message,
      timestamp: Date.now(),
      isHeartbeat,
      contextUsedTokens: contextUsage?.usedTokens,
      contextTotalTokens: contextUsage?.totalTokens,
      contextUsedPercent: contextUsage?.usedPercent,
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
      searchCache: {},
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
      history: [],
      translationMemory: Array.isArray(initialTranslationMemory)
        ? initialTranslationMemory.slice(0, 120)
        : [],
      longTextWorkspaces: {},
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
      const contextUsage = estimateContextUsage(
        messages as ChatCompletionMessageParam[],
        apiConfig,
      );

      // 4.2 调用AI
      console.log(`[AI翻译] 调用AI，剩余 ${sessionState.csv.length} 条待翻译`);
      console.log(
        "[AI翻译] 发送的messages:",
        JSON.stringify(messages, null, 2).slice(0, 1000) + "...",
      );
      let message: OpenAI.Chat.Completions.ChatCompletionMessage | null = null;
      let finishReason: string | null = null;
      let usedStreaming = false;
      const abortController = new AbortController();
      let unregisterCancel: (() => void) | undefined;
      if (cancellationToken) {
        unregisterCancel = cancellationToken.onCancel(() => {
          if (!abortController.signal.aborted) {
            abortController.abort();
          }
        });
      }
      try {
        const response = await requestToolCallCompletion(
          client,
          apiConfig,
          {
            model: apiConfig.modelName,
            messages: messages as ChatCompletionMessageParam[],
            tools: [
              toolDefinitions.search,
              toolDefinitions.workOnLongText,
              toolDefinitions.applyTranslations,
              toolDefinitions.skip,
            ],
            tool_choice: "required",
            temperature: 0.1,
            max_tokens: apiConfig.maxTokens,
          },
          abortController.signal,
          emitStatus,
          contextUsage,
        );
        message = response.message;
        finishReason = response.finishReason;
        usedStreaming = response.usedStreaming;
        unregisterCancel?.();
      } catch (error: any) {
        unregisterCancel?.();
        if (abortController.signal.aborted || cancellationToken?.isCancelled()) {
          console.warn("[AI翻译] 请求已取消");
          return {
            success: false,
            translatedCount: totalCount - sessionState.csv.length,
            error: "用户取消翻译",
          };
        }
        console.error("[AI翻译] API调用失败:", error);
        emitStatus(
          "error",
          `AI API调用失败: ${error.message || String(error)}`,
        );
        throw new Error(`AI API调用失败: ${error.message || String(error)}`);
      }

      if (!message) {
        throw new Error("AI返回空响应");
      }

      const aiResponsePreview = formatAiResponse(message);

      // 🔍 详细日志：AI返回的完整消息
      console.log("[AI翻译] AI返回消息:", {
        role: message.role,
        content: message.content,
        tool_calls: message.tool_calls,
        finish_reason: finishReason,
        stream: usedStreaming,
      });

      // 4.3 处理工具调用
      const toolCalls = message.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        // AI没有输出工具调用，这是不允许的，重发
        console.warn("[AI翻译] AI未输出工具调用，重新发送");
        console.warn("[AI翻译] AI返回的content:", message.content);
        console.warn(
          "[AI翻译] finish_reason:",
          finishReason,
        );
        const trimmedPreview =
          aiResponsePreview.length > 120
            ? `${aiResponsePreview.slice(0, 117)}...`
            : aiResponsePreview || "(空响应)";
        emitStatus(
          "error",
          `AI返回无效结果（未调用任何工具），正在重试。内容: ${trimmedPreview}`,
        );
        pushHistory(sessionState, {
          role: "system",
          message:
            "你必须调用工具（search / work_on_long_text / apply_translations / skip），不能直接输出文本。",
          result: trimmedPreview,
        });
        continue;
      }

      const hasError = await processToolCalls({
        toolCalls,
        sessionState,
        entryMap,
        totalCount,
        aiResponsePreview,
        onApply,
        onProgress,
        emitStatus,
        pushHistory,
        expandIndices,
      });
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

export function createCancellationToken(): CancellationToken {
  let cancelled = false;
  const listeners = new Set<() => void>();
  return {
    cancel: () => {
      if (cancelled) {
        return;
      }
      cancelled = true;
      console.log("[AI翻译] 取消令牌已触发");
      listeners.forEach((listener) => {
        try {
          listener();
        } catch (error) {
          console.warn("取消回调执行失败:", error);
        }
      });
      listeners.clear();
    },
    isCancelled: () => cancelled,
    onCancel: (listener: () => void) => {
      if (cancelled) {
        // 已取消时立即执行，且返回空解绑函数
        try {
          listener();
        } catch (error) {
          console.warn("取消回调执行失败:", error);
        }
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
