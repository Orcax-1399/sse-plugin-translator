import type OpenAI from "openai";
import type { ApiConfig } from "../../../stores/apiConfigStore";
import { resolveProvider } from "./registry";
import type {
  CompletionWithToolCalls,
  StatusEmitter,
  ToolCallRequest,
} from "./types";
import type { ContextUsageStats } from "../contextUsage";

export type { CompletionWithToolCalls } from "./types";

export async function requestToolCallCompletion(
  client: OpenAI,
  apiConfig: ApiConfig,
  request: ToolCallRequest,
  signal: AbortSignal,
  emitStatus: StatusEmitter,
  contextUsage?: ContextUsageStats,
): Promise<CompletionWithToolCalls> {
  const provider = resolveProvider(apiConfig.apiStyle);
  return provider({
    client,
    apiConfig,
    request,
    signal,
    emitStatus,
    contextUsage,
  });
}
