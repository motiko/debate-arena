// Domain types. Names follow GLOSSARY.md.

export type Side = 'for' | 'against';
export type Stance = Side | 'undecided';
/** OpenRouter model id, `provider/model`. */
export type ModelId = string;

export interface Motion { text: string }

export interface Phase { name: string; order: Side[]; maxWords: number; maxSeconds: number }

export interface RubricCriterion { name: string; description: string }
export interface Rubric { criteria: RubricCriterion[] }

export interface OxfordVotingMethod { kind: 'oxford'; windowDays: number }
export type VotingMethod = OxfordVotingMethod;

export interface Format { id: string; name: string; phases: Phase[]; rubric: Rubric; votingMethod: VotingMethod }

/**
 * 'api': a Custom Debater, whose Turns the starting Member submits through the API. It may carry a nickname and the
 * model it says it runs (self-reported, never verified).
 */
export type Debater = { kind: 'ai'; model: ModelId } | { kind: 'human'; memberId: string } | { kind: 'api'; name?: string | undefined; model?: string | undefined };

export interface TurnSlot { phaseIndex: number; side: Side }
export interface Turn extends TurnSlot { text: string; truncated: boolean }

/** A Judge's mark from 1 to 10 for each Side on one Rubric criterion (GLOSSARY: Rubric Score). */
export interface RubricScore { criterion: string; for: number; against: number }

/** How sure a Judge is that the Motion stands or falls (GLOSSARY: Confidence). `narrow` is "too close to call". */
export type Confidence = 'clear' | 'likely' | 'narrow';
export type ClaimStatus = 'supported' | 'disputed' | 'false';
/** A factual claim one Side made, checked against the Judge's own knowledge, without sources (GLOSSARY: Claim Check). */
export interface ClaimCheck { side: Side; claim: string; status: ClaimStatus; note: string }

/** One Judge's answer (GLOSSARY: Ballot). `scores` is empty when the Judge gave no valid Rubric Scores. */
export interface Ballot {
  judge: ModelId;
  winner: Side;
  confidence: Confidence;
  reasoning: string;
  crux: string;
  scores: RubricScore[];
  claims: ClaimCheck[];
}

/**
 * The Panel's decision: `winner` For means the Motion stands, Against that it falls (ADR 0008). The other fields are
 * the lead Ballot's: the first, in Panel order, on the majority Side. Verdicts stored before ADR 0008 have
 * `confidence: null`, an empty crux and no claims or Ballots; before Rubric Scores, no scores.
 */
export interface Verdict {
  winner: Side;
  reasoning: string;
  scores: RubricScore[];
  judges: ModelId[];
  confidence: Confidence | null;
  crux: string;
  claims: ClaimCheck[];
  ballots: Ballot[];
}

export interface DebateSetup { motion: Motion; format: Format; debaters: Record<Side, Debater>; panel: ModelId[] }
