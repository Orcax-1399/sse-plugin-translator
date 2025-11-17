/**
 * AI翻译主逻辑模块
 * 实现session循环和批量翻译功能
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ApiConfig } from '../stores/apiConfigStore';
import type { SessionState } from './aiPrompts';
import { buildMessages } from './aiPrompts';
import {
  toolDefinitions,
  executeSearch,
  executeApply,
  preprocessBatch,
} from './aiTools';

/**
 * 翻译条目（输入）
 */
export interface TranslationEntry {
  /** 行索引（对应StringRecord的唯一标识） */
  index: number;
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
  formId: string,
  recordType: string,
  subrecordType: string,
  translated: string,
) => void;

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
 * @returns 翻译结果
 */
export async function translateBatchWithAI(
  entries: TranslationEntry[],
  apiConfig: ApiConfig,
  onProgress: ProgressCallback,
  onApply: ApplyCallback,
  cancellationToken?: CancellationToken,
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

  try {
    // 1. 术语预处理（批量调用replace_with_atoms）
    console.log('[AI翻译] 开始术语预处理...');
    const preprocessed = await preprocessBatch(
      entries.map((e) => ({ index: e.index, text: e.originalText })),
    );

    // 2. 初始化Session状态
    sessionState = {
      csv: preprocessed,
      searchCache: {},
    };

    // 3. 创建entry映射（用于apply时查找完整信息）
    const entryMap = new Map<number, TranslationEntry>();
    entries.forEach((entry) => {
      entryMap.set(entry.index, entry);
    });

    const totalCount = entries.length;
    let maxIterations = 50; // 最大迭代次数，防止死循环

    // 4. Session循环
    console.log(`[AI翻译] 开始翻译，共 ${totalCount} 条`);
    while (sessionState.csv.length > 0 && maxIterations > 0) {
      // 检查是否被取消
      if (cancellationToken?.isCancelled()) {
        console.log('[AI翻译] 用户取消翻译');
        return {
          success: false,
          translatedCount: totalCount - sessionState.csv.length,
          error: '用户取消翻译',
        };
      }

      maxIterations--;

      // 4.1 构造消息
      const messages = buildMessages(sessionState);

      // 4.2 调用AI
      console.log(
        `[AI翻译] 调用AI，剩余 ${sessionState.csv.length} 条待翻译`,
      );
      console.log('[AI翻译] 发送的messages:', JSON.stringify(messages, null, 2).slice(0, 1000) + '...');
      let completion: OpenAI.Chat.Completions.ChatCompletion;
      try {
        completion = await client.chat.completions.create({
          model: apiConfig.modelName,
          messages: messages as ChatCompletionMessageParam[],
          tools: [toolDefinitions.search, toolDefinitions.apply],
          tool_choice: 'auto',
          temperature: 0.1,
          max_tokens: apiConfig.maxTokens,
        });
      } catch (error: any) {
        console.error('[AI翻译] API调用失败:', error);
        throw new Error(`AI API调用失败: ${error.message || String(error)}`);
      }

      const message = completion.choices[0]?.message;
      if (!message) {
        throw new Error('AI返回空响应');
      }

      // 🔍 详细日志：AI返回的完整消息
      console.log('[AI翻译] AI返回消息:', {
        role: message.role,
        content: message.content,
        tool_calls: message.tool_calls,
        finish_reason: completion.choices[0]?.finish_reason,
      });

      // 4.3 处理工具调用
      const toolCalls = message.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        // AI没有输出工具调用，这是不允许的，重发
        console.warn('[AI翻译] AI未输出工具调用，重新发送');
        console.warn('[AI翻译] AI返回的content:', message.content);
        console.warn('[AI翻译] finish_reason:', completion.choices[0]?.finish_reason);
        sessionState.lastError = {
          tool: 'system',
          args: {},
          error: '你必须调用工具（search或apply），不能直接输出文本。',
        };
        continue;
      }

      // 清除上次错误（如果有）
      delete sessionState.lastError;

      // 4.4 执行工具调用
      let hasError = false;
      for (const toolCall of toolCalls) {
        if (toolCall.type !== 'function') continue;

        const toolName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);

        console.log(`[AI翻译] 执行工具: ${toolName}`, args);

        if (toolName === 'search') {
          // 执行search
          try {
            const searchResults = await executeSearch(args.terms);
            // 更新searchCache
            sessionState.searchCache = {
              ...sessionState.searchCache,
              ...searchResults,
            };
            console.log(
              `[AI翻译] search完成，查询了 ${args.terms.length} 个术语`,
            );
          } catch (error: any) {
            console.error('[AI翻译] search执行失败:', error);
            sessionState.lastError = {
              tool: 'search',
              args,
              error: error.message || String(error),
            };
            hasError = true;
            break;
          }
        } else if (toolName === 'apply') {
          // 执行apply
          // ⚠️ 有时AI会返回双重JSON编码的字符串，需要检查并解析
          let translations = args.translations;
          if (typeof translations === 'string') {
            console.warn('[AI翻译] translations是字符串，尝试解析:', translations.slice(0, 100));
            try {
              translations = JSON.parse(translations);
            } catch (e) {
              console.error('[AI翻译] 解析translations失败:', e);
              sessionState.lastError = {
                tool: 'apply',
                args,
                error: `translations格式错误: ${String(e)}`,
              };
              hasError = true;
              break;
            }
          }

          const applyResult = executeApply(
            translations,
            sessionState,
            (index, translated) => {
              // 调用回调更新UI
              const entry = entryMap.get(index);
              if (entry) {
                onApply(
                  index,
                  entry.formId,
                  entry.recordType,
                  entry.subrecordType,
                  translated,
                );
              }
            },
          );

          if (!applyResult.success) {
            console.error('[AI翻译] apply执行失败:', applyResult.error);
            sessionState.lastError = {
              tool: 'apply',
              args,
              error: applyResult.error || '未知错误',
            };
            hasError = true;
            break;
          }

          console.log(
            `[AI翻译] apply完成，翻译了 ${args.translations.length} 条`,
          );

          // 更新进度
          const completed = totalCount - sessionState.csv.length;
          onProgress(completed, totalCount);
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
        throw new Error(
          `翻译未完成：达到最大迭代次数，剩余 ${sessionState.csv.length} 条待翻译`,
        );
      }
    }

    console.log('[AI翻译] 翻译完成！');
    return {
      success: true,
      translatedCount: totalCount - sessionState.csv.length,
    };
  } catch (error: any) {
    console.error('[AI翻译] 翻译失败:', error);
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
      console.log('[AI翻译] 取消令牌已触发');
    },
    isCancelled: () => cancelled,
  };
}
