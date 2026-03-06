import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ApiConfig } from "../../stores/apiConfigStore";

const DEFAULT_CONTEXT_WINDOW = 128000;

export type ContextUsageStats = {
  usedTokens: number;
  totalTokens: number;
  usedPercent: number;
};

export function estimateContextUsage(
  messages: ChatCompletionMessageParam[],
  apiConfig: ApiConfig,
): ContextUsageStats {
  const totalChars = messages.reduce((sum, msg) => {
    const content = (msg as any).content;
    if (typeof content === "string") {
      return sum + content.length;
    }
    if (Array.isArray(content)) {
      return (
        sum +
        content.reduce((inner: number, part: any) => {
          if (typeof part === "string") {
            return inner + part.length;
          }
          if (part && typeof part.text === "string") {
            return inner + part.text.length;
          }
          return inner;
        }, 0)
      );
    }
    return sum;
  }, 0);

  const usedTokens = Math.max(1, Math.ceil(totalChars / 4));
  const totalTokens = Math.max(
    1024,
    apiConfig.contextWindow || DEFAULT_CONTEXT_WINDOW,
  );
  const usedPercent = Math.min(100, (usedTokens / totalTokens) * 100);
  return {
    usedTokens,
    totalTokens,
    usedPercent,
  };
}
