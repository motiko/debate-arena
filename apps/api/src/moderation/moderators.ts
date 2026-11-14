import type { BlockGround, DecisionAction } from '../db/moderation';

export interface ModeratorEnv {
  DB: D1Database;
  DEV_AUTH: string;
  /** Comma-separated GitHub numeric user ids of Moderators. */
  MODERATOR_GITHUB_IDS: string;
}

/**
 * A Moderator is a Member whose linked GitHub account is on the allowlist. Locally (DEV_AUTH "true"), dev
 * Members whose id starts with "dev-mod" count too, so moderation can be tried without GitHub.
 */
export async function isModerator(env: ModeratorEnv, memberId: string): Promise<boolean> {
  if (env.DEV_AUTH === 'true' && memberId.startsWith('dev-mod')) return true;
  const allowed = String(env.MODERATOR_GITHUB_IDS)
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0);
  if (allowed.length === 0) return false;
  const { results } = await env.DB.prepare(`SELECT "accountId" FROM account WHERE "userId" = ? AND "providerId" = 'github'`)
    .bind(memberId)
    .all<{ accountId: string }>();
  return results.some(row => allowed.includes(row.accountId));
}

export type DecisionInput =
  | { action: 'relist'; explanation: string | null }
  | { action: 'block'; ground: BlockGround; groundRef: string; explanation: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ACTIONS: DecisionAction[] = ['relist', 'block'];
const GROUNDS: BlockGround[] = ['illegal', 'terms'];

/** A Block needs its statement of reasons (DSA Art. 17): the ground, what it refers to, and why. */
export function parseDecision(input: unknown): DecisionInput | string {
  if (!isRecord(input)) return 'Send a JSON object with action';
  const action = ACTIONS.find(a => a === input.action);
  if (!action) return 'action must be "relist" or "block"';
  const explanation = typeof input.explanation === 'string' ? input.explanation.trim() : '';
  if (action === 'relist') {
    if (explanation.length > 2000) return 'The explanation must be at most 2000 characters';
    return { action, explanation: explanation || null };
  }
  const ground = GROUNDS.find(g => g === input.ground);
  if (!ground) return 'ground must be "illegal" or "terms"';
  const groundRef = typeof input.groundRef === 'string' ? input.groundRef.trim() : '';
  if (groundRef.length < 1 || groundRef.length > 200) return 'groundRef must name the law or terms clause (1–200 characters)';
  if (explanation.length < 10 || explanation.length > 2000) return 'The explanation must be 10–2000 characters';
  return { action, ground, groundRef, explanation };
}
