import type { AiHistoryEntry, SessionState } from "../aiPrompts";

const MIN_SEARCH_BUDGET = 8;
const MAX_SEARCH_BUDGET = 30;
const MAX_HISTORY_ENTRIES = 10;
const MAX_TRANSLATION_MEMORY_ENTRIES = 200;

export type HistoryInput = Omit<AiHistoryEntry, "timestamp">;

export function computeSearchBudget(entries: Array<{ text: string }>) {
  if (!entries || entries.length === 0) {
    return MIN_SEARCH_BUDGET;
  }

  const totalCount = entries.length;
  const totalLength = entries.reduce(
    (sum, entry) => sum + (entry.text?.length ?? 0),
    0,
  );

  const entryFactor = Math.ceil(totalCount / 4);
  const lengthFactor = Math.ceil(totalLength / 600);
  const rough = entryFactor + lengthFactor;

  return Math.min(MAX_SEARCH_BUDGET, Math.max(MIN_SEARCH_BUDGET, rough));
}

export function pushHistory(state: SessionState, entry: HistoryInput) {
  state.history.push({
    timestamp: Date.now(),
    ...entry,
  });
  if (state.history.length > MAX_HISTORY_ENTRIES) {
    state.history.splice(0, state.history.length - MAX_HISTORY_ENTRIES);
  }
}

export function upsertTranslationMemoryEntries(
  state: SessionState,
  translations: Array<{ index: number; translated: string }>,
  entryMap: Map<number, { originalText: string }>,
) {
  if (!translations.length) {
    return;
  }

  const memory = [...state.translationMemory];
  const indexByOriginal = new Map<string, number>();
  memory.forEach((item, idx) => {
    indexByOriginal.set(item.original, idx);
  });

  translations.forEach((item) => {
    const entry = entryMap.get(item.index);
    const translated = (item.translated || "").trim();
    if (!entry || !translated) {
      return;
    }

    const original = entry.originalText;
    const existingIdx = indexByOriginal.get(original);
    if (existingIdx !== undefined) {
      memory[existingIdx] = { original, translated };
      return;
    }

    indexByOriginal.set(original, memory.length);
    memory.push({ original, translated });
  });

  state.translationMemory =
    memory.length > MAX_TRANSLATION_MEMORY_ENTRIES
      ? memory.slice(memory.length - MAX_TRANSLATION_MEMORY_ENTRIES)
      : memory;
}
