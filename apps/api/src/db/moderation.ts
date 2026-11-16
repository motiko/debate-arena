import type { Labels, ScreenResult } from '@debate-arena/engine';

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
export async function saveScreen(db: D1Database, debateId: string, result: ScreenResult, at: string, labels: Labels | null = null): Promise<boolean> {
  const saved = await db
    .prepare(
      `UPDATE debates SET screen_json = ?, screened_at = ?, flagged = ?,
         visibility = CASE WHEN ? = 1 AND visibility = 'listed' THEN 'unlisted' ELSE visibility END,
         category = ?, tags_json = ?
       WHERE id = ? AND screened_at IS NULL`,
    )
    .bind(JSON.stringify(result), at, result.flagged ? 1 : 0, result.flagged ? 1 : 0, labels?.category ?? null, labels ? JSON.stringify(labels.tags) : null, debateId)
    .run();
  return changed(saved);
}

/**
 * Flags a Debate whose API Turn the screener flagged: Unlisted (if listed) until a Moderator reviews it again, which
 * is why an earlier review no longer counts.
 */
export async function flagDebate(db: D1Database, debateId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE debates SET flagged = 1, reviewed_at = NULL,
         visibility = CASE WHEN visibility = 'listed' THEN 'unlisted' ELSE visibility END
       WHERE id = ?`,
    )
    .bind(debateId)
    .run();
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
  // A Block also ends a Debate that is still running: no more Turns are generated or paid for.
  const stop = db
    .prepare(`UPDATE debates SET status = 'failed', failure_reason = ? WHERE id = ? AND visibility = 'blocked' AND status = 'running'`)
    .bind(BLOCKED_FAILURE_REASON, d.debateId);
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
    ...(d.action === 'block' ? [stop] : []),
  ]);
  return update ? changed(update) : false;
}

/** Stored as a Blocked Debate's internal failure reason when the Block stopped it mid-run. */
export const BLOCKED_FAILURE_REASON = 'Blocked by a Moderator';

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

export type AddReportOutcome = 'added' | 'duplicate' | 'limited';

/**
 * Stores a Report unless this Member already reported the Debate, or its network made `limit` Reports since
 * `windowStart`. The limit is checked in the insert itself, so parallel requests cannot slip past it. IP hashes
 * older than the window are cleared on the way: they are kept only as long as rate limiting needs them.
 */
export async function addReport(db: D1Database, r: NewReport, limit: number, windowStart: string): Promise<AddReportOutcome> {
  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO reports (id, debate_id, reporter_member_id, reporter_name, reporter_email, reason, explanation, ip_hash, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE ? IS NULL OR (SELECT COUNT(*) FROM reports WHERE ip_hash = ? AND created_at > ?) < ?
         ON CONFLICT (debate_id, reporter_member_id) DO NOTHING`,
      )
      .bind(
        r.id,
        r.debateId,
        r.reporterMemberId,
        r.reporterName,
        r.reporterEmail,
        r.reason,
        r.explanation,
        r.ipHash,
        r.createdAt,
        r.ipHash,
        r.ipHash,
        windowStart,
        limit,
      ),
    db.prepare(`UPDATE reports SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND created_at <= ?`).bind(windowStart),
  ]);
  if (inserted && changed(inserted)) return 'added';
  if (r.reporterMemberId) {
    const existing = await db
      .prepare('SELECT 1 AS x FROM reports WHERE debate_id = ? AND reporter_member_id = ?')
      .bind(r.debateId, r.reporterMemberId)
      .first();
    if (existing) return 'duplicate';
  }
  return 'limited';
}

/** Members' Reports on a Debate since its last review (or ever): the count that Unlists it. A Report in the same millisecond as the review counts as after it. */
export async function memberReportsSince(db: D1Database, debateId: string, since: string | null): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM reports WHERE debate_id = ? AND reporter_member_id IS NOT NULL AND created_at >= ?`)
    .bind(debateId, since ?? '')
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface QueueReport {
  reason: string;
  explanation: string;
  reporterName: string | null;
  reporterEmail: string | null;
  byMember: boolean;
  createdAt: string;
}

export interface QueueItem {
  id: string;
  motion: string;
  status: string;
  visibility: Visibility;
  flagged: boolean;
  screen: ScreenResult | null;
  createdAt: string;
  memberReports: number;
  anonymousReports: number;
  reports: QueueReport[];
}

const QUEUE_LIMIT = 50;
const QUEUE_REPORTS = 20;

/**
 * What awaits a Moderator: every Unlisted Debate, and listed ones with Reports since their last review.
 * Oldest first. Holds reporters' contact details, so only Moderators may see it.
 */
export async function moderationQueue(db: D1Database): Promise<QueueItem[]> {
  const { results: debates } = await db
    .prepare(
      `SELECT id, setup_json, status, visibility, flagged, screen_json, created_at, reviewed_at FROM debates d
       WHERE visibility = 'unlisted'
          OR (visibility = 'listed' AND EXISTS (
                SELECT 1 FROM reports r WHERE r.debate_id = d.id AND r.created_at >= COALESCE(d.reviewed_at, '')))
       ORDER BY created_at LIMIT ?`,
    )
    .bind(QUEUE_LIMIT)
    .all<{
      id: string;
      setup_json: string;
      status: string;
      visibility: Visibility;
      flagged: number;
      screen_json: string | null;
      created_at: string;
      reviewed_at: string | null;
    }>();
  if (debates.length === 0) return [];
  const reportSets = await db.batch(
    debates.map(d =>
      db
        .prepare(
          `SELECT reason, explanation, reporter_name, reporter_email, reporter_member_id IS NOT NULL AS by_member, created_at
           FROM reports WHERE debate_id = ? AND created_at >= ? ORDER BY created_at DESC`,
        )
        .bind(d.id, d.reviewed_at ?? ''),
    ),
  );
  return debates.map((d, i) => {
    const rows = (reportSets[i]?.results ?? []) as {
      reason: string;
      explanation: string;
      reporter_name: string | null;
      reporter_email: string | null;
      by_member: number;
      created_at: string;
    }[];
    const memberReports = rows.filter(r => r.by_member === 1).length;
    return {
      id: d.id,
      motion: (JSON.parse(d.setup_json) as { motion: { text: string } }).motion.text,
      status: d.status,
      visibility: d.visibility,
      flagged: d.flagged === 1,
      screen: d.screen_json ? (JSON.parse(d.screen_json) as ScreenResult) : null,
      createdAt: d.created_at,
      memberReports,
      anonymousReports: rows.length - memberReports,
      reports: rows.slice(0, QUEUE_REPORTS).map(r => ({
        reason: r.reason,
        explanation: r.explanation,
        reporterName: r.reporter_name,
        reporterEmail: r.reporter_email,
        byMember: r.by_member === 1,
        createdAt: r.created_at,
      })),
    };
  });
}

/** Whether a Debate has any Reports since its last review. */
export async function hasReportsSince(db: D1Database, debateId: string, since: string | null): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS x FROM reports WHERE debate_id = ? AND created_at >= ? LIMIT 1`).bind(debateId, since ?? '').first();
  return row !== null;
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
