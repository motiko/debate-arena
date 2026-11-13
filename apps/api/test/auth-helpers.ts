import { betterAuth } from 'better-auth';
import { testUtils } from 'better-auth/plugins';
import { env } from 'cloudflare:workers';
import { authOptions } from '../src/auth/auth';

// Test-only instance: same secret, baseURL and D1 as the app, so its signed session cookies are valid there.
const testAuth = betterAuth({ ...authOptions(env), plugins: [testUtils()] });

let counter = 0;

/** Creates a Member and returns headers carrying a valid signed session cookie for them. */
export async function signedInHeaders(name = 'Test Member'): Promise<{ userId: string; headers: Headers }> {
  const ctx = await testAuth.$context;
  counter += 1;
  const user = await ctx.test.saveUser(ctx.test.createUser({ name, email: `member-${Date.now()}-${counter}@example.test` }));
  const headers = await ctx.test.getAuthHeaders({ userId: user.id });
  return { userId: user.id, headers };
}
