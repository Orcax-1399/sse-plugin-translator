import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  buildAssistantMessageFromToolCalls,
  buildFunctionToolsForAnthropic,
  extractSystemAndUserFromMessages,
  joinUrl,
} from "./helpers";
import type {
  CompletionWithToolCalls,
  ProviderRequestContext,
} from "./types";

export async function requestViaAnthropicMessages(
  context: ProviderRequestContext,
): Promise<CompletionWithToolCalls> {
  const { request, apiConfig, signal } = context;
  const { system, user } = extractSystemAndUserFromMessages(
    request.messages as ChatCompletionMessageParam[],
  );
  const endpoint = joinUrl(apiConfig.endpoint, "/v1/messages");
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiConfig.apiKey,
    "anthropic-version": "2023-06-01",
  };
  const basePayload = {
    model: request.model,
    max_tokens: apiConfig.maxTokens,
    temperature: request.temperature,
    system,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: user,
          },
        ],
      },
    ],
    tools: buildFunctionToolsForAnthropic(),
    tool_choice: { type: "any" as const },
  };

  try {
    const streamResp = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...basePayload,
        stream: true,
      }),
      signal,
    });
    if (!streamResp.ok) {
      throw new Error(`Anthropic API失败: ${streamResp.status} ${await streamResp.text()}`);
    }
    const streamed = await collectAnthropicStreamResult(streamResp);
    const message = buildAssistantMessageFromToolCalls(
      streamed.toolCalls,
      streamed.text,
    );
    return {
      message,
      finishReason: streamed.stopReason,
      usedStreaming: true,
    };
  } catch (error: any) {
    if (signal.aborted) {
      throw error;
    }
    console.warn("[AI翻译] Anthropic流式失败，回退非流式:", error);
    const resp = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...basePayload,
        stream: false,
      }),
      signal,
    });
    if (!resp.ok) {
      throw new Error(`Anthropic API失败: ${resp.status} ${await resp.text()}`);
    }
    const data = await resp.json();
    const contentBlocks = Array.isArray(data?.content) ? data.content : [];
    const toolCalls = contentBlocks
      .filter((block: any) => block?.type === "tool_use")
      .map((block: any, idx: number) => ({
        id: block.id || `anthropic-tool-${idx}`,
        type: "function" as const,
        function: {
          name: block.name || "",
          arguments: JSON.stringify(block.input ?? {}),
        },
      }));
    const text = contentBlocks
      .filter((block: any) => block?.type === "text")
      .map((block: any) => block.text || "")
      .join(" ")
      .trim();
    const message = buildAssistantMessageFromToolCalls(
      toolCalls,
      text.length > 0 ? text : null,
    );
    return {
      message,
      finishReason: data?.stop_reason || null,
      usedStreaming: false,
    };
  }
}

async function collectAnthropicStreamResult(resp: Response): Promise<{
  text: string | null;
  toolCalls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  stopReason: string | null;
}> {
  if (!resp.body) {
    throw new Error("Anthropic流式响应缺少body");
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let textBuffer = "";
  let stopReason: string | null = null;

  const toolCallMap = new Map<
    number,
    {
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }
  >();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary < 0) {
        break;
      }
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseEvent(rawEvent);
      if (!parsed) {
        continue;
      }
      if (parsed.dataText === "[DONE]") {
        continue;
      }
      let data: any;
      try {
        data = JSON.parse(parsed.dataText);
      } catch {
        continue;
      }

      if (parsed.eventName === "message_delta") {
        if (typeof data?.delta?.stop_reason === "string") {
          stopReason = data.delta.stop_reason;
        }
        continue;
      }

      if (parsed.eventName === "content_block_start") {
        const block = data?.content_block;
        const index = typeof data?.index === "number" ? data.index : 0;
        if (block?.type === "text" && typeof block.text === "string") {
          textBuffer += block.text;
        }
        if (block?.type === "tool_use") {
          toolCallMap.set(index, {
            id: block.id || `anthropic-tool-${index}`,
            type: "function",
            function: {
              name: block.name || "",
              arguments:
                block?.input && typeof block.input === "object"
                  ? JSON.stringify(block.input)
                  : "",
            },
          });
        }
        continue;
      }

      if (parsed.eventName === "content_block_delta") {
        const index = typeof data?.index === "number" ? data.index : 0;
        const delta = data?.delta || {};
        if (delta?.type === "text_delta" && typeof delta?.text === "string") {
          textBuffer += delta.text;
          continue;
        }
        if (
          delta?.type === "input_json_delta" &&
          typeof delta?.partial_json === "string"
        ) {
          const existing = toolCallMap.get(index) ?? {
            id: `anthropic-tool-${index}`,
            type: "function" as const,
            function: {
              name: "",
              arguments: "",
            },
          };
          existing.function.arguments += delta.partial_json;
          toolCallMap.set(index, existing);
        }
      }
    }
  }

  const toolCalls = Array.from(toolCallMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([, value]) => {
      const normalizedArgs = normalizeJsonString(value.function.arguments);
      return {
        ...value,
        function: {
          ...value.function,
          arguments: normalizedArgs,
        },
      };
    });

  return {
    text: textBuffer.trim().length > 0 ? textBuffer.trim() : null,
    toolCalls,
    stopReason,
  };
}

function parseSseEvent(rawEvent: string): { eventName: string; dataText: string } | null {
  const lines = rawEvent.split(/\r?\n/);
  let eventName = "message";
  const dataLines: string[] = [];
  lines.forEach((line) => {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      return;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  });
  const dataText = dataLines.join("\n").trim();
  if (!dataText) {
    return null;
  }
  return { eventName, dataText };
}

function normalizeJsonString(input: string): string {
  const value = (input || "").trim();
  if (!value) {
    return "{}";
  }
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return JSON.stringify({ _raw: value });
  }
}
