import type { Stance } from '@debate-arena/engine';

export interface AudienceVote { debateId: string; memberId: string; before: Stance | null; after: Stance | null }

interface VoteRow { debate_id: string; member_id: string; before_stance: Stance; after_stance: Stance | null }

const toVote = (r: VoteRow): AudienceVote => ({
  debateId: r.debate_id,
  memberId: r.member_id,
  before: r.before_stance,
  after: r.after_stance,
});

/** Records a before-vote; false if this Member, or the same person under another Member id, already cast one. */
export async function castBefore(
  db: D1Database,
  debateId: string,
  memberId: string,
  stance: Stance,
  at: string,
  voterKey: string = memberId,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO audience_votes (debate_id, member_id, voter_key, before_stance, before_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .bind(debateId, memberId, voterKey, stance, at)
    .run();
  return result.meta.changes === 1;
}

/** Records an after-vote; false unless a before-vote exists and no after-vote was cast yet. */
export async function castAfter(db: D1Database, debateId: string, memberId: string, stance: Stance, at: string): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE audience_votes SET after_stance = ?, after_at = ?
       WHERE debate_id = ? AND member_id = ? AND after_stance IS NULL`,
    )
    .bind(stance, at, debateId, memberId)
    .run();
  return result.meta.changes === 1;
}

export async function getVote(db: D1Database, debateId: string, memberId: string): Promise<AudienceVote | null> {
  const row = await db
    .prepare('SELECT debate_id, member_id, before_stance, after_stance FROM audience_votes WHERE debate_id = ? AND member_id = ?')
    .bind(debateId, memberId)
    .first<VoteRow>();
  return row ? toVote(row) : null;
}

export async function listVotes(db: D1Database, debateId: string): Promise<AudienceVote[]> {
  const { results } = await db
    .prepare('SELECT debate_id, member_id, before_stance, after_stance FROM audience_votes WHERE debate_id = ?')
    .bind(debateId)
    .all<VoteRow>();
  return results.map(toVote);
}
