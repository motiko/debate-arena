import type { AuthEnv } from '../auth/auth';

/**
 * A stable, non-reversible key for the person behind a Member: an HMAC of their linked sign-in account
 * (e.g. GitHub user id), or of the Member id when no account is linked (local dev). It survives account
 * deletion and re-sign-up, so one person cannot vote twice on a Debate; without the secret it cannot be
 * traced back to the account.
 */
export async function voterKey(env: Pick<AuthEnv, 'DB' | 'BETTER_AUTH_SECRET'>, memberId: string): Promise<string> {
  const account = await env.DB.prepare(
    'SELECT "providerId", "accountId" FROM account WHERE "userId" = ? ORDER BY "createdAt" LIMIT 1',
  )
    .bind(memberId)
    .first<{ providerId: string; accountId: string }>();
  const identity = account ? `${account.providerId}:${account.accountId}` : `member:${memberId}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.BETTER_AUTH_SECRET || 'local-development'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`voter:${identity}`));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
}
