// Reports (GLOSSARY: Report): anyone may report a Debate as abusive or illegal (DSA Art. 16 notice). Only
// distinct Members' Reports count toward Unlisting; anonymous ones cannot be told apart, so they only reach
// the Moderator queue.

export const REPORT_UNLIST_THRESHOLD = 5;
export const REPORTS_PER_IP_PER_HOUR = 10;
export const REPORT_REASONS = ['hate', 'harassment', 'violence', 'sexual', 'child_safety', 'illegal_other', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export interface ReportInput {
  reason: ReportReason;
  explanation: string;
  name: string | null;
  email: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length > max) return undefined;
  return trimmed.length > 0 ? trimmed : null;
}

/** Validates a Report; returns an error message for the reporter when it is incomplete. */
export function parseReport(input: unknown): ReportInput | string {
  if (!isRecord(input)) return 'Send a JSON object with reason, explanation and goodFaith';
  const reason = REPORT_REASONS.find(r => r === input.reason);
  if (!reason) return `reason must be one of: ${REPORT_REASONS.join(', ')}`;
  const explanation = typeof input.explanation === 'string' ? input.explanation.trim() : '';
  if (explanation.length < 10 || explanation.length > 1000) return 'The explanation must be 10–1000 characters: say why this Debate is abusive or illegal';
  const name = optionalText(input.name, 100);
  if (name === undefined) return 'name must be text of at most 100 characters';
  const email = optionalText(input.email, 254);
  if (email === undefined || (email !== null && !/^[^\s@]+@[^\s@]+$/.test(email))) return 'email must be a valid email address';
  if (input.goodFaith !== true) return 'Please confirm you report in good faith and the information is accurate';
  return { reason, explanation, name, email };
}

/**
 * The network a rate limit counts: an IPv4 address as is, an IPv6 address by its /64 prefix (one household
 * or server usually gets a whole /64, so per-address limits would be trivial to get around).
 */
export function rateLimitNetwork(ip: string): string {
  const address = ip.trim().toLowerCase();
  if (!address.includes(':')) return address;
  const [head = '', tail] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups
    .slice(0, 4)
    .map(g => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/** A keyed hash, so stored values (e.g. reporters' IPs) cannot be reversed without the secret. */
export async function keyedHash(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret || 'local-development'), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
}
