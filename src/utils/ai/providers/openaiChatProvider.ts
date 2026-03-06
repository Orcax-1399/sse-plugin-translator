import { collectStreamToolCalls } from "./stream";
import type {
  CompletionWithToolCalls,
  ProviderRequestContext,
} from "./types";

export async function requestViaOpenAIChat(
  context: ProviderRequestContext,
): Promise<CompletionWithToolCalls> {
  const { client, request, signal } = context;
  try {
    const streamResponse = await client.chat.completions.create(
      {
        ...(request as any),
        stream: true,
      },
      { signal },
    );
    const streamed = await collectStreamToolCalls(
      streamResponse as unknown as AsyncIterable<any>,
    );
    return {
      message: streamed.message,
      finishReason: streamed.finishReason,
      usedStreaming: true,
    };
  } catch (error: any) {
    if (signal.aborted) {
      throw error;
    }
    console.warn("[AI翻译] 流式响应失败，回退到非流式:", error);
    const completion = await client.chat.completions.create(request as any, {
      signal,
    });
    const message = completion.choices[0]?.message;
    if (!message) {
      throw new Error("AI返回空响应");
    }
    return {
      message,
      finishReason: completion.choices[0]?.finish_reason ?? null,
      usedStreaming: false,
    };
  }
}
