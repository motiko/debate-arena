import {
  isApiSlot,
  nextSlot,
  isCategory,
  type AiAudienceResult,
  type Category,
  type DebateSetup,
  type Labels,
  type ModelId,
  type ModelPrice,
  type ScreenResult,
  type Side,
  type Turn,
  type Verdict,
} from '@debate-arena/engine';
import type { DebateKind, ReasoningSupport } from '../models/catalog';

/** The price (as the Debate pays it) and reasoning setting of every model a Debate calls, frozen at its start. */
export type ModelSnapshot = Record<ModelId, { price: ModelPrice; reasoning: ReasoningSupport; leastEffort?: string }>;
import type { Visibility } from './moderation';

export type DebateStatus = 'running' | 'complete' | 'failed';

export interface DebateRecord {
  id: string;
  memberId: string;
  status: DebateStatus;
  setup: DebateSetup;
  aiVoters: ModelId[];
  selfJudging: boolean;
  quotaPoints: number;
  budgetReservedMicroUsd: number;
  costMicroUsd: number;
  turns: Turn[];
  verdict: Verdict | null;
  aiAudience: AiAudienceResult | null;
  createdAt: string;
  completedAt: string | null;
  failureReason: string | null;
  visibility: Visibility;
  /** The Motion screen's Flag; it never removes anything (GLOSSARY: Flag). */
  flagged: boolean;
  screen: ScreenResult | null;
  screenedAt: string | null;
  reviewedAt: string | null;
  /** 'batch': a Batch Debate, generated through batch processing and published only when complete. */
  kind: DebateKind;
  /** Null for Debates started before prices were frozen: they use the catalog. */
  models: ModelSnapshot | null;
  /** While waiting for an API Debater's Turn: "<slot index>@<ISO deadline>". */
  turnDeadline: string | null;
  /** AI-assigned when the Motion is screened; null until then, or when labelling failed (GLOSSARY: Category). */
  category: Category | null;
  /** AI-assigned with the Category; empty when unlabelled (GLOSSARY: Tag). */
  tags: string[];
}

export type NewDebate = Pick<
  DebateRecord,
  'id' | 'memberId' | 'setup' | 'aiVoters' | 'selfJudging' | 'quotaPoints' | 'budgetReservedMicroUsd' | 'createdAt'
> & { kind?: DebateKind; models?: ModelSnapshot };

export interface DebateRow {
  id: string;
  member_id: string;
  status: DebateStatus;
  setup_json: string;
  ai_voters_json: string;
  self_judging: number;
  quota_points: number;
  budget_reserved_micro_usd: number;
  cost_micro_usd: number;
  verdict_json: string | null;
  ai_audience_json: string | null;
  created_at: string;
  completed_at: string | null;
  failure_reason: string | null;
  visibility: Visibility;
  flagged: number;
  screen_json: string | null;
  screened_at: string | null;
  reviewed_at: string | null;
  kind: DebateKind;
  models_json: string | null;
  turn_deadline: string | null;
  category: string | null;
  tags_json: string | null;
}

interface TurnRow { phase_index: number; side: Turn['side']; text: string; truncated: number }

export function toRecord(row: DebateRow, turns: Turn[]): DebateRecord {
  return {
    id: row.id,
    memberId: row.member_id,
    status: row.status,
    setup: JSON.parse(row.setup_json) as DebateSetup,
    aiVoters: JSON.parse(row.ai_voters_json) as ModelId[],
    selfJudging: row.self_judging === 1,
    quotaPoints: row.quota_points,
    budgetReservedMicroUsd: row.budget_reserved_micro_usd,
    costMicroUsd: row.cost_micro_usd,
    turns,
    verdict: row.verdict_json ? (JSON.parse(row.verdict_json) as Verdict) : null,
    aiAudience: row.ai_audience_json ? (JSON.parse(row.ai_audience_json) as AiAudienceResult) : null,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    failureReason: row.failure_reason,
    visibility: row.visibility,
    flagged: row.flagged === 1,
    screen: row.screen_json ? (JSON.parse(row.screen_json) as ScreenResult) : null,
    screenedAt: row.screened_at,
    reviewedAt: row.reviewed_at,
    kind: row.kind,
    models: row.models_json ? (JSON.parse(row.models_json) as ModelSnapshot) : null,
    turnDeadline: row.turn_deadline,
    // A Category no longer in the list reads as unlabelled.
    category: isCategory(row.category) ? row.category : null,
    tags: row.tags_json ? (JSON.parse(row.tags_json) as string[]) : [],
  };
}

