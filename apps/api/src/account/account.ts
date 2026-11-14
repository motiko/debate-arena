import type { Stance } from '@debate-arena/engine';

export interface MemberExport {
  member: { id: string; name: string; email: string; image: string | null; createdAt: string };
  debates: {
    id: string;
    motion: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
    visibility: string;
    /** The statement of reasons when a Moderator Blocked it (DSA Art. 17). */
    blocked?: { decidedAt: string; ground: string | null; groundRef: string | null; explanation: string | null };
  }[];
  votes: { debateId: string; before: Stance; after: Stance | null }[];
  sessions: { createdAt: string; expiresAt: string; ipAddress: string | null; userAgent: string | null }[];
  accounts: { provider: string; accountId: string; scope: string | null; linkedAt: string }[];
  quota: { day: string; points: number }[];
  reports: { debateId: string; reason: string; explanation: string; createdAt: string }[];
  moderationDecisions: {
    debateId: string;
    action: string;
    ground: string | null;
    groundRef: string | null;
    explanation: string | null;
    decidedAt: string;
  }[];
}

/** Everything the platform holds about a Member (GDPR access/portability). Null if there is no such Member. */
export async function exportMember(db: D1Database, memberId: string): Promise<MemberExport | null> {
  const [users, debates, votes, sessions, accounts, quota, reports, decisions, blocks] = await db.batch([
    db.prepare('SELECT id, name, email, image, "createdAt" FROM "user" WHERE id = ?').bind(memberId),
    db
      .prepare('SELECT id, setup_json, status, created_at, completed_at, visibility FROM debates WHERE member_id = ? ORDER BY created_at')
      .bind(memberId),
    db.prepare('SELECT debate_id, before_stance, after_stance FROM audience_votes WHERE member_id = ? ORDER BY before_at').bind(memberId),
    // Session tokens and OAuth tokens are secrets, never exported.
    db
      .prepare('SELECT "createdAt", "expiresAt", "ipAddress", "userAgent" FROM session WHERE "userId" = ? ORDER BY "createdAt"')
      .bind(memberId),
    db.prepare('SELECT "providerId", "accountId", scope, "createdAt" FROM account WHERE "userId" = ?').bind(memberId),
    db.prepare('SELECT day, points FROM quota_usage WHERE member_id = ? ORDER BY day').bind(memberId),
    db
      .prepare('SELECT debate_id, reason, explanation, created_at FROM reports WHERE reporter_member_id = ? ORDER BY created_at')
      .bind(memberId),
    db
      .prepare(
        'SELECT debate_id, action, ground, ground_ref, explanation, decided_at FROM moderation_decisions WHERE moderator_id = ? ORDER BY decided_at',
      )
      .bind(memberId),
    // Blocks of this Member's own Debates: their statement of reasons.
    db
      .prepare(
        `SELECT m.debate_id, m.ground, m.ground_ref, m.explanation, m.decided_at FROM moderation_decisions m
         JOIN debates d ON d.id = m.debate_id WHERE d.member_id = ? AND m.action = 'block'`,
      )
      .bind(memberId),
  ]);
  const user = users?.results[0] as
    | { id: string; name: string; email: string; image: string | null; createdAt: string | number }
    | undefined;
  if (!user) return null;
  const blockRows = (blocks?.results ?? []) as {
    debate_id: string;
    ground: string | null;
    ground_ref: string | null;
    explanation: string | null;
    decided_at: string;
  }[];
  return {
    member: { id: user.id, name: user.name, email: user.email, image: user.image, createdAt: new Date(user.createdAt).toISOString() },
    debates: (debates?.results ?? []).map(row => {
      const d = row as { id: string; setup_json: string; status: string; created_at: string; completed_at: string | null; visibility: string };
      const block = blockRows.find(b => b.debate_id === d.id);
      return {
        id: d.id,
        motion: (JSON.parse(d.setup_json) as { motion: { text: string } }).motion.text,
        status: d.status,
        createdAt: d.created_at,
        completedAt: d.completed_at,
        visibility: d.visibility,
        ...(block ? { blocked: { decidedAt: block.decided_at, ground: block.ground, groundRef: block.ground_ref, explanation: block.explanation } } : {}),
      };
    }),
    votes: (votes?.results ?? []).map(row => {
      const v = row as { debate_id: string; before_stance: Stance; after_stance: Stance | null };
      return { debateId: v.debate_id, before: v.before_stance, after: v.after_stance };
    }),
    sessions: (sessions?.results ?? []).map(row => {
      const s = row as { createdAt: string | number; expiresAt: string | number; ipAddress: string | null; userAgent: string | null };
      return {
        createdAt: new Date(s.createdAt).toISOString(),
        expiresAt: new Date(s.expiresAt).toISOString(),
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
      };
    }),
    accounts: (accounts?.results ?? []).map(row => {
      const a = row as { providerId: string; accountId: string; scope: string | null; createdAt: string | number };
      return { provider: a.providerId, accountId: a.accountId, scope: a.scope, linkedAt: new Date(a.createdAt).toISOString() };
    }),
    quota: (quota?.results ?? []) as { day: string; points: number }[],
    reports: ((reports?.results ?? []) as { debate_id: string; reason: string; explanation: string; created_at: string }[]).map(r => ({
      debateId: r.debate_id,
      reason: r.reason,
      explanation: r.explanation,
      createdAt: r.created_at,
    })),
    moderationDecisions: (
      (decisions?.results ?? []) as {
        debate_id: string;
        action: string;
        ground: string | null;
        ground_ref: string | null;
        explanation: string | null;
        decided_at: string;
      }[]
    ).map(m => ({ debateId: m.debate_id, action: m.action, ground: m.ground, groundRef: m.ground_ref, explanation: m.explanation, decidedAt: m.decided_at })),
  };
}

// SQLite evaluates randomblob() per row, so every row gets its own id and rows cannot be grouped by person.
const FRESH_ID = `'deleted-' || lower(hex(randomblob(16)))`;

/**
 * Unlinks a deleted Member's Debates, Audience Votes, Reports and Moderator decisions from them by giving each row its own random id,
 * and drops their Quota rows. Results stay the same; nothing points back to the person or links their rows
 * together. One D1 batch, which D1 runs as a single transaction.
 */
export async function anonymiseMember(db: D1Database, memberId: string): Promise<void> {
  await db.batch([
    db.prepare(`UPDATE debates SET member_id = ${FRESH_ID} WHERE member_id = ?`).bind(memberId),
    db.prepare(`UPDATE audience_votes SET member_id = ${FRESH_ID} WHERE member_id = ?`).bind(memberId),
    // Reports keep counting toward Unlisting, and decisions stay on record, without pointing to the person.
    db.prepare(`UPDATE reports SET reporter_member_id = ${FRESH_ID} WHERE reporter_member_id = ?`).bind(memberId),
    db.prepare(`UPDATE moderation_decisions SET moderator_id = ${FRESH_ID} WHERE moderator_id = ?`).bind(memberId),
    db.prepare('DELETE FROM quota_usage WHERE member_id = ?').bind(memberId),
  ]);
}
