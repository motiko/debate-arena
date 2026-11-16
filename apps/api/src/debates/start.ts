import {
  CLASSIC_FORMAT,
  isSelfJudging,
  parseCustomIdentity,
  quotaPointsFor,
  suggestPanel,
  worstCaseBudgetMicroUsd,
  type DebateSetup,
  type Debater,
  type ModelId,
} from '@debate-arena/engine';
import { createDebate, failDebate, type ModelSnapshot } from '../db/debates';
import { DAILY_QUOTA_POINTS, refundQuota, spendQuota, utcDay } from '../db/quota';
import {
  AI_VOTER_COUNT,
  catalogFor,
  hasRole,
  isBatchCapable,
  MAX_AI_VOTERS,
  modelsFor,
  pickAiVoters,
  priceTable,
  screenerFor,
  type Catalog,
  type DebateKind,
} from '../models/catalog';

export const MAX_MOTION_LENGTH = 300;
/** No Debate may reserve more than this ($5), whatever the Member's Quota: a ceiling against mistakes. */
export const MAX_DEBATE_BUDGET_MICRO_USD = 5_000_000;
/** The value of a Side in `debaters` that seats a Custom Debater instead of a model. */
export const API_DEBATER = 'api';
/** The values that seat a Custom Debater: its code name, and the name Members see. */
export const CUSTOM_DEBATER_VALUES: readonly string[] = [API_DEBATER, 'custom'];

/** A Side: a model id, a Custom Debater value, or a Custom Debater with an optional nickname and self-reported model. */
export type SeatInput = ModelId | { kind: 'api' | 'custom'; name?: unknown; model?: unknown };

export interface StartDebateInput {
  motion: string;
  debaters: { for: SeatInput; against: SeatInput };
  panel?: ModelId[];
  /** How many AI Voters (0 for none). The body may also say true (AI_VOTER_COUNT) or false. */
  aiVoters: number;
  batch: boolean;
}
/**
 * One queued step. For a Batch Debate's step, `waits` counts how often it has already waited for batch results
 * and `attempt` which try of the step this is (both reset when the Debate moves on to its next step).
 */
export interface StepJob {
  debateId: string;
  waits?: number;
  attempt?: number;
  /** A deadline check: the Debate fails if this API slot is still empty. */
  deadlineFor?: number;
}
export interface StartDeps {
  db: D1Database;
  catalog: Catalog;
  enqueue: (job: StepJob) => Promise<void>;
  now: () => Date;
  newId: () => string;
  /** The Member's Quota is unlimited: their Debates cost no Quota points. */
  unlimitedQuota?: boolean;
}
export type StartResult =
  | { ok: true; id: string; panel: ModelId[]; selfJudging: boolean; budgetReservedMicroUsd: number }
  | { ok: false; status: 400 | 429; error: string };

/** A Debate as it would start: validated, priced and charged in Quota points, but not created. */
export type PlanResult =
  | {
      ok: true;
      setup: DebateSetup;
      kind: DebateKind;
      aiVoters: ModelId[];
      models: ModelSnapshot;
      budgetMicroUsd: number;
      /** What the AI Voters add to the worst-case Budget: 0 without them. */
      aiVotersMicroUsd: number;
      quotaPoints: number;
      selfJudging: boolean;
      /** Both Debaters are batch-capable models, so this line-up could be a Slow Debate. */
      slowAvailable: boolean;
    }
  | { ok: false; status: 400; error: string };

const bad = (error: string) => ({ ok: false as const, status: 400 as const, error });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isSeat = (v: unknown): v is SeatInput => isString(v) || (isRecord(v) && isString(v.kind) && CUSTOM_DEBATER_VALUES.includes(v.kind));

function parseInput(input: unknown): StartDebateInput | string {
  if (!isRecord(input)) return 'Send a JSON object with motion, debaters and aiVoters';
  const { motion, debaters, panel, aiVoters, batch } = input;
  if (!isString(motion)) return 'motion must be a string';
  if (!isRecord(debaters) || !isSeat(debaters.for) || !isSeat(debaters.against)) {
    return 'debaters must name a model (or "custom") for each Side: { "for": "...", "against": "..." }, '
      + 'or a Custom Debater with a nickname and model: { "kind": "custom", "name": "...", "model": "..." }';
  }
  if (panel !== undefined && (!Array.isArray(panel) || !panel.every(isString))) return 'panel must be a list of model ids';
  const voterCount = aiVoters === true ? AI_VOTER_COUNT : aiVoters === false || aiVoters === undefined ? 0 : aiVoters;
  if (typeof voterCount !== 'number' || !Number.isInteger(voterCount) || voterCount < 0 || voterCount > MAX_AI_VOTERS) {
    return `aiVoters must be true, false or a whole number from 0 to ${MAX_AI_VOTERS}`;
  }
  if (batch !== undefined && typeof batch !== 'boolean') return 'batch must be true or false';
  return {
    motion,
    debaters: { for: debaters.for, against: debaters.against },
    ...(panel ? { panel } : {}),
    aiVoters: voterCount,
    batch: batch ?? false,
  };
}

/** The Judges the platform suggests from: the suggested ones, else the curated ones, when the catalog marks any. */
function suggestedJudges(catalog: Catalog): ModelId[] {
  const suggested = catalog.entries.filter(e => e.suggestedJudge && e.roles.includes('judge')).map(e => e.id);
  if (suggested.length > 0) return suggested;
  const curated = catalog.entries.filter(e => e.curated && e.roles.includes('judge')).map(e => e.id);
  return curated.length > 0 ? curated : modelsFor(catalog, 'judge');
}

const usd = (microUsd: number) => `$${(microUsd / 1e6).toFixed(2)}`;