const changed = (result: D1Result) => result.meta.changes === 1;

export async function createDebate(db: D1Database, debate: NewDebate): Promise<void> {
  await db
    .prepare(
      `INSERT INTO debates (id, member_id, status, setup_json, ai_voters_json, self_judging, quota_points,
         budget_reserved_micro_usd, created_at, kind, models_json)
       VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      debate.id,
      debate.memberId,
      JSON.stringify(debate.setup),
      JSON.stringify(debate.aiVoters),
      debate.selfJudging ? 1 : 0,
      debate.quotaPoints,
      debate.budgetReservedMicroUsd,
      debate.createdAt,
      debate.kind ?? 'live',
      debate.models ? JSON.stringify(debate.models) : null,
    )
    .run();
}

export async function getDebate(db: D1Database, id: string): Promise<DebateRecord | null> {
  const [debates, turns] = await db.batch<DebateRow | TurnRow>([
    db.prepare('SELECT * FROM debates WHERE id = ?').bind(id),
    db
      .prepare('SELECT phase_index, side, text, truncated FROM turns WHERE debate_id = ? ORDER BY slot_index')
      .bind(id),
  ]);
  const row = debates?.results[0] as DebateRow | undefined;
  if (!row) return null;
  const turnRows = (turns?.results ?? []) as TurnRow[];
  return toRecord(
    row,
    turnRows.map(t => ({ phaseIndex: t.phase_index, side: t.side, text: t.text, truncated: t.truncated === 1 })),
  );
}

/** Newest completed, listed Debates first, without their Turns (Unlisted and Blocked ones stay out of feeds). */
export async function listCompletedDebates(db: D1Database, limit: number, before?: string): Promise<DebateRecord[]> {
  const statement = before
    ? db
        .prepare(
          `SELECT * FROM debates WHERE visibility = 'listed' AND status = 'complete' AND completed_at < ? ORDER BY completed_at DESC LIMIT ?`,
        )
        .bind(before, limit)
    : db.prepare(`SELECT * FROM debates WHERE visibility = 'listed' AND status = 'complete' ORDER BY completed_at DESC LIMIT ?`).bind(limit);
  const { results } = await statement.all<DebateRow>();
  return results.map(row => toRecord(row, []));
}

export async function appendTurn(db: D1Database, id: string, slotIndex: number, turn: Turn): Promise<boolean> {
  const result = await db
    .prepare(
      // Only into a Debate still running and not Blocked: a Block can land while the model is writing.
      `INSERT INTO turns (debate_id, slot_index, phase_index, side, text, truncated)
       SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM debates WHERE id = ? AND status = 'running' AND visibility != 'blocked')
       ON CONFLICT (debate_id, slot_index) DO NOTHING`,
    )
    .bind(id, slotIndex, turn.phaseIndex, turn.side, turn.text, turn.truncated ? 1 : 0, id)
    .run();
  return changed(result);
}

/**
 * Sets the deadline for an awaited API slot, unless that slot already has one, and returns the deadline in force
 * (null if the Debate is not running). A redelivered step therefore never moves a deadline.
 */
export async function setTurnDeadline(db: D1Database, id: string, slotIndex: number, deadline: string): Promise<string | null> {
  const prefix = `${slotIndex}@`;
  await db
    .prepare(
      `UPDATE debates SET turn_deadline = ? WHERE id = ? AND status = 'running'
         AND (turn_deadline IS NULL OR substr(turn_deadline, 1, length(?)) != ?)`,
    )
    .bind(`${prefix}${deadline}`, id, prefix, prefix)
    .run();
  const row = await db.prepare(`SELECT turn_deadline FROM debates WHERE id = ? AND status = 'running'`).bind(id).first<{ turn_deadline: string | null }>();
  return row?.turn_deadline?.startsWith(prefix) ? row.turn_deadline.slice(prefix.length) : null;
}

/** The awaited API slot of a running Debate and its deadline, or null when it is not waiting for one. */
export function awaitingOf(debate: DebateRecord): { slotIndex: number; side: Side; deadline: string } | null {
  if (debate.status !== 'running' || !debate.turnDeadline) return null;
  const slot = nextSlot(debate.setup.format, debate.turns);
  if (!slot || !isApiSlot(debate.setup, slot)) return null;
  const prefix = `${debate.turns.length}@`;
  if (!debate.turnDeadline.startsWith(prefix)) return null;
  return { slotIndex: debate.turns.length, side: slot.side, deadline: debate.turnDeadline.slice(prefix.length) };
}

export async function saveVerdict(db: D1Database, id: string, verdict: Verdict): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE debates SET verdict_json = ? WHERE id = ? AND verdict_json IS NULL AND status = 'running'`)
    .bind(JSON.stringify(verdict), id)
    .run();
  return changed(result);
}

