import type OpenAI from "openai";

export async function collectStreamToolCalls(stream: AsyncIterable<any>): Promise<{
  message: OpenAI.Chat.Completions.ChatCompletionMessage;
  finishReason: string | null;
}> {
  const toolCallMap = new Map<
    number,
    {
      id: string;
      type: "function";
      function: {
        name: string;
        arguments: string;
      };
    }
  >();

  let finishReason: string | null = null;
  let contentBuffer = "";

  for await (const chunk of stream) {
    const choice = chunk?.choices?.[0];
    if (!choice) {
      continue;
    }

    const delta = choice.delta ?? {};
    if (typeof delta.content === "string") {
      contentBuffer += delta.content;
    }

    if (Array.isArray(delta.tool_calls)) {
      delta.tool_calls.forEach((part: any) => {
        const index = typeof part.index === "number" ? part.index : 0;
        const existing = toolCallMap.get(index) ?? {
          id: part.id || `stream-tool-${index}`,
          type: "function" as const,
          function: {
            name: "",
            arguments: "",
          },
        };

        if (part.id) {
          existing.id = part.id;
        }
        if (part.function?.name) {
          existing.function.name = part.function.name;
        }
        if (typeof part.function?.arguments === "string") {
          existing.function.arguments += part.function.arguments;
        }
        toolCallMap.set(index, existing);
      });
    }

    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
  }

  const toolCalls = Array.from(toolCallMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([, value]) => value);

  const message = {
    role: "assistant",
    content: contentBuffer || null,
    tool_calls: toolCalls as any,
  } as OpenAI.Chat.Completions.ChatCompletionMessage;
  return { message, finishReason };
}