/**
 * Validates a Debate and prices it: its worst-case Budget, and the Quota points that Budget costs. Every model the
 * Debate will call is frozen at the price it pays (batch prices for a Slow Debate).
 */
export function planDebate(deps: Pick<StartDeps, 'catalog' | 'unlimitedQuota'>, input: unknown): PlanResult {
  const parsed = parseInput(input);
  if (typeof parsed === 'string') return bad(parsed);

  const motion = parsed.motion.trim();
  if (motion.length < 1 || motion.length > MAX_MOTION_LENGTH) return bad(`Motion must be 1–${MAX_MOTION_LENGTH} characters`);

  // A Slow Debate may use only batch-capable models, and pays their batch prices.
  const kind: DebateKind = parsed.batch ? 'batch' : 'live';
  const catalog = catalogFor(deps.catalog, kind);
  const usable = (model: ModelId) => kind === 'live' || isBatchCapable(deps.catalog, model);

  const seat = (input: SeatInput): Debater | string => {
    if (!isString(input) || CUSTOM_DEBATER_VALUES.includes(input)) {
      if (kind === 'batch') return 'A Slow Debate cannot have a Custom Debater';
      const identity = isString(input) ? {} : parseCustomIdentity(input);
      return typeof identity === 'string' ? identity : { kind: 'api', ...identity };
    }
    const model = input;
    if (!hasRole(deps.catalog, model, 'debater')) return `Model ${model} cannot be a Debater`;
    if (!usable(model)) return `Model ${model} cannot take part in a Slow Debate`;
    return { kind: 'ai', model };
  };
  const forSeat = seat(parsed.debaters.for);
  if (typeof forSeat === 'string') return bad(forSeat);
  const againstSeat = seat(parsed.debaters.against);
  if (typeof againstSeat === 'string') return bad(againstSeat);
  const debaters = { for: forSeat, against: againstSeat };
  const slowAvailable = [forSeat, againstSeat].every(d => d.kind === 'ai' && isBatchCapable(deps.catalog, d.model));

  let panel: ModelId[];
  if (parsed.panel) {
    if (parsed.panel.length !== 1) return bad('A Panel must hold exactly one Judge');
    for (const judge of parsed.panel) {
      if (!hasRole(deps.catalog, judge, 'judge')) return bad(`Model ${judge} cannot be a Judge`);
      if (!usable(judge)) return bad(`Model ${judge} cannot take part in a Slow Debate`);
    }
    panel = parsed.panel;
  } else {
    panel = suggestPanel([debaters.for, debaters.against], suggestedJudges(catalog));
  }

  const setup: DebateSetup = { motion: { text: motion }, format: CLASSIC_FORMAT, debaters, panel };
  const aiVoters = pickAiVoters(catalog, parsed.aiVoters);
  const prices = priceTable(catalog);
  const screener = screenerFor(catalog);
  const budgetMicroUsd = worstCaseBudgetMicroUsd(setup, aiVoters, prices, screener);
  const aiVotersMicroUsd = aiVoters.length > 0 ? budgetMicroUsd - worstCaseBudgetMicroUsd(setup, [], prices, screener) : 0;
  if (budgetMicroUsd > MAX_DEBATE_BUDGET_MICRO_USD) {
    return bad(`This line-up could cost up to ${usd(budgetMicroUsd)}; a Debate may reserve at most ${usd(MAX_DEBATE_BUDGET_MICRO_USD)}.`);
  }
  const quotaPoints = deps.unlimitedQuota ? 0 : quotaPointsFor(budgetMicroUsd);
  if (quotaPoints > DAILY_QUOTA_POINTS) {
    return bad(`This line-up needs ${quotaPoints} Quota points; a day has ${DAILY_QUOTA_POINTS}. Choose cheaper models or fewer AI Voters.`);
  }

  const called = [
    ...[debaters.for, debaters.against].flatMap(d => (d.kind === 'ai' ? [d.model] : [])),
    ...panel,
    ...aiVoters,
    screener,
  ];
  const models: ModelSnapshot = {};
  for (const id of called) {
    const entry = catalog.entries.find(e => e.id === id)!;
    models[id] = { price: prices[id]!, reasoning: entry.reasoning, ...(entry.leastEffort ? { leastEffort: entry.leastEffort } : {}) };
  }

  return {
    ok: true,
    setup,
    kind,
    aiVoters,
    models,
    budgetMicroUsd,
    aiVotersMicroUsd,
    quotaPoints,
    selfJudging: isSelfJudging(panel, [debaters.for, debaters.against]),
    slowAvailable,
  };
}

/** Plans a new Debate, charges the Member's Quota, reserves its worst-case Budget and queues its first step. */
export async function startDebate(deps: StartDeps, memberId: string, input: unknown): Promise<StartResult> {
  const plan = planDebate(deps, input);
  if (!plan.ok) return plan;
  const { setup, kind, aiVoters, models, budgetMicroUsd, quotaPoints, selfJudging } = plan;

  const now = deps.now();
  if (quotaPoints > 0 && !(await spendQuota(deps.db, memberId, quotaPoints, now))) {
    return { ok: false, status: 429, error: 'Daily Debate limit reached' };
  }

  const id = deps.newId();
  await createDebate(deps.db, {
    id,
    memberId,
    setup,
    aiVoters,
    selfJudging,
    quotaPoints,
    budgetReservedMicroUsd: budgetMicroUsd,
    createdAt: now.toISOString(),
    kind,
    models,
  });

  try {
    await deps.enqueue({ debateId: id });
  } catch (error) {
    await failDebate(deps.db, id, 'Could not queue the Debate');
    await refundQuota(deps.db, memberId, quotaPoints, utcDay(now));
    throw error;
  }

  return { ok: true, id, panel: setup.panel, selfJudging, budgetReservedMicroUsd: budgetMicroUsd };
}
