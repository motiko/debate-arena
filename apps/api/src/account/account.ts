import type { Stance } from '@debate-arena/engine';

export interface MemberExport {
  member: { id: string; name: string; email: string; image: string | null; createdAt: string };
  debates: { id: string; motion: string; status: string; createdAt: string; completedAt: string | null }[];
  votes: { debateId: string; before: Stance; after: Stance | null }[];
}

/** Everything the platform holds about a Member (GDPR access/portability). Null if there is no such Member. */
export async function exportMember(db: D1Database, memberId: string): Promise<MemberExport | null> {
  const [users, debates, votes] = await db.batch([
    db.prepare('SELECT id, name, email, image, "createdAt" FROM "user" WHERE id = ?').bind(memberId),
    db
      .prepare('SELECT id, setup_json, status, created_at, completed_at FROM debates WHERE member_id = ? ORDER BY created_at')
      .bind(memberId),
    db.prepare('SELECT debate_id, before_stance, after_stance FROM audience_votes WHERE member_id = ? ORDER BY before_at').bind(memberId),
  ]);
  const user = users?.results[0] as
    | { id: string; name: string; email: string; image: string | null; createdAt: string | number }
    | undefined;
  if (!user) return null;
  return {
    member: { id: user.id, name: user.name, email: user.email, image: user.image, createdAt: new Date(user.createdAt).toISOString() },
    debates: (debates?.results ?? []).map(row => {
      const d = row as { id: string; setup_json: string; status: string; created_at: string; completed_at: string | null };
      return {
        id: d.id,
        motion: (JSON.parse(d.setup_json) as { motion: { text: string } }).motion.text,
        status: d.status,
        createdAt: d.created_at,
        completedAt: d.completed_at,
      };
    }),
    votes: (votes?.results ?? []).map(row => {
      const v = row as { debate_id: string; before_stance: Stance; after_stance: Stance | null };
      return { debateId: v.debate_id, before: v.before_stance, after: v.after_stance };
    }),
  };
}

/**
 * Unlinks a deleted Member's Debates and Audience Votes from them by re-assigning a fresh random id, and
 * drops their Quota rows. Results stay the same; nothing points back to the person. One D1 batch, which D1
 * runs as a single transaction.
 */
export async function anonymiseMember(db: D1Database, memberId: string): Promise<void> {
  const replacement = `deleted-${crypto.randomUUID()}`;
  await db.batch([
    db.prepare('UPDATE debates SET member_id = ? WHERE member_id = ?').bind(replacement, memberId),
    db.prepare('UPDATE audience_votes SET member_id = ? WHERE member_id = ?').bind(replacement, memberId),
    db.prepare('DELETE FROM quota_usage WHERE member_id = ?').bind(memberId),
  ]);
}
