/**
 * AI翻译工具实现模块
 * 实现search和apply_translations工具的具体逻辑
 */

import { invoke } from "@tauri-apps/api/core";
import type { SessionState, SearchResult } from "./aiPrompts";

/**
 * Search执行结果（包含缓存命中和实际查询的统计）
 */
export interface SearchExecutionResult {
  /** 查询结果（包含缓存命中和新查询） */
  results: Record<string, SearchResult>;
  /** 实际执行查询的术语列表 */
  queriedTerms: string[];
  /** 缓存命中的术语列表 */
  cacheHits: string[];
}

/**
 * 原子翻译类型（来自atomic_translations表）
 */
interface AtomTranslation {
  id: number;
  original: string;
  translated: string;
  usage_count: number;
  source: { Base?: null; AI?: null; Manual?: null };
}

/**
 * 参考翻译类型（来自query_word_translations）
 * 注意：字段名与Translation类型一致
 */
interface ReferenceTranslation {
  form_id: string;
  record_type: string;
  subrecord_type: string;
  editor_id: string | null;
  original_text: string; // ← 英文原文
  translated_text: string; // ← 中文译文
  plugin_name: string | null;
  created_at: number;
  updated_at: number;
}

const ATOM_CACHE_TTL_MS = 60_000;
let atomCache:
  | {
      expiresAt: number;
      map: Map<string, string>;
    }
  | null = null;

export function normalizeTermKey(term: string): string {
  return term.trim().toLowerCase();
}

async function getAtomMap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (atomCache && atomCache.expiresAt > now) {
    return atomCache.map;
  }

  const atoms = await invoke<AtomTranslation[]>("get_all_atoms");
  const map = new Map<string, string>();
  atoms.forEach((atom) => {
    map.set(normalizeTermKey(atom.original), atom.translated);
  });

  atomCache = {
    expiresAt: now + ATOM_CACHE_TTL_MS,
    map,
  };
  return map;
}

async function queryReferenceTranslations(
  term: string,
): Promise<ReferenceTranslation[]> {
  try {
    const refs = await invoke<ReferenceTranslation[]>("query_word_translations", {
      text: term,
      limit: 5,
    });
    return Array.isArray(refs) ? refs : [];
  } catch (error) {
    console.warn(`查询参考翻译失败 (${term}):`, error);
    return [];
  }
}

/**
 * 工具定义（OpenAI格式）
 */
export const toolDefinitions = {
  search: {
    type: "function" as const,
    function: {
      name: "search",
      description: "查询术语的翻译候选。用于查找专有名词、术语的标准译名。",
      parameters: {
        type: "object",
        properties: {
          terms: {
            type: "array",
            items: { type: "string" },
            description: "需要查询的术语列表（英文）",
          },
        },
        required: ["terms"],
      },
    },
  },
  applyTranslations: {
    type: "function" as const,
    function: {
      name: "apply_translations",
      description: "提交翻译结果。将已翻译的文本提交到系统。",
      parameters: {
        type: "object",
        properties: {
          translations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                index: {
                  type: "number",
                  description: "CSV行的index",
                },
                translated: {
                  type: "string",
                  description: "翻译后的中文文本",
                },
              },
              required: ["index", "translated"],
            },
            description: "翻译结果列表",
          },
        },
        required: ["translations"],
      },
    },
  },
  skip: {
    type: "function" as const,
    function: {
      name: "skip",
      description:
        "当某些条目无需翻译（如纯数字、纯符号或已是目标语言）时，调用此工具跳过它们。",
      parameters: {
        type: "object",
        properties: {
          entries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                index: {
                  type: "number",
                  description: "无需翻译的CSV行index",
                },
                reason: {
                  type: "string",
                  description:
                    "可选原因说明，用于记录为何跳过该条目（例如\"纯数字\"、\"已为中文\"等）",
                },
              },
              required: ["index"],
            },
            description: "需要跳过的条目列表",
          },
        },
        required: ["entries"],
      },
    },
  },
};

/**
 * 执行search工具
 * 查询术语翻译候选，合并原子库和参考翻译
 */
