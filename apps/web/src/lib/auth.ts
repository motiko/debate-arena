// Browser calls to Better Auth on the same origin. Plain fetch rather than Better Auth's client keeps island
// JavaScript small; JSON bodies are what the API requires for cookie-authenticated, state-changing calls.

const post = (fetcher: typeof fetch, path: string, body: unknown) =>
  fetcher(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Starts GitHub sign-in and returns the GitHub URL to navigate to; GitHub returns the Member to `callbackPath`. */
export async function signInWithGithub(callbackPath: string, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await post(fetcher, '/api/auth/sign-in/social', { provider: 'github', callbackURL: callbackPath });
  const { url } = await readJson(response);
  if (!response.ok || typeof url !== 'string') throw new Error(`Sign-in failed (${response.status})`);
  return url;
}

export async function signOut(fetcher: typeof fetch = fetch): Promise<void> {
  const response = await post(fetcher, '/api/auth/sign-out', {});
  if (!response.ok) throw new Error(`Sign-out failed (${response.status})`);
}

export type DeleteResult = { ok: true } | { ok: false; code: string; message: string };

/** Deletes the Member's account. Better Auth refuses with SESSION_EXPIRED when the login is too old. */
export async function deleteAccount(fetcher: typeof fetch = fetch): Promise<DeleteResult> {
  const response = await post(fetcher, '/api/auth/delete-user', {});
  if (response.ok) return { ok: true };
  const { code, message } = await readJson(response);
  return {
    ok: false,
    code: typeof code === 'string' ? code : `HTTP_${response.status}`,
    message: typeof message === 'string' ? message : `Deletion failed (${response.status})`,
  };
}
