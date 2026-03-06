export const LONG_TEXT_CHAR_THRESHOLD = 900;
export const LONG_TEXT_LINE_THRESHOLD = 12;

const LONG_TEXT_PREVIEW_LENGTH = 220;
const TARGET_SEGMENT_LENGTH = 380;
const SOFT_MAX_SEGMENT_LENGTH = 450;
const HARD_MAX_SEGMENT_LENGTH = 520;
const MIN_SEGMENT_LENGTH = 180;

export interface LongTextSegment {
  segmentIndex: number;
  sourceText: string;
  translatedText: string;
}

export interface LongTextWorkspace {
  index: number;
  rawText: string;
  sourceText: string;
  charLength: number;
  lineCount: number;
  segments: LongTextSegment[];
  startedAt: number;
  updatedAt: number;
}

export function countTextLines(text: string): number {
  if (!text) {
    return 0;
  }
  return text.split(/\r?\n/).length;
}

export function isLongTextCandidate(text: string): boolean {
  return (
    (text?.length ?? 0) > LONG_TEXT_CHAR_THRESHOLD ||
    countTextLines(text) > LONG_TEXT_LINE_THRESHOLD
  );
}

export function buildLongTextPreview(text: string, maxLength = LONG_TEXT_PREVIEW_LENGTH): string {
  const normalized = (text || "").replace(/\r?\n/g, "\\n").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function createLongTextWorkspace(params: {
  index: number;
  rawText: string;
  sourceText: string;
}): LongTextWorkspace {
  const now = Date.now();
  return {
    index: params.index,
    rawText: params.rawText,
    sourceText: params.sourceText,
    charLength: params.rawText.length,
    lineCount: countTextLines(params.rawText),
    segments: splitLongText(params.sourceText).map((sourceText, segmentIndex) => ({
      segmentIndex,
      sourceText,
      translatedText: "",
    })),
    startedAt: now,
    updatedAt: now,
  };
}

export function getCompletedSegmentCount(workspace: LongTextWorkspace): number {
  return workspace.segments.filter((segment) => segment.translatedText.trim().length > 0).length;
}

export function isWorkspaceComplete(workspace: LongTextWorkspace): boolean {
  return (
    workspace.segments.length > 0 &&
    workspace.segments.every((segment) => segment.translatedText.trim().length > 0)
  );
}

export function assembleWorkspaceTranslation(workspace: LongTextWorkspace): string {
  return workspace.segments.map((segment) => segment.translatedText).join("");
}

function splitLongText(text: string): string[] {
  const segments: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const remaining = text.length - cursor;
    if (remaining <= HARD_MAX_SEGMENT_LENGTH) {
      segments.push(text.slice(cursor));
      break;
    }

    const window = text.slice(cursor, cursor + HARD_MAX_SEGMENT_LENGTH);
    const preferredWindow = window.slice(0, Math.min(window.length, SOFT_MAX_SEGMENT_LENGTH));

    const preferredBreak = findBreakOffset(preferredWindow);
    const fallbackBreak = findBreakOffset(window);
    const breakOffset = preferredBreak ?? fallbackBreak ?? HARD_MAX_SEGMENT_LENGTH;
    const safeOffset = Math.max(MIN_SEGMENT_LENGTH, Math.min(breakOffset, window.length));

    segments.push(text.slice(cursor, cursor + safeOffset));
    cursor += safeOffset;
  }

  return mergeTinyTrailingSegment(segments);
}

function mergeTinyTrailingSegment(segments: string[]): string[] {
  if (segments.length < 2) {
    return segments;
  }

  const last = segments[segments.length - 1];
  if (last.length >= MIN_SEGMENT_LENGTH) {
    return segments;
  }

  const merged = segments.slice(0, -2);
  merged.push(`${segments[segments.length - 2]}${last}`);
  return merged;
}

function findBreakOffset(text: string): number | null {
  const strategies = [
    /\n\s*\n+/g,
    /\n+/g,
    /[。！？.!?](?:["'”’）)\]]|\s|$)+/g,
    /[，,；;：:](?:\s|$)+/g,
    /\s+/g,
  ];

  for (const pattern of strategies) {
    const matchEnd = findLastMatchEnd(text, pattern);
    if (matchEnd !== null && matchEnd >= MIN_SEGMENT_LENGTH) {
      return matchEnd;
    }
  }

  if (text.length >= TARGET_SEGMENT_LENGTH) {
    return TARGET_SEGMENT_LENGTH;
  }

  return null;
}

function findLastMatchEnd(text: string, pattern: RegExp): number | null {
  let lastMatchEnd: number | null = null;
  let match: RegExpExecArray | null;

  pattern.lastIndex = 0;
  while ((match = pattern.exec(text)) !== null) {
    lastMatchEnd = match.index + match[0].length;
  }

  return lastMatchEnd;
}
