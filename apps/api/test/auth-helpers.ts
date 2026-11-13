import { betterAuth } from 'better-auth';
import { testUtils } from 'better-auth/plugins';
import { env } from 'cloudflare:workers';
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
