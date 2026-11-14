import type { AiAudienceResult, Turn, Verdict } from '@debate-arena/engine';

/** Events pushed live to Viewers of a Debate. Viewers load current state over HTTP, then apply these. */
export type DebateEvent =
  | { type: 'turn'; slotIndex: number; turn: Turn }
  | { type: 'verdict'; verdict: Verdict }
  | { type: 'complete'; aiAudience: AiAudienceResult | null }
  | { type: 'failed'; reason: string }
  /** A Moderator Blocked the Debate: Viewers must stop showing it. The room then closes every socket. */
  | { type: 'blocked' };
