// Word-aware counting, so languages written without spaces (e.g. Chinese) are counted correctly.
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

/** A hyphen joining two words with no space: "low-carbon" is one word to a reader, and to the Debaters. */
const JOINT = /^[-‐‑]$/u;

/** The words of a text, each as its start index and its text. A hyphenated compound is one word. */
function wordSegments(text: string): { index: number; segment: string }[] {
  const segments = [...segmenter.segment(text)];
  const words: { index: number; segment: string }[] = [];
  segments.forEach((s, i) => {
    if (!s.isWordLike) return;
    const joined = i >= 2 && JOINT.test(segments[i - 1]!.segment) && segments[i - 2]!.isWordLike && words.length > 0;
    if (!joined) return void words.push({ index: s.index, segment: s.segment });
    const previous = words.at(-1)!;
    previous.segment = text.slice(previous.index, s.index + s.segment.length);
  });
  return words;
}

export function countWords(text: string): number {
  return wordSegments(text).length;
}

const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
/** Ends with sentence punctuation, optionally followed by closing quotes or brackets. */
const SENTENCE_END = /[.!?…。！？]["'”’»)\]]*$/u;

/**
 * Trims a text that was cut off mid-sentence back to its last full sentence, so a cut Turn does not end in
 * "Net zero by". Keeps the text as is when it already ends a sentence, or when that would drop more than half of it.
 */
export function trimToLastSentence(text: string): string {
  const trimmed = text.trimEnd();
  if (SENTENCE_END.test(trimmed)) return trimmed;
  const sentences = [...sentenceSegmenter.segment(trimmed)];
  const last = sentences.at(-1);
  if (!last || sentences.length < 2) return trimmed;
  const kept = trimmed.slice(0, last.index).trimEnd();
  return SENTENCE_END.test(kept) && kept.length * 2 >= trimmed.length ? kept : trimmed;
}

export function truncateToWords(text: string, maxWords: number): { text: string; truncated: boolean } {
  const words = wordSegments(text);
  if (words.length <= maxWords) return { text, truncated: false };
  const last = words[maxWords - 1];
  const end = last ? last.index + last.segment.length : 0;
  return { text: text.slice(0, end).trimEnd(), truncated: true };
}
