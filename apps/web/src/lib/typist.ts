// Drafts reach the page in uneven chunks: every 300 ms at first, then further apart, then the whole Turn at once.
// Shown as they come, a speech lurches down the page a paragraph at a time. The Typist writes it out at an even pace
// instead, as chat assistants do: each chunk is spread over about the time the next one is expected to take, so the
// pen keeps moving between chunks and rarely waits; once the Turn is complete it finishes briskly.

/** Never slower than this, in characters per ms, so a short chunk is not dragged out. */
const MIN_SPEED = 0.04;
/** Before a second chunk shows how far apart they are, assume the server's first spacing. */
const FIRST_INTERVAL_MS = 300;
/** A chunk is spread over at least this long, and at most this long, however the chunks are spaced. */
const MIN_SPAN_MS = 120;
const MAX_SPAN_MS = 1800;
/** A finished Turn is written out within this long. */
const FINISH_MS = 1200;

export class Typist {
  #target = '';
  /** How many characters of the target are written; fractional, so slow speeds still advance. */
  #written = 0;
  /** Characters per ms. */
  #speed = MIN_SPEED;
  #interval = FIRST_INTERVAL_MS;
  #lastChunkAt: number | null = null;
  #lastTickAt: number | null = null;
  #complete = false;

  /**
   * The text so far has arrived (each draft is the whole text, not a delta); `complete` when it is the finished
   * Turn. Text that does not continue what is written starts over from where they agree.
   */
  push(text: string, now: number, complete = false): void {
    const written = this.text;
    if (!text.startsWith(written)) this.#written = commonPrefix(text, written);
    if (this.#lastChunkAt !== null && !complete) this.#interval = 0.6 * this.#interval + 0.4 * (now - this.#lastChunkAt);
    this.#lastChunkAt = now;
    // A pen that was waiting starts again now; the wait is not time it can make up in one leap.
    if (this.#lastTickAt === null || this.caughtUp) this.#lastTickAt = now;
    this.#target = text;
    this.#complete = complete;
    const backlog = text.length - this.#written;
    const span = complete ? Math.min(this.#interval, FINISH_MS) : clamp(this.#interval, MIN_SPAN_MS, MAX_SPAN_MS);
    // Keep the current pace when it already clears the backlog in time: slowing down mid-word reads as a stumble.
    this.#speed = Math.max(MIN_SPEED, backlog / span, complete ? this.#speed : 0);
  }

  /** Moves the pen on to `now`. */
  tick(now: number): void {
    const elapsed = now - (this.#lastTickAt ?? now);
    this.#lastTickAt = now;
    this.#written = Math.min(this.#target.length, this.#written + elapsed * this.#speed);
  }

  /** The text written so far, never ending in half a character. */
  get text(): string {
    let end = Math.floor(this.#written);
    if (end > 0 && end < this.#target.length && isHighSurrogate(this.#target.charCodeAt(end - 1))) end -= 1;
    return this.#target.slice(0, end);
  }

  /** Everything that has arrived is written; more may still come. */
  get caughtUp(): boolean {
    return this.#written >= this.#target.length;
  }

  /** The finished Turn is fully written. */
  get done(): boolean {
    return this.#complete && this.caughtUp;
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
