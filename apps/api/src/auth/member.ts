import { getAuth, type AuthEnv } from './auth';

/** Resolves the signed-in Member for a request, or null. A Member's id is their Better Auth user id. */
export type MemberResolver = (request: Request) => Promise<string | null>;

const DEV_MEMBER_HEADER = 'x-dev-member';

/**
 * The Better Auth session's user, if any. Only when DEV_AUTH is "true" (local development) and there is no
 * session does the `x-dev-member` header stand in, so `pnpm dev` works without a GitHub OAuth App.
 */
export function memberResolver(env: AuthEnv & { DEV_AUTH: string }): MemberResolver {
  return async request => {
    const session = await getAuth(env).api.getSession({ headers: request.headers });
    if (session) return session.user.id;
    if (env.DEV_AUTH !== 'true') return null;
    const member = request.headers.get(DEV_MEMBER_HEADER)?.trim();
    return member ? member : null;
  };
}
