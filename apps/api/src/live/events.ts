import type { AiAudienceResult, Turn, Verdict } from '@debate-arena/engine';

/** Events pushed live to Viewers of a Debate. Viewers load current state over HTTP, then apply these. */
export type DebateEvent =
  /** The Turn in this slot as written so far (the whole text, never past its word limit); empty text clears it. */
  | { type: 'draft'; slotIndex: number; text: string }
  /** The Debate waits for an API Debater's Turn in this slot until the deadline (ISO-8601 UTC). */
  | { type: 'awaiting'; slotIndex: number; deadline: string }
  | { type: 'turn'; slotIndex: number; turn: Turn }
  | { type: 'verdict'; verdict: Verdict }
  | { type: 'complete'; aiAudience: AiAudienceResult | null }
  | { type: 'failed'; reason: string }
  /** A Moderator Blocked the Debate: Viewers must stop showing it. The room then closes every socket. */
  | { type: 'blocked' };
