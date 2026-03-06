/**
 * AI翻译Prompt模板模块
 * 负责构建System Prompt和User Prompt
 */

import {
  assembleWorkspaceTranslation,
  buildLongTextPreview,
  getCompletedSegmentCount,
  isLongTextCandidate,
  isWorkspaceComplete,
  type LongTextWorkspace,
} from "./aiLongText";

export interface AiHistoryEntry {
  timestamp: number;
  role: "assistant" | "system" | "tool";
  tool?: string;
  message: string;
  result?: string;
}

export interface SessionState {
  csv: Array<{
    index: number;
    text: string; // 术语标注后的文本（给 AI 看）
    rawText: string; // 原始原文（用于匹配重复）
  }>;
  searchCache: Record<string, SearchResult>;
  /** 当前批次总条目数，用于展示整体进度 */
  totalCount: number;
  /** 已完成条目数量（会随着 apply 更新） */
  completedCount: number;
  /** search 使用统计 */
  searchMeta: {
    lastTerms: string[];
    executedTerms: string[];
    cacheHits: string[];
    deferredTerms: string[];
    budgetUsed: number;
    budgetTotal: number;
  };
  /** 最近的历史对话（search/apply/skip/error），FIFO */
  history: AiHistoryEntry[];
  /** 跨轮可复用的句级翻译记忆（用于减少重复翻译） */
  translationMemory: TranslationMemoryEntry[];
  /** 长文本工作区（按 index 存储） */
  longTextWorkspaces: Record<number, LongTextWorkspace>;
}

export interface TranslationMemoryEntry {
  original: string;
  translated: string;
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
2. 你有四个工具：search（查询术语）、work_on_long_text（处理长文本分段草稿）、apply_translations（提交翻译）与 skip（跳过无需翻译的条目）
3. 当遇到了**人名**, **地名**, **术语**的时候，应先检查 SEARCH 缓存，如果没有合适候选再调用 search
4. search 有调用预算，User Prompt 会提供 “budgetUsed/budgetTotal”，请优先复用缓存，只有在确实需要时才查询
5. SEARCH缓存的键是归一化术语（小写），例如 "dragonborn"

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
- 如果CSV里存在多个原文完全相同的条目，你只需提交其中一个index，系统会自动把相同译文扩散到其余相同原文

### work_on_long_text(action: "start" | "save" | "finalize", index: number, segments?: Array<{segment_index: number, translated: string}>)
- 用于处理超长条目；当条目标记为长文本时，必须先调用 \`action: "start"\` 建立工作区
- \`start\` 后，系统会把该条目分成多个连续片段，并在后续 User Prompt 的“长文本工作区”中展示
- \`save\` 用于保存一个或多个片段的草稿译文；同一片段允许多次保存，后一次会覆盖前一次
- 当所有片段都完成后，调用 \`action: "finalize"\`；系统会自动拼接并提交整条最终译文
- 不要对长文本条目直接调用 \`apply_translations\`

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
2. **长文本优先建工作区**：如果条目标记为长文本预览，先调用 \`work_on_long_text({ action: "start", index })\`
3. **批量查询**：批量调用search查询缺失的术语（优先检查SEARCH缓存，避免重复查询）
4. **优先翻译**：优先翻译已有search结果或术语标注的条目；长文本则优先完成当前工作区中的未完成片段
5. **批量提交**：短文本可直接调用apply_translations提交；长文本必须在所有片段完成后，调用 work_on_long_text.finalize 自动提交
6. **继续迭代**：如果CSV还有剩余且有预算，重复上述流程；若预算耗尽，翻译剩余的简单条目

**重要原则**：
- search预算在apply后会重置，因此**不要浪费查询结果**，查询后应尽可能翻译所有相关条目
- 避免"查询少量术语→只翻译1-2条→重置预算"的低效模式
- 每次apply应包含所有已准备好的翻译（有search结果、术语标注或无需查询的简单文本）

## 错误处理

如果工具调用失败（如apply_translations的index不存在），系统会在下一轮提供错误信息。
你需要根据错误信息调整参数，重新调用工具。

如果长文本工作区还未完成全部片段，系统会拒绝该 index 的 finalize。

## 进度与预算

- CSV 列表中剩余的行就是需要翻译的条目，长度为 0 表示已经完成；\`已完成/总计\` 字段也会同步显示
- search budget 形如 \`2/6\`，表示本轮已经使用 2 次预算，最多允许 6 次；用尽预算后若仍需要术语，请改用已有信息完成翻译
- 长文本工作区会展示已完成片段数、待完成片段和草稿预览；继续对同一个 index 调用 work_on_long_text 即可多轮返工；全部完成后调用 finalize 自动提交
- recent apply 区块会展示最近一次提交的 index（最多5条）与译文片段，可据此确认提交是否成功

记住：你的唯一输出应该是工具调用（tool_calls），不要输出任何文本解释。`;
}

/**
 * 构建User Prompt
 * 提供当前任务状态（CSV + SEARCH缓存 + 可选错误）
 */
