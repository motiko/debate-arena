/** Resolves the signed-in Member for a request, or null. Plan 3 replaces the dev resolver with Better Auth. */
export type MemberResolver = (request: Request) => Promise<string | null>;

const DEV_MEMBER_HEADER = 'x-dev-member';

/** Local development only: trusts the `x-dev-member` header when DEV_AUTH is "true". */
export function devMemberResolver(env: { DEV_AUTH: string }): MemberResolver {
  return async request => {
    if (env.DEV_AUTH !== 'true') return null;
    const member = request.headers.get(DEV_MEMBER_HEADER)?.trim();
    return member ? member : null;
  };
}
