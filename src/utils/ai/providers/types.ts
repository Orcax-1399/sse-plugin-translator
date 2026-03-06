import type OpenAI from "openai";
import type { ApiConfig } from "../../../stores/apiConfigStore";
import type { ContextUsageStats } from "../contextUsage";

export type CompletionWithToolCalls = {
  message: OpenAI.Chat.Completions.ChatCompletionMessage;
  finishReason: string | null;
  usedStreaming: boolean;
};

export type StatusEmitter = (
  type: "info" | "success" | "error",
  message: string,
  isHeartbeat?: boolean,
  contextUsage?: ContextUsageStats,
) => void;

export type ToolCallRequest = Omit<
  OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  "stream"
>;

export interface ProviderRequestContext {
  client: OpenAI;
  apiConfig: ApiConfig;
  request: ToolCallRequest;
  signal: AbortSignal;
  emitStatus: StatusEmitter;
  contextUsage?: ContextUsageStats;
}

export type ProviderHandler = (
  context: ProviderRequestContext,
) => Promise<CompletionWithToolCalls>;
