import type OpenAI from "openai";
import type { AiHistoryEntry, SessionState } from "../aiPrompts";
import {
  executeSearch,
  executeApply,
  executeSkip,
  normalizeTermKey,
  type SearchExecutionResult,
} from "../aiTools";
import {
  computeSearchBudget,
  upsertTranslationMemoryEntries,
} from "./sessionHelpers";

type AiStatusType = "info" | "success" | "error";

type TranslationEntryContext = {
  recordIndex: number;
  formId: string;
  recordType: string;
  subrecordType: string;
  originalText: string;
};

type PushHistory = (
  state: SessionState,
  entry: Omit<AiHistoryEntry, "timestamp">,
) => void;

type EmitStatus = (
  type: AiStatusType,
  message: string,
  isHeartbeat?: boolean,
) => void;

type ApplyCallback = (
  index: number,
  recordIndex: number,
  formId: string,
  recordType: string,
  subrecordType: string,
  translated: string,
) => void;

type ProgressCallback = (completed: number, total: number) => void;

export interface ProcessToolCallsParams {
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  sessionState: SessionState;
  entryMap: Map<number, TranslationEntryContext>;
  totalCount: number;
  aiResponsePreview: string;
  onApply: ApplyCallback;
  onProgress: ProgressCallback;
  emitStatus: EmitStatus;
  pushHistory: PushHistory;
  expandIndices: (index: number) => number[];
}

