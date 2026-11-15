import { betterAuth } from 'better-auth';
import { testUtils } from 'better-auth/plugins';
import { env, exports } from 'cloudflare:workers';
import { authOptions } from '../src/auth/auth';

// Test-only instance: same secret, baseURL and D1 as the app, so its signed session cookies are valid there.
const testAuth = betterAuth({ ...authOptions(env), plugins: [testUtils()] });

let counter = 0;

/** Links a GitHub account to a Member the way an OAuth sign-in does (through Better Auth's adapter and hooks). */
export async function linkGithub(userId: string, githubId: string, accessToken = 'gho_test_token'): Promise<void> {
  const ctx = await testAuth.$context;
  await ctx.internalAdapter.createAccount({ userId, providerId: 'github', accountId: githubId, accessToken, scope: 'read:user,user:email' });
}

/** Creates a Member and returns headers carrying a valid signed session cookie for them. */
export async function signedInHeaders(name = 'Test Member'): Promise<{ userId: string; headers: Headers }> {
  const ctx = await testAuth.$context;
  counter += 1;
  const user = await ctx.test.saveUser(ctx.test.createUser({ name, email: `member-${Date.now()}-${counter}@example.test` }));
  const headers = await ctx.test.getAuthHeaders({ userId: user.id });
  return { userId: user.id, headers };
}

/** Session headers for a state-changing Better Auth call: JSON, from the app's own origin. */
export function authPostHeaders(headers: Headers): Headers {
  const h = new Headers(headers);
  h.set('content-type', 'application/json');
  h.set('origin', 'http://localhost:8787');
  return h;
}

/** Creates an API token for the signed-in Member, the way the account page does. */
export async function createApiToken(headers: Headers, body: { name?: string; expiresIn?: number } = {}): Promise<{ id: string; key: string }> {
  const res = await exports.default.fetch('https://api.test/api/auth/api-key/create', {
    method: 'POST',
    headers: authPostHeaders(headers),
    body: JSON.stringify({ name: 'CLI', ...body }),
  });
  if (!res.ok) throw new Error(`Token creation failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as { id: string; key: string };
}
