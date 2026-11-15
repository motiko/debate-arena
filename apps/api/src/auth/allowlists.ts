/** True when the Member's linked GitHub account id is on `ids`, a comma-separated list of GitHub numeric user ids. */
export async function onGithubAllowlist(db: D1Database, memberId: string, ids: string): Promise<boolean> {
  const allowed = String(ids)
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0);
  if (allowed.length === 0) return false;
  const { results } = await db
    .prepare(`SELECT "accountId" FROM account WHERE "userId" = ? AND "providerId" = 'github'`)
    .bind(memberId)
    .all<{ accountId: string }>();
  return results.some(row => allowed.includes(row.accountId));
}

export interface UnlimitedQuotaEnv {
  DB: D1Database;
  /** Comma-separated GitHub numeric user ids of Members whose Quota is unlimited. */
  UNLIMITED_QUOTA_GITHUB_IDS: string;
}

/** A Member on the UNLIMITED_QUOTA_GITHUB_IDS allowlist starts Debates without spending Quota (Budget still applies). */
export function hasUnlimitedQuota(env: UnlimitedQuotaEnv, memberId: string): Promise<boolean> {
  return onGithubAllowlist(env.DB, memberId, env.UNLIMITED_QUOTA_GITHUB_IDS);
}
