import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { anonymiseMember } from '../account/account';

export interface AuthEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

/** Better Auth settings shared by the app and the test-only instance. Members sign in with GitHub. */
export function authOptions(env: AuthEnv) {
  return {
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
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
