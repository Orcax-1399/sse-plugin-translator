/**
 * AI翻译Prompt模板模块
 * 负责构建System Prompt和User Prompt
 */

export interface SessionState {
  csv: Array<{ index: number; text: string }>;
  searchCache: Record<string, SearchResult>;
  /** 当前批次总条目数，用于展示整体进度 */
  totalCount: number;
  /** 已完成条目数量（会随着 apply 更新） */
  completedCount: number;
  /** search 使用统计与最近一次调用信息 */
  searchMeta: {
    lastTerms: string[];
    executedTerms: string[];
    cacheHits: string[];
    deferredTerms: string[];
    budgetUsed: number;
    budgetTotal: number;
  };
  /** 最近一次 apply 的摘要（帮助 AI 判断调用是否成功） */
  recentApply?: {
    indices: number[];
    preview: Array<{ index: number; translated: string }>;
    timestamp: number;
  };
  /** 最近一次 skip 的摘要（供AI确认跳过结果） */
  recentSkip?: {
    indices: number[];
    preview: Array<{ index: number; reason?: string }>;
    timestamp: number;
  };
  lastError?: {
    tool: string;
    args: any;
    error: string;
    aiResponse?: string;
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
2. 你有三个工具：search（查询术语）、apply_translations（提交翻译）与 skip（跳过无需翻译的条目）
3. 当遇到了**人名**, **地名**, **术语**的时候，应先检查 SEARCH 缓存，如果没有合适候选再调用 search
4. search 有调用预算，User Prompt 会提供 “budgetUsed/budgetTotal”，请优先复用缓存，只有在确实需要时才查询

## 工具使用规范

### search(terms: string[])
- 用于查询专有名词、术语的标准译名
- 返回结果有两种状态：
  - "ok": 表示找到了候选译名，你**必须使用**这些候选译名
  - "not_found": 表示全局数据库确实没有该术语，你需要**自行创造**合理的中文译名
- 候选译名按字符串长度排序（短→长），优先使用排在前面的
- 同一个术语在当前session中只需search一次，结果会保存在SEARCH缓存中
- 如果术语已在SEARCH缓存中，不要重复查询

### apply_translations(translations: Array<{index: number, translated: string}>)
- 用于提交翻译结果
- index 对应CSV中的行号
- 你应该尽可能批量提交（一次多条），提高效率
- 提交后，对应的CSV行会被删除，任务进度推进

### skip(entries: Array<{index: number, reason?: string}>)
- 用于跳过无需翻译的条目，例如纯数字/纯符号、空字符串、已经是中文的文本
- 跳过不会写入译文，只是移除待办条目，请仅在确定无需翻译时使用
- reason 字段可选，可提供\"纯数字\"、\"已为中文\"等说明，帮助审计

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

1. **识别术语**：查看CSV待翻译列表，识别需要search的专有名词/术语
2. **批量查询**：批量调用search查询缺失的术语（优先检查SEARCH缓存，避免重复查询）
3. **优先翻译**：优先翻译已有search结果或术语标注的条目（充分利用查询预算）
4. **批量提交**：批量调用apply_translations提交翻译（**必须充分利用search结果，一次提交所有已准备好的翻译**）
5. **继续迭代**：如果CSV还有剩余且有预算，重复上述流程；若预算耗尽，翻译剩余的简单条目

**重要原则**：
- search预算在apply后会重置，因此**不要浪费查询结果**，查询后应尽可能翻译所有相关条目
- 避免"查询少量术语→只翻译1-2条→重置预算"的低效模式
- 每次apply应包含所有已准备好的翻译（有search结果、术语标注或无需查询的简单文本）

## 错误处理

如果工具调用失败（如apply_translations的index不存在），系统会在下一轮提供错误信息。
你需要根据错误信息调整参数，重新调用工具。

## 进度与预算

- CSV 列表中剩余的行就是需要翻译的条目，长度为 0 表示已经完成；\`已完成/总计\` 字段也会同步显示
- search budget 形如 \`2/6\`，表示本轮已经使用 2 次预算，最多允许 6 次；用尽预算后若仍需要术语，请改用已有信息完成翻译
- recent apply 区块会展示最近一次提交的 index（最多5条）与译文片段，可据此确认提交是否成功

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

  // 3. Progress / Search Meta
  prompt += `## 进度\n\n`;
  prompt += `- 已完成: ${state.completedCount}/${state.totalCount}\n`;
  prompt += `- search预算: ${state.searchMeta.budgetUsed}/${state.searchMeta.budgetTotal}\n`;
  if (state.searchMeta.lastTerms.length > 0) {
    const lastTerms = state.searchMeta.lastTerms.slice(0, 10).join(", ");
    const executed = state.searchMeta.executedTerms.slice(0, 10).join(", ");
    const cacheHits = state.searchMeta.cacheHits.slice(0, 10).join(", ");
    const deferred =
      state.searchMeta.deferredTerms.length > 0
        ? state.searchMeta.deferredTerms.slice(0, 10).join(", ")
        : "无";
    prompt += `- 上次search请求: [${lastTerms}]\n`;
    prompt += `  * 实际查询: [${executed || "无"}]\n`;
    prompt += `  * 缓存命中: [${cacheHits || "无"}]\n`;
    prompt += `  * 因预算延迟: [${deferred}]\n`;
  } else {
    prompt += `- 尚未调用search\n`;
  }
  if (state.recentApply) {
    const count = state.recentApply.indices.length;
    const indices = state.recentApply.indices.slice(-5).join(", ");
    const preview = state.recentApply.preview
      .slice(-3)
      .map((p) => `${p.index}:"${p.translated.slice(0, 20)}"`)
      .join("; ");
    prompt += `- 上次apply: 成功提交 ${count} 条\n`;
    prompt += `  * index: [${indices}${count > 5 ? "..." : ""}]\n`;
    if (preview) {
      prompt += `  * 译文片段: ${preview}\n`;
    }
  } else {
    prompt += `- 尚未提交 apply_translations\n`;
  }
  if (state.recentSkip) {
    const skipCount = state.recentSkip.indices.length;
    const indices = state.recentSkip.indices.slice(-5).join(", ");
    const preview = state.recentSkip.preview
      .slice(-3)
      .map(
        (p) =>
          `${p.index}:\"${
            p.reason && p.reason.length > 0 ? p.reason.slice(0, 20) : "无说明"
          }\"`,
      )
      .join("; ");
    prompt += `- 上次skip: 跳过 ${skipCount} 条\n`;
    prompt += `  * index: [${indices}${skipCount > 5 ? "..." : ""}]\n`;
    if (preview) {
      prompt += `  * 理由: ${preview}\n`;
    }
  }
  prompt += `\n`;

  // 4. 错误信息（如果有）
  if (state.lastError) {
    prompt += `## ⚠️ 上次工具调用错误\n\n`;
    prompt += `工具: ${state.lastError.tool}\n`;
    prompt += `参数: ${JSON.stringify(state.lastError.args)}\n`;
    prompt += `错误: ${state.lastError.error}\n`;
    if (state.lastError.aiResponse) {
      prompt += `AI响应: ${state.lastError.aiResponse}\n`;
    }
    prompt += `\n`;
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