export async function processToolCalls(
  params: ProcessToolCallsParams,
): Promise<boolean> {
  const {
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
  } = params;

  let hasError = false;

  for (const toolCall of toolCalls) {
    if (toolCall.type !== "function") continue;

    const toolName = toolCall.function.name;
    let args: Record<string, any> = {};
    try {
      args = toolCall.function.arguments
        ? JSON.parse(toolCall.function.arguments)
        : {};
    } catch (error) {
      pushHistory(sessionState, {
        role: "tool",
        tool: toolName || "unknown",
        message: "工具参数不是有效JSON，已忽略本次调用",
        result: String(error),
      });
      hasError = true;
      continue;
    }

    console.log(`[AI翻译] 执行工具: ${toolName}`, args);

    if (toolName === "search") {
      try {
        const requestedTerms: string[] = Array.isArray(args.terms) ? args.terms : [];
        const normalizedTerms = Array.from(
          new Set(
            requestedTerms
              .map((term: string) =>
                typeof term === "string" ? normalizeTermKey(term) : "",
              )
              .filter((term: string) => term.length > 0),
          ),
        );

        emitStatus("info", `AI正在搜索术语，共 ${normalizedTerms.length} 个`);

        if (normalizedTerms.length === 0) {
          sessionState.searchMeta = {
            ...sessionState.searchMeta,
            lastTerms: [],
            executedTerms: [],
            cacheHits: [],
            deferredTerms: [],
          };
          pushHistory(sessionState, {
            role: "tool",
            tool: "search",
            message: "search参数为空，无法执行查询",
            result: aiResponsePreview,
          });
          continue;
        }

        const cache = sessionState.searchCache || {};
        const cacheHits = normalizedTerms.filter(
          (term) => cache[term] && cache[term].status === "ok",
        );
        const missingTerms = normalizedTerms.filter(
          (term) => !(cache[term] && cache[term].status === "ok"),
        );
        const budgetTotal =
          sessionState.searchMeta?.budgetTotal ?? computeSearchBudget(sessionState.csv);
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
          emitStatus("info", "search预算已耗尽，请先应用已有翻译后再继续查询");
          pushHistory(sessionState, {
            role: "system",
            message:
              "search预算已耗尽，请停止search并使用apply_translations（或skip）完成一部分翻译(利用现有信息可以翻译的部分)，即可获得更多预算。",
            result: `剩余术语 ${normalizedTerms.length} 个`,
          });
          continue;
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
          cacheHits: Array.from(new Set([...cacheHits, ...execution.cacheHits])),
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
        pushHistory(sessionState, {
          role: "tool",
          tool: "search",
          message: `执行 ${execution.queriedTerms.length} 个术语（缓存命中 ${cacheHits.length} 个）`,
        });
      } catch (error: any) {
        console.error("[AI翻译] search执行失败:", error);
        emitStatus("error", `search执行失败: ${error.message || String(error)}`);
        pushHistory(sessionState, {
          role: "tool",
          tool: "search",
          message: "search 执行失败",
          result: error.message || String(error),
        });
        hasError = true;
        break;
      }
    } else if (toolName === "apply_translations") {
      let translations = args.translations;
      if (typeof translations === "string") {
        console.warn(
          "[AI翻译] translations是字符串，尝试解析:",
          translations.slice(0, 100),
        );
        try {
          translations = JSON.parse(translations);
        } catch (error) {
          console.error("[AI翻译] 解析translations失败:", error);
          pushHistory(sessionState, {
            role: "tool",
            tool: "apply_translations",
            message: "translations格式错误",
            result: String(error),
          });
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
        expandIndices,
      );

      if (!applyResult.success) {
        console.error("[AI翻译] apply_translations执行失败:", applyResult.error);
        emitStatus(
          "error",
          `apply_translations执行失败: ${applyResult.error || "未知错误"}`,
        );
        pushHistory(sessionState, {
          role: "tool",
          tool: "apply_translations",
          message: "apply_translations执行失败",
          result: applyResult.error || "未知错误",
        });
        hasError = true;
        break;
      }

      const directCount = translationItems.length;
      const expandedCount = applyResult.expandedCount ?? 0;
      console.log(
        `[AI翻译] apply_translations完成，AI提交 ${directCount} 条${expandedCount > 0 ? `，自动扩散 ${expandedCount} 条` : ""}`,
      );
      if (expandedCount > 0) {
        emitStatus(
          "info",
          `AI提交 ${directCount} 条，自动扩散 ${expandedCount} 条重复原文`,
        );
      }

      const completed = totalCount - sessionState.csv.length;
      sessionState.completedCount = completed;
      const appliedIndices = applyResult.appliedIndices ?? [];
      sessionState.searchMeta = {
        ...sessionState.searchMeta,
        deferredTerms: [],
        budgetUsed: 0,
        budgetTotal: computeSearchBudget(sessionState.csv),
      };
      pushHistory(sessionState, {
        role: "tool",
        tool: "apply_translations",
        message: `提交 ${directCount} 条`,
        result:
          expandedCount > 0
            ? `扩散 ${expandedCount} 条`
            : `index: ${appliedIndices.slice(-3).join(", ")}`,
      });
      upsertTranslationMemoryEntries(sessionState, translationItems, entryMap);

      onProgress(completed, totalCount);
    } else if (toolName === "skip") {
      let entries = args.entries;
      if (typeof entries === "string") {
        try {
          entries = JSON.parse(entries);
        } catch (error) {
          pushHistory(sessionState, {
            role: "tool",
            tool: "skip",
            message: "entries格式错误",
            result: String(error),
          });
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
            typeof item.index === "number" ? item.index : Number(item.index),
          reason:
            typeof item.reason === "string"
              ? item.reason.trim().slice(0, 200)
              : undefined,
        }))
        .filter((item) => Number.isFinite(item.index));

      if (normalized.length === 0) {
        pushHistory(sessionState, {
          role: "tool",
          tool: "skip",
          message: "entries不能为空，且必须包含有效的index",
          result: aiResponsePreview,
        });
        hasError = true;
        break;
      }

      const skipResult = executeSkip(normalized, sessionState);
      if (!skipResult.success) {
        console.error("[AI翻译] skip执行失败:", skipResult.error || "未知错误");
        emitStatus("error", `skip执行失败: ${skipResult.error || "未知错误"}`);
        pushHistory(sessionState, {
          role: "tool",
          tool: "skip",
          message: "skip执行失败",
          result: skipResult.error || "未知错误",
        });
        hasError = true;
        break;
      }

      const skippedEntries = skipResult.skippedEntries ?? [];
      const completed = totalCount - sessionState.csv.length;
      sessionState.completedCount = completed;

      console.log(`[AI翻译] skip完成，跳过了 ${skippedEntries.length} 条无需翻译的记录`);
      emitStatus("info", `AI跳过 ${skippedEntries.length} 条无需翻译的记录`);
      pushHistory(sessionState, {
        role: "tool",
        tool: "skip",
        message: `跳过 ${skippedEntries.length} 条记录`,
      });
      onProgress(completed, totalCount);
    } else {
      console.warn(`[AI翻译] 收到未知工具: ${toolName}`);
      pushHistory(sessionState, {
        role: "system",
        tool: toolName || "unknown",
        message: "不支持的工具调用",
      });
      hasError = true;
      break;
    }
  }

  return hasError;
}
