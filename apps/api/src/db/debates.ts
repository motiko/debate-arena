import type { AiAudienceResult, DebateSetup, ModelId, Turn, Verdict } from '@debate-arena/engine';

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
}

export type NewDebate = Pick<
  DebateRecord,
  'id' | 'memberId' | 'setup' | 'aiVoters' | 'selfJudging' | 'quotaPoints' | 'budgetReservedMicroUsd' | 'createdAt'
>;

interface DebateRow {
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
}

interface TurnRow { phase_index: number; side: Turn['side']; text: string; truncated: number }

function toRecord(row: DebateRow, turns: Turn[]): DebateRecord {
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
  };
}

const changed = (result: D1Result) => result.meta.changes === 1;

export async function createDebate(db: D1Database, debate: NewDebate): Promise<void> {
  await db
    .prepare(
      `INSERT INTO debates (id, member_id, status, setup_json, ai_voters_json, self_judging, quota_points,
         budget_reserved_micro_usd, created_at)
       VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?)`,
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

/** Newest completed Debates first, without their Turns. */
export async function listCompletedDebates(db: D1Database, limit: number, before?: string): Promise<DebateRecord[]> {
  const statement = before
    ? db
        .prepare(
          `SELECT * FROM debates WHERE status = 'complete' AND completed_at < ? ORDER BY completed_at DESC LIMIT ?`,
        )
        .bind(before, limit)
    : db.prepare(`SELECT * FROM debates WHERE status = 'complete' ORDER BY completed_at DESC LIMIT ?`).bind(limit);
  const { results } = await statement.all<DebateRow>();
  return results.map(row => toRecord(row, []));
}

export async function appendTurn(db: D1Database, id: string, slotIndex: number, turn: Turn): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO turns (debate_id, slot_index, phase_index, side, text, truncated) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (debate_id, slot_index) DO NOTHING`,
    )
    .bind(id, slotIndex, turn.phaseIndex, turn.side, turn.text, turn.truncated ? 1 : 0)
    .run();
  return changed(result);
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

export async function addCost(db: D1Database, id: string, microUsd: number): Promise<void> {
  await db
    .prepare('UPDATE debates SET cost_micro_usd = cost_micro_usd + ? WHERE id = ?')
    .bind(Math.ceil(microUsd), id)
    .run();
}
