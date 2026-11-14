import type { ScreenResult } from '@debate-arena/engine';

export type Visibility = 'listed' | 'unlisted' | 'blocked';
export type DecisionAction = 'relist' | 'block';
export type DecisionSource = 'ai_flag' | 'reports' | 'moderator';
export type BlockGround = 'illegal' | 'terms';

export interface ModerationDecision {
  id: string;
  debateId: string;
  action: DecisionAction;
  source: DecisionSource;
  automatedDetection: boolean;
  ground: BlockGround | null;
  groundRef: string | null;
  explanation: string | null;
  moderatorId: string;
  decidedAt: string;
}

const changed = (result: D1Result) => result.meta.changes === 1;

/** Stores the Motion screen once. A Flag Unlists a listed Debate; it never removes anything. */
export async function saveScreen(db: D1Database, debateId: string, result: ScreenResult, at: string): Promise<boolean> {
  const saved = await db
    .prepare(
      `UPDATE debates SET screen_json = ?, screened_at = ?, flagged = ?,
         visibility = CASE WHEN ? = 1 AND visibility = 'listed' THEN 'unlisted' ELSE visibility END
       WHERE id = ? AND screened_at IS NULL`,
    )
    .bind(JSON.stringify(result), at, result.flagged ? 1 : 0, result.flagged ? 1 : 0, debateId)
    .run();
  return changed(saved);
}

/** Unlists a listed Debate that reached the Report threshold. */
export async function unlistForReports(db: D1Database, debateId: string): Promise<boolean> {
  return changed(await db.prepare(`UPDATE debates SET visibility = 'unlisted' WHERE id = ? AND visibility = 'listed'`).bind(debateId).run());
}

/**
 * Records a Moderator's decision and applies it, in one transaction. A Blocked Debate is final: a later
 * decision changes nothing and returns false.
 */
export async function recordDecision(db: D1Database, d: ModerationDecision): Promise<boolean> {
  const visibility: Visibility = d.action === 'block' ? 'blocked' : 'listed';
  const [update] = await db.batch([
    db
      .prepare(`UPDATE debates SET visibility = ?, reviewed_at = ? WHERE id = ? AND visibility != 'blocked'`)
      .bind(visibility, d.decidedAt, d.debateId),
    // Inserted only if the update applied (the Debate is now in the decided state at this review time).
    db
      .prepare(
        `INSERT INTO moderation_decisions (id, debate_id, action, source, automated_detection, ground, ground_ref,
           explanation, moderator_id, decided_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
      )
      .bind(
        d.id,
        d.debateId,
        d.action,
        d.source,
        d.automatedDetection ? 1 : 0,
        d.ground,
        d.groundRef,
        d.explanation,
        d.moderatorId,
        d.decidedAt,
      ),
  ]);
  return update ? changed(update) : false;
}

export interface NewReport {
  id: string;
  debateId: string;
  reporterMemberId: string | null;
  reporterName: string | null;
  reporterEmail: string | null;
  reason: string;
  explanation: string;
  ipHash: string | null;
  createdAt: string;
}

/** Stores a Report. False when this Member already reported this Debate. */
export async function addReport(db: D1Database, r: NewReport): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO reports (id, debate_id, reporter_member_id, reporter_name, reporter_email, reason, explanation, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (debate_id, reporter_member_id) DO NOTHING`,
    )
    .bind(r.id, r.debateId, r.reporterMemberId, r.reporterName, r.reporterEmail, r.reason, r.explanation, r.ipHash, r.createdAt)
    .run();
  return changed(result);
}

/** Members' Reports on a Debate since its last review (or ever): the count that Unlists it. */
export async function memberReportsSince(db: D1Database, debateId: string, since: string | null): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM reports WHERE debate_id = ? AND reporter_member_id IS NOT NULL AND created_at > ?`)
    .bind(debateId, since ?? '')
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Reports from one (hashed) IP since a time, for rate limiting. */
export async function reportsFromIpSince(db: D1Database, ipHash: string, since: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM reports WHERE ip_hash = ? AND created_at > ?`)
    .bind(ipHash, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

interface DecisionRow {
  id: string;
  debate_id: string;
  action: DecisionAction;
  source: DecisionSource;
  automated_detection: number;
  ground: BlockGround | null;
  ground_ref: string | null;
  explanation: string | null;
  moderator_id: string;
  decided_at: string;
}

/** The decision that Blocked a Debate, or null. */
export async function getBlockDecision(db: D1Database, debateId: string): Promise<ModerationDecision | null> {
  const row = await db
    .prepare(`SELECT * FROM moderation_decisions WHERE debate_id = ? AND action = 'block' ORDER BY decided_at DESC LIMIT 1`)
    .bind(debateId)
    .first<DecisionRow>();
  if (!row) return null;
  return {
    id: row.id,
    debateId: row.debate_id,
    action: row.action,
    source: row.source,
    automatedDetection: row.automated_detection === 1,
    ground: row.ground,
    groundRef: row.ground_ref,
    explanation: row.explanation,
    moderatorId: row.moderator_id,
    decidedAt: row.decided_at,
  };
}
