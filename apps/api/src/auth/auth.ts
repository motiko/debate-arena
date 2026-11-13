import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { anonymiseMember } from '../account/account';

export interface AuthEnv {
  DB: D1Database;
  DEV_AUTH: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

const MIN_SECRET_LENGTH = 32;
// Better Auth's built-in fallback; it only refuses this itself when NODE_ENV is "production", which Workers never set.
const BETTER_AUTH_DEFAULT_SECRET = 'better-auth-secret-12345678901234567890';

/** Fails closed: outside local development a real secret is required for signing cookies and OAuth state. */
function requireSecret(env: AuthEnv): string {
  const secret = env.BETTER_AUTH_SECRET ?? '';
  const weak = secret.length < MIN_SECRET_LENGTH || secret === BETTER_AUTH_DEFAULT_SECRET;
  if (weak && env.DEV_AUTH !== 'true') {
    throw new Error(`BETTER_AUTH_SECRET must be set to at least ${MIN_SECRET_LENGTH} random characters`);
  }
  return secret;
}

/** OAuth tokens are only needed during sign-in, so they are never stored. */
const withoutTokens = <T extends Record<string, unknown>>(account: T) => ({
  data: { ...account, accessToken: null, refreshToken: null, idToken: null },
});

/** Better Auth settings shared by the app and the test-only instance. Members sign in with GitHub. */
export function authOptions(env: AuthEnv) {
  const secret = requireSecret(env);
  return {
    database: env.DB,
    ...(secret ? { secret } : {}),
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    socialProviders: {
      github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
    },
    // One bucket per visitor: Cloudflare puts the client IP in cf-connecting-ip.
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    // In-memory limits reset per isolate on Workers, so counts live in D1.
    rateLimit: { enabled: true, storage: 'database' },
    user: {
      deleteUser: {
        enabled: true,
        // Runs before the user row goes; if it throws, the deletion is aborted.
        beforeDelete: async user => {
          await anonymiseMember(env.DB, user.id);
        },
      },
    },
    databaseHooks: {
      account: {
        create: { before: async account => withoutTokens(account) },
        update: { before: async account => withoutTokens(account) },
      },
    },
  } satisfies BetterAuthOptions;
}

export function makeAuth(env: AuthEnv) {
  return betterAuth(authOptions(env));
}

export type Auth = ReturnType<typeof makeAuth>;

let cached: { env: AuthEnv; auth: Auth } | undefined;

/** One Better Auth instance per isolate (D1 holds no connection pool, so reuse is safe). */
export function getAuth(env: AuthEnv): Auth {
  if (cached?.env !== env) cached = { env, auth: makeAuth(env) };
  return cached.auth;
}
