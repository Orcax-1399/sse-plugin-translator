import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  buildAssistantMessageFromToolCalls,
  buildFunctionToolsForGoogle,
  extractSystemAndUserFromMessages,
  joinUrl,
} from "./helpers";
import type {
  CompletionWithToolCalls,
  ProviderRequestContext,
} from "./types";

export async function requestViaGoogleV1Beta(
  context: ProviderRequestContext,
): Promise<CompletionWithToolCalls> {
  const { request, apiConfig, signal } = context;
  const { system, user } = extractSystemAndUserFromMessages(
    request.messages as ChatCompletionMessageParam[],
  );
  const endpoint = apiConfig.endpoint.includes(":generateContent")
    ? `${apiConfig.endpoint}${apiConfig.endpoint.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiConfig.apiKey)}`
    : `${joinUrl(apiConfig.endpoint, `/v1beta/models/${apiConfig.modelName}:generateContent`)}?key=${encodeURIComponent(apiConfig.apiKey)}`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: system }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: user }],
        },
      ],
      tools: [
        {
          functionDeclarations: buildFunctionToolsForGoogle(),
        },
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: "ANY",
        },
      },
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: apiConfig.maxTokens,
      },
    }),
    signal,
  });
  if (!resp.ok) {
    throw new Error(`Google API失败: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  const parts =
    data?.candidates?.[0]?.content?.parts &&
    Array.isArray(data.candidates[0].content.parts)
      ? data.candidates[0].content.parts
      : [];
  const toolCalls = parts
    .filter((part: any) => part?.functionCall)
    .map((part: any, idx: number) => ({
      id: `google-tool-${idx}`,
      type: "function" as const,
      function: {
        name: part.functionCall.name || "",
        arguments: JSON.stringify(part.functionCall.args ?? {}),
      },
    }));
  const text = parts
    .filter((part: any) => typeof part?.text === "string")
    .map((part: any) => part.text)
    .join(" ")
    .trim();
  const message = buildAssistantMessageFromToolCalls(
    toolCalls,
    text.length > 0 ? text : null,
  );
  return {
    message,
    finishReason: data?.candidates?.[0]?.finishReason || null,
    usedStreaming: false,
  };
}
