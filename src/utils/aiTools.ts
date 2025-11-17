/**
 * AI翻译工具实现模块
 * 实现search和apply工具的具体逻辑
 */

import { invoke } from '@tauri-apps/api/core';
import type { SessionState, SearchResult } from './aiPrompts';

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
  original_text: string;      // ← 英文原文
  translated_text: string;    // ← 中文译文
  plugin_name: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * 工具定义（OpenAI格式）
 */
export const toolDefinitions = {
  search: {
    type: 'function' as const,
    function: {
      name: 'search',
      description: '查询术语的翻译候选。用于查找专有名词、术语的标准译名。',
      parameters: {
        type: 'object',
        properties: {
          terms: {
            type: 'array',
            items: { type: 'string' },
            description: '需要查询的术语列表（英文）',
          },
        },
        required: ['terms'],
      },
    },
  },
  apply: {
    type: 'function' as const,
    function: {
      name: 'apply',
      description: '提交翻译结果。将已翻译的文本提交到系统。',
      parameters: {
        type: 'object',
        properties: {
          translations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: {
                  type: 'number',
                  description: 'CSV行的index',
                },
                translated: {
                  type: 'string',
                  description: '翻译后的中文文本',
                },
              },
              required: ['index', 'translated'],
            },
            description: '翻译结果列表',
          },
        },
        required: ['translations'],
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
): Promise<Record<string, SearchResult>> {
  const results: Record<string, SearchResult> = {};

  // ⚠️ 保证：即使查询失败，每个term也要有结果
  // 先初始化所有terms为not_found，后续找到了再覆盖
  terms.forEach(term => {
    results[term] = {
      status: 'not_found',
      candidates: [],
    };
  });

  try {
    // 1. 查询原子库（atomic_translations）
    const atoms = await invoke<AtomTranslation[]>('get_all_atoms');
    const atomMap = new Map<string, string>();
    atoms.forEach((atom) => {
      // 原子库存储小写，匹配时不区分大小写
      atomMap.set(atom.original.toLowerCase(), atom.translated);
    });

    // 2. 对每个术语进行查询
    for (const term of terms) {
      const lowerTerm = term.toLowerCase();
      const candidates: Array<{ en: string; zh: string; length: number }> = [];

      // 2.1 查询原子库
      if (atomMap.has(lowerTerm)) {
        candidates.push({
          en: term,
          zh: atomMap.get(lowerTerm)!,
          length: term.length,
        });
      }

      // 2.2 查询参考翻译（translations表）
      try {
        const refs = await invoke<ReferenceTranslation[]>(
          'query_word_translations',
          {
            text: term,
            limit: 5, // 最多返回5个参考
          },
        );

        // 安全检查：确保refs是数组且元素有效
        if (Array.isArray(refs)) {
          refs.forEach((ref) => {
            // 跳过无效数据
            if (!ref || !ref.original_text || !ref.translated_text) {
              console.warn(`跳过无效的参考翻译数据:`, ref);
              return;
            }
            // 避免重复添加（原子库优先）
            if (!candidates.some((c) => c.zh === ref.translated_text)) {
              candidates.push({
                en: ref.original_text,
                zh: ref.translated_text,
                length: ref.original_text.length,
              });
            }
          });
        } else {
          console.warn(`query_word_translations返回非数组:`, refs);
        }
      } catch (error) {
        console.warn(`查询参考翻译失败 (${term}):`, error);
      }

      // 3. 处理结果
      if (candidates.length === 0) {
        // 没有找到任何候选
        results[term] = {
          status: 'not_found',
          candidates: [],
        };
      } else {
        // 按字符串长度排序（短→长），取top3
        candidates.sort((a, b) => a.length - b.length);
        const top3 = candidates.slice(0, 3);

        results[term] = {
          status: 'ok',
          candidates: top3.map((c) => ({ en: c.en, zh: c.zh })),
        };
      }
    }
  } catch (error) {
    console.error('executeSearch失败:', error);
    // ⚠️ 不抛出异常，返回已初始化的results（所有terms都是not_found）
    console.warn('⚠️ 查询过程出错，所有术语标记为not_found');
  }

  // 🔍 日志：显示查询结果摘要
  const foundCount = Object.values(results).filter(r => r.status === 'ok').length;
  const notFoundCount = Object.values(results).filter(r => r.status === 'not_found').length;
  console.log(`[executeSearch] 查询完成: ${foundCount}个找到, ${notFoundCount}个未找到`);

  // 🔍 详细日志：列出未找到的术语
  const notFoundTerms = Object.entries(results)
    .filter(([_, result]) => result.status === 'not_found')
    .map(([term, _]) => term);
  if (notFoundTerms.length > 0) {
    console.log('[executeSearch] 未找到的术语:', notFoundTerms.join(', '));
  }

  return results;
}

/**
 * 执行apply工具
 * 从session state删除已翻译的条目，并调用回调更新UI
 */
export function executeApply(
  translations: Array<{ index: number; translated: string }>,
  sessionState: SessionState,
  onApply: (index: number, translated: string) => void,
): { success: boolean; error?: string; invalidIndexes?: number[] } {
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
      error: `以下index在CSV中不存在: ${invalidIndexes.join(', ')}`,
      invalidIndexes,
    };
  }

  // 执行apply
  try {
    // 1. 从csv中删除已翻译的行
    sessionState.csv = sessionState.csv.filter(
      (row) => !translations.some((t) => t.index === row.index),
    );

    // 2. 调用回调更新UI（translationStore）
    translations.forEach((trans) => {
      onApply(trans.index, trans.translated);
    });

    return { success: true };
  } catch (error) {
    console.error('executeApply失败:', error);
    return {
      success: false,
      error: `应用翻译失败: ${String(error)}`,
    };
  }
}

/**
 * 术语预处理：调用replace_with_atoms标注术语
 * @param text 原文
 * @returns 标注后的文本（如："The argonian(亚龙人) looks unfriendly."）
 */
export async function preprocessTerms(text: string): Promise<string> {
  try {
    const annotated = await invoke<string>('replace_text_with_atoms', {
      text,
    });
    return annotated;
  } catch (error) {
    console.warn('术语预处理失败:', error);
    // 失败时返回原文
    return text;
  }
}

/**
 * 批量术语预处理
 */
export async function preprocessBatch(
  entries: Array<{ index: number; text: string }>,
): Promise<Array<{ index: number; text: string }>> {
  const preprocessed = await Promise.all(
    entries.map(async (entry) => ({
      index: entry.index,
      text: await preprocessTerms(entry.text),
    })),
  );
  return preprocessed;
}
