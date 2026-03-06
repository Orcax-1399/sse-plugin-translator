import type OpenAI from "openai";
import type { AiHistoryEntry, SessionState } from "../aiPrompts";
import {
  assembleWorkspaceTranslation,
  buildLongTextPreview,
  createLongTextWorkspace,
  getCompletedSegmentCount,
  isLongTextCandidate,
  isWorkspaceComplete,
} from "../aiLongText";
import {
  executeApply,
  executeSearch,
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
          emitStatus("info", "search预算已耗尽，请先提交已有翻译后再继续查询");
          pushHistory(sessionState, {
            role: "system",
            message:
              "search预算已耗尽，请停止search并使用apply_translations、work_on_long_text.finalize（或skip）完成一部分翻译(利用现有信息可以翻译的部分)，即可获得更多预算。",
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
    } else if (toolName === "work_on_long_text") {
      const index = normalizeNumericIndex(args.index);
      const action = typeof args.action === "string" ? args.action.trim() : "";

      if (!Number.isFinite(index)) {
        pushHistory(sessionState, {
          role: "tool",
          tool: "work_on_long_text",
          message: "index必须是有效数字",
          result: aiResponsePreview,
        });
        hasError = true;
        break;
      }

      const row = sessionState.csv.find((item) => item.index === index);
      if (!row) {
        pushHistory(sessionState, {
          role: "tool",
          tool: "work_on_long_text",
          message: `index ${index} 不存在于当前CSV中`,
        });
        hasError = true;
        break;
      }

      if (!isLongTextCandidate(row.rawText)) {
        pushHistory(sessionState, {
          role: "tool",
          tool: "work_on_long_text",
          message: `index ${index} 不是长文本，无需创建工作区`,
        });
        hasError = true;
        break;
      }

      if (action === "start") {
        const existingWorkspace = sessionState.longTextWorkspaces[index];
        if (existingWorkspace) {
          emitStatus(
            "info",
            `长文本工作区已存在：index ${index}，${getCompletedSegmentCount(existingWorkspace)}/${existingWorkspace.segments.length}`,
          );
          pushHistory(sessionState, {
            role: "tool",
            tool: "work_on_long_text",
            message: `复用 index ${index} 的长文本工作区`,
            result: `${getCompletedSegmentCount(existingWorkspace)}/${existingWorkspace.segments.length}`,
          });
          continue;
        }

        const workspace = createLongTextWorkspace({
          index,
          rawText: row.rawText,
          sourceText: row.text,
        });
        sessionState.longTextWorkspaces[index] = workspace;

        emitStatus(
          "info",
          `已创建长文本工作区：index ${index}，共 ${workspace.segments.length} 段`,
        );
        pushHistory(sessionState, {
          role: "tool",
          tool: "work_on_long_text",
          message: `启动 index ${index} 的长文本工作区`,
          result: `${workspace.segments.length} 段`,
        });
      } else if (action === "save") {
        const workspace = sessionState.longTextWorkspaces[index];
        if (!workspace) {
          pushHistory(sessionState, {
            role: "tool",
            tool: "work_on_long_text",
            message: `index ${index} 尚未启动长文本工作区，请先调用 start`,
          });
          hasError = true;
          break;
        }

        let segments = args.segments;
        if (typeof segments === "string") {
          try {
            segments = JSON.parse(segments);
          } catch (error) {
            pushHistory(sessionState, {
              role: "tool",
              tool: "work_on_long_text",
              message: "segments格式错误",
              result: String(error),
            });
            hasError = true;
            break;
          }
        }

        const normalizedSegments = Array.isArray(segments)
          ? segments
              .map((segment) => ({
                segmentIndex: normalizeNumericIndex(segment?.segment_index),
                translated:
                  typeof segment?.translated === "string"
                    ? segment.translated
                    : "",
              }))
              .filter((segment) => Number.isFinite(segment.segmentIndex))
          : [];

        if (normalizedSegments.length === 0) {
          pushHistory(sessionState, {
            role: "tool",
            tool: "work_on_long_text",
            message: "save必须包含至少一个有效的segments项",
            result: aiResponsePreview,
          });
          hasError = true;
          break;
        }

        const invalidSegments = normalizedSegments.filter(
          (segment) =>
            segment.segmentIndex < 0 ||
            segment.segmentIndex >= workspace.segments.length,
        );
        if (invalidSegments.length > 0) {
          pushHistory(sessionState, {
            role: "tool",
            tool: "work_on_long_text",
            message: `存在无效segment_index: ${invalidSegments.map((segment) => segment.segmentIndex).join(", ")}`,
          });
          hasError = true;
          break;
        }

        normalizedSegments.forEach((segment) => {
          workspace.segments[segment.segmentIndex].translatedText = segment.translated;
        });
        workspace.updatedAt = Date.now();

        const completedSegments = getCompletedSegmentCount(workspace);
        const isComplete = isWorkspaceComplete(workspace);
        emitStatus(
          "info",
          isComplete
            ? `长文本 index ${index} 已完成全部片段，可调用 apply_translations 提交`
            : `已保存长文本 index ${index} 的 ${normalizedSegments.length} 个片段（${completedSegments}/${workspace.segments.length}）`,
        );
        pushHistory(sessionState, {
          role: "tool",
          tool: "work_on_long_text",
          message: `保存 index ${index} 的 ${normalizedSegments.length} 个片段草稿`,
          result: isComplete
            ? `已完成，预览: ${buildLongTextPreview(assembleWorkspaceTranslation(workspace), 120)}`
            : `${completedSegments}/${workspace.segments.length}`,
        });
      } else if (action === "finalize") {
        const workspace = sessionState.longTextWorkspaces[index];
        if (!workspace) {
          pushHistory(sessionState, {
            role: "tool",
            tool: "work_on_long_text",
            message: `index ${index} 尚未启动长文本工作区，请先调用 start`,
          });
          hasError = true;
          break;
        }

        if (!isWorkspaceComplete(workspace)) {
          const completedSegments = getCompletedSegmentCount(workspace);
          const errorMessage = `index ${index} 的长文本工作区尚未完成全部片段（${completedSegments}/${workspace.segments.length}），不能 finalize`;
          emitStatus("error", errorMessage);
          pushHistory(sessionState, {
            role: "tool",
            tool: "work_on_long_text",
            message: "finalize执行失败",
            result: errorMessage,
          });
          hasError = true;
          break;
        }

        const finalTranslation = assembleWorkspaceTranslation(workspace);
        const finalizeResult = executeApply(
          [{ index, translated: finalTranslation }],
          sessionState,
          (_applyIndex, translated) => {
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

        if (!finalizeResult.success) {
          const errorMessage = finalizeResult.error || "未知错误";
          emitStatus("error", `finalize执行失败: ${errorMessage}`);
          pushHistory(sessionState, {
            role: "tool",
            tool: "work_on_long_text",
            message: "finalize执行失败",
            result: errorMessage,
          });
          hasError = true;
          break;
        }

        const appliedIndices = finalizeResult.appliedIndices ?? [];
        const expandedCount = finalizeResult.expandedCount ?? 0;
        removeLongTextWorkspaces(sessionState, appliedIndices);

        const completed = totalCount - sessionState.csv.length;
        sessionState.completedCount = completed;
        sessionState.searchMeta = {
          ...sessionState.searchMeta,
          deferredTerms: [],
          budgetUsed: 0,
          budgetTotal: computeSearchBudget(sessionState.csv),
        };
        upsertTranslationMemoryEntries(
          sessionState,
          [{ index, translated: finalTranslation }],
          entryMap,
        );

        emitStatus(
          "info",
          expandedCount > 0
            ? `长文本 index ${index} finalize成功，并自动扩散 ${expandedCount} 条重复原文`
            : `长文本 index ${index} finalize成功，已自动提交`,
        );
        pushHistory(sessionState, {
          role: "tool",
          tool: "work_on_long_text",
          message: `finalize index ${index}`,
          result:
            expandedCount > 0
              ? `自动提交并扩散 ${expandedCount} 条`
              : `自动提交，预览: ${buildLongTextPreview(finalTranslation, 120)}`,
        });

        onProgress(completed, totalCount);
      } else {
        pushHistory(sessionState, {
          role: "tool",
          tool: "work_on_long_text",
          message: `不支持的action: ${action || "(空)"}`,
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

      const longTextError = validateLongTextApply(translationItems, sessionState);
      if (longTextError) {
        emitStatus("error", longTextError);
        pushHistory(sessionState, {
          role: "tool",
          tool: "apply_translations",
          message: "长文本条目尚未满足提交条件",
          result: longTextError,
        });
        hasError = true;
        break;
      }

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
      removeLongTextWorkspaces(sessionState, appliedIndices);
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
          index: normalizeNumericIndex(item.index),
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
      removeLongTextWorkspaces(
        sessionState,
        skippedEntries.map((entry) => entry.index),
      );
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

function normalizeNumericIndex(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

function validateLongTextApply(
  translationItems: Array<{ index: number; translated: string }>,
  sessionState: SessionState,
): string | null {
  for (const item of translationItems) {
    const row = sessionState.csv.find((entry) => entry.index === item.index);
    if (!row || !isLongTextCandidate(row.rawText)) {
      continue;
    }

    const workspace = sessionState.longTextWorkspaces[item.index];
    if (!workspace) {
      return `index ${item.index} 是长文本，必须先调用 work_on_long_text.start`;
    }

    return `index ${item.index} 是长文本，请改用 work_on_long_text.finalize 自动提交`;
  }

  return null;
}

function removeLongTextWorkspaces(
  sessionState: SessionState,
  indices: number[],
) {
  indices.forEach((index) => {
    delete sessionState.longTextWorkspaces[index];
  });
}