export async function completeDebate(
  db: D1Database,
  id: string,
  aiAudience: AiAudienceResult | null,
  at: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE debates SET status = 'complete', ai_audience_json = ?, completed_at = ? WHERE id = ? AND status = 'running'`,
    )
    .bind(aiAudience ? JSON.stringify(aiAudience) : null, at, id)
    .run();
  return changed(result);
}

export async function failDebate(db: D1Database, id: string, reason: string): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE debates SET status = 'failed', failure_reason = ? WHERE id = ? AND status = 'running'`)
    .bind(reason, id)
    .run();
  return changed(result);
}

export async function getBudget(db: D1Database, id: string): Promise<{ reservedMicroUsd: number; spentMicroUsd: number } | null> {
  const row = await db
    .prepare('SELECT budget_reserved_micro_usd, cost_micro_usd FROM debates WHERE id = ?')
    .bind(id)
    .first<{ budget_reserved_micro_usd: number; cost_micro_usd: number }>();
  return row ? { reservedMicroUsd: row.budget_reserved_micro_usd, spentMicroUsd: row.cost_micro_usd } : null;
}

export async function addCost(db: D1Database, id: string, microUsd: number): Promise<void> {
  await db
    .prepare('UPDATE debates SET cost_micro_usd = cost_micro_usd + ? WHERE id = ?')
    .bind(Math.ceil(microUsd), id)
    .run();
}

/** Labels a Debate (the backfill for Debates screened before labelling, or whose labelling failed). */
export async function saveLabels(db: D1Database, id: string, labels: Labels): Promise<void> {
  await db.prepare('UPDATE debates SET category = ?, tags_json = ? WHERE id = ?').bind(labels.category, JSON.stringify(labels.tags), id).run();
}

const UNLABELLED = `visibility = 'listed' AND status = 'complete' AND category IS NULL`;

/** Where a backfill got to: the last Debate it tried, in (completed_at, id) order. */
export interface LabelCursor { completedAt: string; id: string }

/**
 * Listed, completed Debates without a Category, oldest first, after `after` (so ones the labeller could not label
 * are passed over, not tried again forever), and how many there are after it in all.
 */
export async function unlabelledDebates(
  db: D1Database,
  limit: number,
  after?: LabelCursor,
): Promise<{ debates: { id: string; motion: string; completedAt: string }[]; total: number }> {
  const where = after ? `${UNLABELLED} AND (completed_at > ? OR (completed_at = ? AND id > ?))` : UNLABELLED;
  const binds = after ? [after.completedAt, after.completedAt, after.id] : [];
  const [rows, count] = await db.batch([
    db
      .prepare(`SELECT id, json_extract(setup_json, '$.motion.text') AS motion, completed_at AS completedAt FROM debates WHERE ${where} ORDER BY completed_at, id LIMIT ?`)
      .bind(...binds, limit),
    db.prepare(`SELECT COUNT(*) AS n FROM debates WHERE ${where}`).bind(...binds),
  ]);
  return {
    debates: (rows?.results ?? []) as { id: string; motion: string; completedAt: string }[],
    total: ((count?.results[0] as { n: number } | undefined)?.n) ?? 0,
  };
}