export async function executeSearch(
  terms: string[],
  options?: { cache?: Record<string, SearchResult> },
): Promise<SearchExecutionResult> {
  const results: Record<string, SearchResult> = {};
  const cache = options?.cache || {};
  const queriedTerms: string[] = [];
  const cacheHits: string[] = [];
  const normalizedTerms = Array.from(
    new Set(terms.map((term) => normalizeTermKey(term)).filter(Boolean)),
  );

  // ⚠️ 保证：即使查询失败，每个term也要有结果
  // 先初始化所有terms为not_found，后续找到了再覆盖
  normalizedTerms.forEach((term) => {
    results[term] = {
      status: "not_found",
      candidates: [],
    };
  });

  try {
    const atomMap = await getAtomMap();

    const uncachedTerms = normalizedTerms.filter(
      (term) => !(cache[term] && cache[term].status === "ok"),
    );
    queriedTerms.push(...uncachedTerms);

    const refsByTerm = new Map<string, ReferenceTranslation[]>();
    await Promise.all(
      uncachedTerms.map(async (term) => {
        refsByTerm.set(term, await queryReferenceTranslations(term));
      }),
    );

    for (const term of normalizedTerms) {
      if (cache[term] && cache[term].status === "ok") {
        results[term] = cache[term];
        cacheHits.push(term);
        continue;
      }

      const candidates: Array<{ en: string; zh: string; length: number }> = [];
      if (atomMap.has(term)) {
        candidates.push({
          en: term,
          zh: atomMap.get(term)!,
          length: term.length,
        });
      }

      const refs = refsByTerm.get(term) || [];
      refs.forEach((ref) => {
        if (!ref || !ref.original_text || !ref.translated_text) {
          return;
        }
        if (!candidates.some((c) => c.zh === ref.translated_text)) {
          candidates.push({
            en: ref.original_text,
            zh: ref.translated_text,
            length: ref.original_text.length,
          });
        }
      });

      if (candidates.length === 0) {
        results[term] = {
          status: "not_found",
          candidates: [],
        };
      } else {
        candidates.sort((a, b) => a.length - b.length);
        const top3 = candidates.slice(0, 3);
        results[term] = {
          status: "ok",
          candidates: top3.map((c) => ({ en: c.en, zh: c.zh })),
        };
      }
    }
  } catch (error) {
    console.error("executeSearch失败:", error);
    // ⚠️ 不抛出异常，返回已初始化的results（所有terms都是not_found）
    console.warn("⚠️ 查询过程出错，所有术语标记为not_found");
  }

  // 🔍 日志：显示查询结果摘要
  const foundCount = Object.values(results).filter(
    (r) => r.status === "ok",
  ).length;
  const notFoundCount = Object.values(results).filter(
    (r) => r.status === "not_found",
  ).length;
  console.log(
    `[executeSearch] 查询完成: 实际查询${queriedTerms.length}个, 缓存命中${cacheHits.length}个, ${foundCount}个找到, ${notFoundCount}个未找到`,
  );

  // 🔍 详细日志：列出未找到的术语
  const notFoundTerms = Object.entries(results)
    .filter(([_, result]) => result.status === "not_found")
    .map(([term, _]) => term);
  if (notFoundTerms.length > 0) {
    console.log("[executeSearch] 未找到的术语:", notFoundTerms.join(", "));
  }

  // 📝 保存搜索历史到数据库（供AI学习使用）
  try {
    const historyEntries = Object.entries(results)
      .filter(
        ([_, result]) => result.status === "ok" && result.candidates.length > 0,
      )
      .map(([term, result]) => ({
        term,
        // 只保存 top3/5 候选的译文
        candidates: result.candidates.slice(0, 5).map((c) => c.zh),
        updatedAt: Date.now(),
      }));

    if (historyEntries.length > 0) {
      await invoke("save_search_history", { entries: historyEntries });
      console.log(`[executeSearch] 已保存 ${historyEntries.length} 条搜索历史`);
    }
  } catch (error) {
    // 保存失败不影响主流程
    console.warn("[executeSearch] 保存搜索历史失败:", error);
  }

  return {
    results,
    queriedTerms,
    cacheHits,
  };
}

/**
 * 执行apply_translations工具
 * 从session state删除已翻译的条目，并调用回调更新UI
 * 支持自动扩散：当提供 expandIndices 时，会自动将翻译应用到相同原文的其他条目
 */
