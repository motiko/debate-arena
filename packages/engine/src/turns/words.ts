// Word-aware counting, so languages written without spaces (e.g. Chinese) are counted correctly.
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

function wordSegments(text: string) {
  return [...segmenter.segment(text)].filter(s => s.isWordLike);
}

export function countWords(text: string): number {
  return wordSegments(text).length;
}

export function truncateToWords(text: string, maxWords: number): { text: string; truncated: boolean } {
  const words = wordSegments(text);
  if (words.length <= maxWords) return { text, truncated: false };
  const last = words[maxWords - 1];
  const end = last ? last.index + last.segment.length : 0;
  return { text: text.slice(0, end).trimEnd(), truncated: true };
}
