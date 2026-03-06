import { requestViaAnthropicMessages } from "./anthropicMessagesProvider";
import { requestViaGoogleV1Beta } from "./googleV1BetaProvider";
import { requestViaOpenAIChat } from "./openaiChatProvider";
import { requestViaOpenAIResponses } from "./openaiResponsesProvider";
import type { ProviderHandler } from "./types";

const DEFAULT_PROVIDER_STYLE = "openai_chat_completions";

const providerRegistry: Record<string, ProviderHandler> = {
  openai_chat_completions: requestViaOpenAIChat,
  openai_responses: requestViaOpenAIResponses,
  anthropic_messages: requestViaAnthropicMessages,
  google_v1beta_generate_content: requestViaGoogleV1Beta,
};

export function resolveProvider(style?: string): ProviderHandler {
  const resolvedStyle = style || DEFAULT_PROVIDER_STYLE;
  const provider = providerRegistry[resolvedStyle];
  if (!provider) {
    throw new Error(`不支持的 API 风格: ${resolvedStyle}`);
  }
  return provider;
}
