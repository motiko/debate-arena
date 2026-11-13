export const DAILY_QUOTA_POINTS = 6;
export const DEBATE_QUOTA_POINTS = 2;

export function utcDay(at: Date | string): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Spends points from the Member's Quota for the UTC day, atomically; false if it would exceed the daily points. */
export async function spendQuota(db: D1Database, memberId: string, points: number, now: Date): Promise<boolean> {
  if (points > DAILY_QUOTA_POINTS) return false;
  const result = await db
    .prepare(
      `INSERT INTO quota_usage (member_id, day, points) VALUES (?, ?, ?)
       ON CONFLICT (member_id, day) DO UPDATE SET points = points + excluded.points
       WHERE points + excluded.points <= ?`,
    )
    .bind(memberId, utcDay(now), points, DAILY_QUOTA_POINTS)
    .run();
  return result.meta.changes === 1;
}

export async function refundQuota(db: D1Database, memberId: string, points: number, day: string): Promise<void> {
  await db
    .prepare('UPDATE quota_usage SET points = MAX(points - ?, 0) WHERE member_id = ? AND day = ?')
    .bind(points, memberId, day)
    .run();
}

export async function quotaRemaining(db: D1Database, memberId: string, now: Date): Promise<number> {
  const row = await db
    .prepare('SELECT points FROM quota_usage WHERE member_id = ? AND day = ?')
    .bind(memberId, utcDay(now))
    .first<{ points: number }>();
  return DAILY_QUOTA_POINTS - (row?.points ?? 0);
}
