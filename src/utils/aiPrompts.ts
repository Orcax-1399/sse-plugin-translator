/**
 * AI翻译Prompt模板模块
 * 负责构建System Prompt和User Prompt
 */

export interface SessionState {
  csv: Array<{ index: number; text: string }>;
  searchCache: Record<string, SearchResult>;
  lastError?: {
    tool: string;
    args: any;
    error: string;
  };
}

export interface SearchResult {
  status: "ok" | "not_found";
  candidates: Array<{
    en: string;
    zh: string;
    length?: number; // 用于排序
  }>;
}

/**
 * 构建System Prompt
 * 定义AI的角色和工具调用规则
 */
export function buildSystemPrompt(): string {
  return `你是一个游戏模组翻译系统的工具执行引擎。你的职责是根据当前任务状态，调用工具完成翻译工作。

## 核心规则

1. **你只能输出工具调用，禁止直接输出翻译文本或任何解释性文字**
2. 你有两个工具：search（查询术语）和 apply（提交翻译）
3. 当遇到了**人名**, **地名**, **术语**的时候，**一定要先调用search**

## 工具使用规范

### search(terms: string[])
- 用于查询专有名词、术语的标准译名
- 返回结果有两种状态：
  - "ok": 表示找到了候选译名，你**必须使用**这些候选译名
  - "not_found": 表示全局数据库确实没有该术语，你需要**自行创造**合理的中文译名
- 候选译名按字符串长度排序（短→长），优先使用排在前面的
- 同一个术语在当前session中只需search一次，结果会保存在SEARCH缓存中
- 如果术语已在SEARCH缓存中，不要重复查询

### apply(translations: Array<{index: number, translated: string}>)
- 用于提交翻译结果
- index 对应CSV中的行号
- 你应该尽可能批量提交（一次多条），提高效率
- 提交后，对应的CSV行会被删除，任务进度推进

## 术语标注格式

输入文本中可能包含术语标注，格式为：\`EnglishTerm(ChineseTerm)\`

例如：
- "The argonian(亚龙人) looks unfriendly."
- "Sothis(索西斯) is a goddess."

**处理规则**：
- 括号内的中文译名是经过确认的专有名词翻译
- 翻译时，你应该使用括号内的译名，并移除标注格式
- 例如："The argonian(亚龙人) looks unfriendly." → "这个亚龙人看起来不友好。"

## 翻译质量要求

1. **术语一致性**：同一术语在整个session中必须使用相同的译名
2. **上下文连贯**：考虑游戏场景，使用符合奇幻RPG风格的译文
3. **简洁流畅**：避免生硬的直译，追求自然的中文表达
4. **保留格式**：
   - 保留占位符：%s, %d, {NAME}, <color=#ffffff> 等
   - 保留换行符和特殊字符
   - 保留HTML标签（如有）

## 工作流程

1. 查看CSV待翻译列表，识别需要search的术语
2. 批量调用search查询术语（如果SEARCH缓存中没有）
3. 根据search结果和术语标注，翻译所有CSV行
4. 批量调用apply提交翻译（尽可能一次提交多条）
5. 如果存在长文本，则优先查询/翻译长文本，并且提交条目减少
6. 如果CSV还有剩余，重复上述流程

## 错误处理

如果工具调用失败（如apply的index不存在），系统会在下一轮提供错误信息。
你需要根据错误信息调整参数，重新调用工具。

记住：你的唯一输出应该是工具调用（tool_calls），不要输出任何文本解释。`;
}

/**
 * 构建User Prompt
 * 提供当前任务状态（CSV + SEARCH缓存 + 可选错误）
 */
export function buildUserPrompt(state: SessionState): string {
  let prompt = `当前翻译任务状态：\n\n`;

  // 1. CSV待翻译列表
  prompt += `## CSV待翻译 (${state.csv.length}条)\n\n`;
  if (state.csv.length === 0) {
    prompt += `(无待翻译内容)\n\n`;
  } else {
    prompt += "```csv\nindex,original_text\n";
    state.csv.forEach((row) => {
      // 转义CSV中的引号和换行
      const escapedText = row.text.replace(/"/g, '""').replace(/\n/g, "\\n");
      prompt += `${row.index},"${escapedText}"\n`;
    });
    prompt += "```\n\n";
  }

  // 2. SEARCH缓存
  prompt += `## SEARCH缓存\n\n`;
  const cacheEntries = Object.entries(state.searchCache);
  if (cacheEntries.length === 0) {
    prompt += `(空缓存)\n\n`;
  } else {
    prompt += "```json\n";
    prompt += JSON.stringify(state.searchCache, null, 2);
    prompt += "\n```\n\n";
  }

  // 3. 错误信息（如果有）
  if (state.lastError) {
    prompt += `## ⚠️ 上次工具调用错误\n\n`;
    prompt += `工具: ${state.lastError.tool}\n`;
    prompt += `参数: ${JSON.stringify(state.lastError.args)}\n`;
    prompt += `错误: ${state.lastError.error}\n\n`;
    prompt += `请根据错误信息调整参数并重试。\n\n`;
  }

  prompt += `---\n\n请使用工具完成翻译任务。`;

  return prompt;
}

/**
 * 完整消息构造（用于AI SDK）
 */
export function buildMessages(state: SessionState) {
  return [
    {
      role: "system" as const,
      content: buildSystemPrompt(),
    },
    {
      role: "user" as const,
      content: buildUserPrompt(state),
    },
  ];
}
