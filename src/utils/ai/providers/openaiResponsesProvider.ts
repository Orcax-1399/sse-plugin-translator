import {
  buildAssistantMessageFromToolCalls,
  buildFunctionToolsForResponses,
  extractSystemAndUserFromMessages,
} from "./helpers";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type {
  CompletionWithToolCalls,
  ProviderRequestContext,
} from "./types";

export async function requestViaOpenAIResponses(
  context: ProviderRequestContext,
): Promise<CompletionWithToolCalls> {
  const { client, request, apiConfig, signal } = context;
  const { system, user } = extractSystemAndUserFromMessages(
    request.messages as ChatCompletionMessageParam[],
  );
  const basePayload = {
    model: request.model,
    instructions: system || undefined,
    input: buildResponsesInput(user),
    tools: buildFunctionToolsForResponses(),
    tool_choice: "required" as const,
    temperature: request.temperature,
    max_output_tokens: apiConfig.maxTokens,
  };

  try {
    const stream = await client.responses.create(
      { ...(basePayload as any), stream: true },
      { signal },
    );
    const data = await collectResponsesStreamResult(
      stream as unknown as AsyncIterable<any>,
    );
    return mapResponsesResult(data, true);
  } catch (error: any) {
    if (signal.aborted) {
      throw error;
    }
    console.warn("[AI翻译] OpenAI SDK responses流式失败，回退非流式:", error);
    const data = await client.responses.create(
      { ...(basePayload as any), stream: false },
      { signal },
    );
    return mapResponsesResult(data, false);
  }
}

function buildResponsesInput(user: string) {
  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text: user,
        },
      ],
    },
  ];
}

async function collectResponsesStreamResult(
  stream: AsyncIterable<any>,
): Promise<any> {
  let finalResponse: any = null;
  let outputText = "";
  const functionCalls = new Map<
    string,
    { id: string; name: string; arguments: string }
  >();

  for await (const event of stream) {
    if (event?.response && typeof event.response === "object") {
      finalResponse = event.response;
    }
    if (event?.type === "response.completed" && event?.response) {
      finalResponse = event.response;
      break;
    }
    if (event?.type === "response.output_text.delta" && typeof event.delta === "string") {
      outputText += event.delta;
      continue;
    }

    const item = event?.item;
    if (item?.type === "function_call") {
      const callId =
        item.call_id || item.id || event?.call_id || event?.item_id || "unknown-call";
      functionCalls.set(callId, {
        id: callId,
        name: item.name || "",
        arguments:
          typeof item.arguments === "string"
            ? item.arguments
            : JSON.stringify(item.arguments ?? {}),
      });
      continue;
    }

    const argCallId = event?.call_id || event?.item_id;
    if (
      event?.type === "response.function_call_arguments.delta" &&
      argCallId &&
      typeof event?.delta === "string"
    ) {
      const existing = functionCalls.get(argCallId) ?? {
        id: argCallId,
        name: event?.name || "",
        arguments: "",
      };
      existing.arguments += event.delta;
      functionCalls.set(argCallId, existing);
      continue;
    }
    if (
      event?.type === "response.function_call_arguments.done" &&
      argCallId &&
      typeof event?.arguments === "string"
    ) {
      const existing = functionCalls.get(argCallId) ?? {
        id: argCallId,
        name: event?.name || "",
        arguments: "",
      };
      existing.arguments = event.arguments;
      functionCalls.set(argCallId, existing);
    }
  }

  if (finalResponse) {
    return finalResponse;
  }

  return {
    status: "completed",
    output_text: outputText || undefined,
    output: Array.from(functionCalls.values()).map((call) => ({
      type: "function_call",
      call_id: call.id,
      name: call.name,
      arguments: call.arguments,
    })),
  };
}

function mapResponsesResult(
  data: any,
  usedStreaming = false,
): CompletionWithToolCalls {
  const output = Array.isArray(data?.output) ? data.output : [];
  const toolCalls = output
    .filter((item: any) => item?.type === "function_call")
    .map((item: any, idx: number) => ({
      id: item.call_id || item.id || `resp-tool-${idx}`,
      type: "function" as const,
      function: {
        name: item.name || "",
        arguments:
          typeof item.arguments === "string"
            ? item.arguments
            : JSON.stringify(item.arguments ?? {}),
      },
    }));

  const message = buildAssistantMessageFromToolCalls(
    toolCalls,
    extractOutputText(data),
  );
  return {
    message,
    finishReason: data?.status || null,
    usedStreaming,
  };
}

function extractOutputText(data: any): string | null {
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }
  const output = Array.isArray(data?.output) ? data.output : [];
  const text = output
    .filter((item: any) => item?.type === "message" && Array.isArray(item?.content))
    .flatMap((item: any) => item.content)
    .filter((part: any) => typeof part?.text === "string")
    .map((part: any) => part.text)
    .join(" ")
    .trim();
  return text.length > 0 ? text : null;
}
