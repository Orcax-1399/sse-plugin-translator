import type OpenAI from "openai";

export function formatAiResponse(
  message: OpenAI.Chat.Completions.ChatCompletionMessage,
): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return (content as Array<string | { text?: string; content?: string }>)
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object") {
          if ("text" in part && typeof part.text === "string") {
            return part.text;
          }
          if ("content" in part && typeof (part as any).content === "string") {
            return (part as any).content;
          }
        }
        return "";
      })
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  return "";
}
