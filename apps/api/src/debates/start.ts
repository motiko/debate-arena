import {
  CLASSIC_FORMAT,
  isSelfJudging,
  suggestPanel,
  worstCaseBudgetMicroUsd,
  type DebateSetup,
  type ModelId,
} from '@debate-arena/engine';
import { createDebate, failDebate } from '../db/debates';
import { DEBATE_QUOTA_POINTS, refundQuota, spendQuota, utcDay } from '../db/quota';
import { AI_VOTER_COUNT, hasRole, modelsFor, pickAiVoters, priceTable, type Catalog } from '../models/catalog';

export const MAX_MOTION_LENGTH = 300;

export interface StartDebateInput { motion: string; debaters: { for: ModelId; against: ModelId }; panel?: ModelId[]; aiVoters: boolean }
export interface StepJob { debateId: string }
export interface StartDeps {
  db: D1Database;
  catalog: Catalog;
  enqueue: (job: StepJob) => Promise<void>;
  now: () => Date;
  newId: () => string;
}
export type StartResult =
  | { ok: true; id: string; panel: ModelId[]; selfJudging: boolean; budgetReservedMicroUsd: number }
  | { ok: false; status: 400 | 429; error: string };

const bad = (error: string): StartResult => ({ ok: false, status: 400, error });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';

function parseInput(input: unknown): StartDebateInput | string {
  if (!isRecord(input)) return 'Send a JSON object with motion, debaters and aiVoters';
  const { motion, debaters, panel, aiVoters } = input;
  if (!isString(motion)) return 'motion must be a string';
  if (!isRecord(debaters) || !isString(debaters.for) || !isString(debaters.against)) {
    return 'debaters must name a model for each Side: { "for": "...", "against": "..." }';
  }
  if (panel !== undefined && (!Array.isArray(panel) || !panel.every(isString))) return 'panel must be a list of model ids';
  if (aiVoters !== undefined && typeof aiVoters !== 'boolean') return 'aiVoters must be true or false';
  return {
    motion,
    debaters: { for: debaters.for, against: debaters.against },
    ...(panel ? { panel } : {}),
    aiVoters: aiVoters ?? false,
  };
}

/** Validates a new Debate, charges the Member's Quota, reserves its worst-case Budget and queues its first step. */
export async function startDebate(deps: StartDeps, memberId: string, input: unknown): Promise<StartResult> {
  const parsed = parseInput(input);
  if (typeof parsed === 'string') return bad(parsed);

  const motion = parsed.motion.trim();
  if (motion.length < 1 || motion.length > MAX_MOTION_LENGTH) return bad(`Motion must be 1–${MAX_MOTION_LENGTH} characters`);

  for (const model of [parsed.debaters.for, parsed.debaters.against]) {
    if (!hasRole(deps.catalog, model, 'debater')) return bad(`Model ${model} cannot be a Debater`);
  }
  const debaters = {
    for: { kind: 'ai' as const, model: parsed.debaters.for },
    against: { kind: 'ai' as const, model: parsed.debaters.against },
  };

  let panel: ModelId[];
  if (parsed.panel) {
    if (parsed.panel.length !== 1) return bad('A Panel must hold exactly one Judge');
    for (const judge of parsed.panel) {
      if (!hasRole(deps.catalog, judge, 'judge')) return bad(`Model ${judge} cannot be a Judge`);
    }
    panel = parsed.panel;
  } else {
    panel = suggestPanel([debaters.for, debaters.against], modelsFor(deps.catalog, 'judge'));
  }

  const setup: DebateSetup = { motion: { text: motion }, format: CLASSIC_FORMAT, debaters, panel };
  const aiVoters = parsed.aiVoters ? pickAiVoters(deps.catalog, AI_VOTER_COUNT) : [];
  const budgetReservedMicroUsd = worstCaseBudgetMicroUsd(setup, aiVoters, priceTable(deps.catalog));
  const selfJudging = isSelfJudging(panel, [debaters.for, debaters.against]);

  const now = deps.now();
  if (!(await spendQuota(deps.db, memberId, DEBATE_QUOTA_POINTS, now))) {
    return { ok: false, status: 429, error: 'Daily Debate limit reached' };
  }

  const id = deps.newId();
  await createDebate(deps.db, {
    id,
    memberId,
    setup,
    aiVoters,
    selfJudging,
    quotaPoints: DEBATE_QUOTA_POINTS,
    budgetReservedMicroUsd,
    createdAt: now.toISOString(),
  });

  try {
    await deps.enqueue({ debateId: id });
  } catch (error) {
    await failDebate(deps.db, id, 'Could not queue the Debate');
    await refundQuota(deps.db, memberId, DEBATE_QUOTA_POINTS, utcDay(now));
    throw error;
  }

  return { ok: true, id, panel, selfJudging, budgetReservedMicroUsd };
}