export function buildUserPrompt(state: SessionState): string {
  const maxSearchCacheLines = 80;
  const maxMemoryLines = 40;
  const longTextEntries = state.csv.filter((row) => isLongTextCandidate(row.rawText));
  let prompt = `当前翻译任务状态：\n\n`;

  // 1. CSV待翻译列表
  prompt += `## CSV待翻译 (${state.csv.length}条)\n\n`;
  if (state.csv.length === 0) {
    prompt += `(无待翻译内容)\n\n`;
  } else {
    prompt += "```csv\nindex,original_text\n";
    state.csv.forEach((row) => {
      let visibleText = row.text;
      const workspace = state.longTextWorkspaces[row.index];
      if (workspace) {
        visibleText = `[长文本处理中] 共 ${workspace.segments.length} 段，已完成 ${getCompletedSegmentCount(workspace)} 段，请查看下方长文本工作区`;
      } else if (isLongTextCandidate(row.rawText)) {
        visibleText = `[长文本预览] ${buildLongTextPreview(row.text)}（长文本，请先调用 work_on_long_text.start）`;
      }

      const escapedText = visibleText.replace(/"/g, '""').replace(/\n/g, "\\n");
      prompt += `${row.index},"${escapedText}"\n`;
    });
    prompt += "```\n\n";
  }

  // 1.5 长文本工作区
  prompt += `## 长文本工作区\n\n`;
  const workspaces = Object.values(state.longTextWorkspaces).sort((a, b) => a.index - b.index);
  if (workspaces.length === 0) {
    if (longTextEntries.length === 0) {
      prompt += `(当前没有长文本条目)\n\n`;
    } else {
      const pendingIndexes = longTextEntries.map((row) => row.index).join(", ");
      prompt += `待启动长文本条目: ${pendingIndexes}\n\n`;
    }
  } else {
    workspaces.forEach((workspace) => {
      const completedCount = getCompletedSegmentCount(workspace);
      const completedLabel = isWorkspaceComplete(workspace) ? "已完成，可 finalize" : "处理中";
      const translationPreview = assembleWorkspaceTranslation(workspace);
      prompt += `### index ${workspace.index} (${completedLabel})\n`;
      prompt += `- 原文长度: ${workspace.charLength} 字符 / ${workspace.lineCount} 行\n`;
      prompt += `- 进度: ${completedCount}/${workspace.segments.length}\n`;
      if (translationPreview.trim()) {
        prompt += `- 当前合并预览: ${buildLongTextPreview(translationPreview, 180)}\n`;
      }
      workspace.segments.forEach((segment) => {
        const status = segment.translatedText.trim() ? "done" : "pending";
        prompt += `\n[segment ${segment.segmentIndex} | ${status}]\n`;
        prompt += `source: "${segment.sourceText.replace(/\r?\n/g, "\\n").replace(/"/g, '\\"')}"\n`;
        if (segment.translatedText.trim()) {
          prompt += `draft: "${segment.translatedText.replace(/\r?\n/g, "\\n").replace(/"/g, '\\"')}"\n`;
        }
      });
      prompt += "\n\n";
    });
  }

  // 2. SEARCH缓存
  prompt += `## SEARCH缓存\n\n`;
  const cacheEntries = Object.entries(state.searchCache);
  if (cacheEntries.length === 0) {
    prompt += `(空缓存)\n\n`;
  } else {
    const visible = cacheEntries.slice(0, maxSearchCacheLines);
    visible.forEach(([term, result]) => {
      if (result.status === "ok" && result.candidates.length > 0) {
        const candidates = result.candidates
          .slice(0, 3)
          .map((item) => item.zh)
          .join(" | ");
        prompt += `- ${term} => ${candidates}\n`;
      } else {
        prompt += `- ${term} => (not_found)\n`;
      }
    });
    if (cacheEntries.length > visible.length) {
      prompt += `- ...(省略 ${cacheEntries.length - visible.length} 条)\n`;
    }
    prompt += "\n";
  }

  // 3. 翻译记忆（句级）
  prompt += `## 翻译记忆\n\n`;
  if (!state.translationMemory || state.translationMemory.length === 0) {
    prompt += `(空记忆)\n\n`;
  } else {
    const visibleMemory = state.translationMemory.slice(0, maxMemoryLines);
    visibleMemory.forEach((item) => {
      const original = item.original.replace(/\n/g, "\\n");
      const translated = item.translated.replace(/\n/g, "\\n");
      prompt += `- "${original}" => "${translated}"\n`;
    });
    if (state.translationMemory.length > visibleMemory.length) {
      prompt += `- ...(省略 ${state.translationMemory.length - visibleMemory.length} 条)\n`;
    }
    prompt += "\n";
  }

  // 4. 进度
  prompt += `## 进度\n\n`;
  prompt += `- 已完成: ${state.completedCount}/${state.totalCount}\n`;
  prompt += `- search预算: ${state.searchMeta.budgetUsed}/${state.searchMeta.budgetTotal}\n\n`;

  if (
    state.searchMeta.budgetUsed >= state.searchMeta.budgetTotal &&
    state.searchMeta.budgetTotal > 0
  ) {
    prompt += `⚠️ search预算已耗尽：请立刻使用 apply_translations、work_on_long_text.finalize 或 skip 完成一部分任务(利用现有信息可以翻译的部分)，即可获得更多预算。\n\n`;
  }

  // 5. 历史记录（最多若干条）
  prompt += `## 历史记录（最近 ${state.history.length} 条）\n\n`;
  if (state.history.length === 0) {
    prompt += `(暂无历史记录)\n\n`;
  } else {
    state.history.forEach((entry, idx) => {
      const role = entry.role.toUpperCase();
      const toolInfo = entry.tool ? ` ${entry.tool}` : "";
      const resultInfo = entry.result ? ` => ${entry.result}` : "";
      prompt += `${idx + 1}. [${role}${toolInfo}] ${entry.message}${resultInfo}\n`;
    });
    prompt += `\n`;
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
