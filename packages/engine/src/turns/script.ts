/**
 * The writing system of a text, a cheap stand-in for its language: a reply in another script than the Motion is
 * certainly in another language (the reverse does not hold: English and German share Latin). Chinese and Japanese
 * share Han characters, so they are one group.
 */
export type Script = 'latin' | 'cyrillic' | 'greek' | 'cjk' | 'hangul' | 'arabic' | 'hebrew' | 'devanagari' | 'thai' | 'other';

const SCRIPTS: [Script, RegExp][] = [
  ['latin', /\p{Script=Latin}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['greek', /\p{Script=Greek}/u],
  ['cjk', /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ['hangul', /\p{Script=Hangul}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['hebrew', /\p{Script=Hebrew}/u],
  ['devanagari', /\p{Script=Devanagari}/u],
  ['thai', /\p{Script=Thai}/u],
];

/** The script most of the text's letters are written in, or null when it has no letters. */
export function dominantScript(text: string): Script | null {
  const counts = new Map<Script, number>();
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue;
    const script = SCRIPTS.find(([, pattern]) => pattern.test(ch))?.[0] ?? 'other';
    counts.set(script, (counts.get(script) ?? 0) + 1);
  }
  let best: Script | null = null;
  for (const [script, count] of counts) if (best === null || count > counts.get(best)!) best = script;
  return best;
}
