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

export type Debater = { kind: 'ai'; model: ModelId } | { kind: 'human'; memberId: string };

export interface TurnSlot { phaseIndex: number; side: Side }
export interface Turn extends TurnSlot { text: string; truncated: boolean }

export interface Verdict { winner: Side; reasoning: string; judges: ModelId[] }

export interface DebateSetup { motion: Motion; format: Format; debaters: Record<Side, Debater>; panel: ModelId[] }
