import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { toolDefinitions } from "../../aiTools";

export function joinUrl(base: string, path: string): string {
  const trimmedBase = (base || "").replace(/\/+$/, "");
  const trimmedPath = path.replace(/^\/+/, "");
  return `${trimmedBase}/${trimmedPath}`;
}

export function extractSystemAndUserFromMessages(
  messages: ChatCompletionMessageParam[],
): { system: string; user: string } {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m: any) => (typeof m.content === "string" ? m.content : ""))
    .filter(Boolean)
    .join("\n\n");
  const user = messages
    .filter((m) => m.role === "user")
    .map((m: any) => (typeof m.content === "string" ? m.content : ""))
    .filter(Boolean)
    .join("\n\n");
  return { system, user };
}

export function buildFunctionToolsForResponses() {
  return [
    toolDefinitions.search,
    toolDefinitions.workOnLongText,
    toolDefinitions.applyTranslations,
    toolDefinitions.skip,
  ].map((tool: any) => ({
    type: "function" as const,
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }));
}

export function buildFunctionToolsForAnthropic() {
  return [
    toolDefinitions.search,
    toolDefinitions.workOnLongText,
    toolDefinitions.applyTranslations,
    toolDefinitions.skip,
  ].map((tool: any) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

export function buildFunctionToolsForGoogle() {
  return [
    toolDefinitions.search,
    toolDefinitions.workOnLongText,
    toolDefinitions.applyTranslations,
    toolDefinitions.skip,
  ].map((tool: any) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }));
}

export function buildAssistantMessageFromToolCalls(
  toolCalls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>,
  content: string | null = null,
): OpenAI.Chat.Completions.ChatCompletionMessage {
  return {
    role: "assistant",
    content,
    tool_calls: toolCalls as any,
  } as OpenAI.Chat.Completions.ChatCompletionMessage;
}
