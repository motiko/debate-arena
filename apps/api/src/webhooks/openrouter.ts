// OpenRouter's batch webhook: when a batch ends, the Debate waiting on it moves on at once instead of at its next
// poll. Polling stays as the fallback, so a missed or rejected webhook only costs time.

/** OpenRouter rejects signatures more than 5 minutes off; so do we. */
const TOLERANCE_SECONDS = 300;

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Checks `X-OpenRouter-Signature: t=<unix seconds>,v1=<hex>`, an HMAC-SHA256 of `${t},${rawBody}` with the workspace's
 * webhook signing secret (OpenRouter's reference receiver), within 5 minutes of now.
 */
export async function verifySignature(secret: string, header: string, rawBody: string, nowSeconds: number): Promise<boolean> {
  const parts = Object.fromEntries(header.split(',').map(part => part.trim().split('=', 2) as [string, string]));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1 || !/^\d+$/.test(t) || Math.abs(nowSeconds - Number(t)) > TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t},${rawBody}`)));
  return constantTimeEqual(expected, v1.toLowerCase());
}

const ENDED = new Set(['batch.completed', 'batch.failed', 'batch.expired', 'batch.cancelled']);

/** The batch id of an event that means a batch has ended, or null. */
export function endedBatchId(rawBody: string): string | null {
  try {
    const event = JSON.parse(rawBody) as { type?: unknown; data?: { id?: unknown } };
    return typeof event.type === 'string' && ENDED.has(event.type) && typeof event.data?.id === 'string' ? event.data.id : null;
  } catch {
    return null;
  }
}
