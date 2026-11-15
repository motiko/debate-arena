import { getAuth, type AuthEnv } from './auth';

/** Resolves the signed-in Member for a request, or null. A Member's id is their Better Auth user id. */
export type MemberResolver = (request: Request) => Promise<string | null>;

const DEV_MEMBER_HEADER = 'x-dev-member';

/** The key from `Authorization: Bearer <key>`, or null when there is none. */
function bearerKey(request: Request): string | null {
  const match = /^bearer\s+(.*)$/i.exec(request.headers.get('authorization') ?? '');
  const key = match?.[1]?.trim();
  return key ? key : null;
}

/**
 * The Better Auth session's user, if any. With `tokens`, an API token in `Authorization: Bearer` comes next; only
 * routes a CLI needs opt in, so a token cannot vote, moderate or manage tokens. Only when DEV_AUTH is "true"
 * (local development) and nothing else signed in does the `x-dev-member` header stand in, so `pnpm dev` works
 * without a GitHub OAuth App.
 */
export function memberResolver(env: AuthEnv & { DEV_AUTH: string }, options: { tokens?: boolean } = {}): MemberResolver {
  return async request => {
    const auth = getAuth(env);
    const session = await auth.api.getSession({ headers: request.headers });
    if (session) return session.user.id;
    const key = options.tokens ? bearerKey(request) : null;
    if (key) {
      const { valid, key: token } = await auth.api.verifyApiKey({ body: { key } });
      if (valid && token) return token.referenceId;
    }
    if (env.DEV_AUTH !== 'true') return null;
    const member = request.headers.get(DEV_MEMBER_HEADER)?.trim();
    return member ? member : null;
  };
}