export function executeApply(
  translations: Array<{ index: number; translated: string }>,
  sessionState: SessionState,
  onApply: (index: number, translated: string) => void,
  expandIndices?: (index: number) => number[], // 扩散 resolver：给定 index，返回其他仍待翻译的相同原文索引
): {
  success: boolean;
  error?: string;
  invalidIndexes?: number[];
  appliedIndices?: number[];
  expandedCount?: number; // 自动扩散的条目数量
} {
  const invalidIndexes: number[] = [];

  // 验证所有index是否存在
  for (const trans of translations) {
    const exists = sessionState.csv.some((row) => row.index === trans.index);
    if (!exists) {
      invalidIndexes.push(trans.index);
    }
  }

  // 如果有无效index，返回错误
  if (invalidIndexes.length > 0) {
    return {
      success: false,
      error: `以下index在CSV中不存在: ${invalidIndexes.join(", ")}`,
      invalidIndexes,
    };
  }

  // 执行apply_translations
  try {
    // 1. 收集所有需要应用的翻译（原始 + 扩散）
    const allTranslations: Array<{ index: number; translated: string }> = [];
    const processedIndices = new Set(translations.map((t) => t.index));
    let expandedCount = 0;

    for (const trans of translations) {
      allTranslations.push(trans);

      // 2. 查找并扩散到相同原文的其他条目
      if (expandIndices) {
        const siblings = expandIndices(trans.index);
        for (const siblingIndex of siblings) {
          if (!processedIndices.has(siblingIndex)) {
            allTranslations.push({
              index: siblingIndex,
              translated: trans.translated,
            });
            processedIndices.add(siblingIndex); // 防止重复
            expandedCount++;
          }
        }
      }
    }

    // 3. 从csv中删除所有已应用的行
    sessionState.csv = sessionState.csv.filter(
      (row) => !allTranslations.some((t) => t.index === row.index),
    );

    // 4. 调用回调更新UI（translationStore）
    allTranslations.forEach((trans) => {
      onApply(trans.index, trans.translated);
    });

    // 5. 收集成功应用的索引
    const appliedIndices = allTranslations.map((t) => t.index);

    return { success: true, appliedIndices, expandedCount };
  } catch (error) {
    console.error("executeApply失败:", error);
    return {
      success: false,
      error: `应用翻译失败: ${String(error)}`,
    };
  }
}

/**
 * 执行skip工具
 * 从session state中移除无需翻译的条目
 */
export function executeSkip(
  entries: Array<{ index: number; reason?: string }>,
  sessionState: SessionState,
): {
  success: boolean;
  error?: string;
  invalidIndexes?: number[];
  skippedEntries?: Array<{ index: number; reason?: string }>;
} {
  if (!entries || entries.length === 0) {
    return {
      success: false,
      error: "entries参数不能为空",
      invalidIndexes: [],
    };
  }

  // 去重 + 规范化
  const normalized = Array.from(
    new Map(
      entries.map((entry) => [
        entry.index,
        {
          index: entry.index,
          reason:
            typeof entry.reason === "string"
              ? entry.reason.trim().slice(0, 200)
              : undefined,
        },
      ]),
    ).values(),
  );

  const invalidIndexes: number[] = [];
  normalized.forEach((entry) => {
    const exists = sessionState.csv.some((row) => row.index === entry.index);
    if (!exists) {
      invalidIndexes.push(entry.index);
    }
  });

  if (invalidIndexes.length > 0) {
    return {
      success: false,
      error: `以下index在CSV中不存在: ${invalidIndexes.join(", ")}`,
      invalidIndexes,
    };
  }

  const indicesToSkip = new Set(normalized.map((entry) => entry.index));
  sessionState.csv = sessionState.csv.filter(
    (row) => !indicesToSkip.has(row.index),
  );

  return {
    success: true,
    skippedEntries: normalized,
  };
}

/**
 * 术语预处理：调用replace_with_atoms标注术语
 * @param text 原文
 * @returns 标注后的文本（如："The argonian(亚龙人) looks unfriendly."）
 */
export async function preprocessTerms(text: string): Promise<string> {
  try {
    const annotated = await invoke<string>("replace_text_with_atoms", {
      text,
    });
    return annotated;
  } catch (error) {
    console.warn("术语预处理失败:", error);
    // 失败时返回原文
    return text;
  }
}

/**
 * 批量术语预处理
 * 返回结构包含原始原文（rawText）和标注后文本（text）
 */
export async function preprocessBatch(
  entries: Array<{ index: number; text: string }>,
): Promise<Array<{ index: number; text: string; rawText: string }>> {
  const preprocessed = await Promise.all(
    entries.map(async (entry) => ({
      index: entry.index,
      text: await preprocessTerms(entry.text), // 术语标注后的文本
      rawText: entry.text, // 原始原文
    })),
  );
  return preprocessed;
}
