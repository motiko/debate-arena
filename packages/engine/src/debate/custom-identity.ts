// A Custom Debater may give a nickname and the model it says it runs. Both are public, unverified text, so they are
// validated here (once, for every Venue) and screened like a Motion.

export interface CustomIdentity {
  name?: string;
  model?: string;
}

export const MAX_CUSTOM_NAME_LENGTH = 40;
export const MAX_CUSTOM_MODEL_LENGTH = 60;

// Control characters, and format characters such as bidi overrides and zero-width spaces, which could disguise a name.
const HIDDEN = /[\p{Cc}\p{Cf}]/u;

function field(value: unknown, max: number): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return HIDDEN.test(value) ? null : undefined;
  return trimmed.length > max || HIDDEN.test(trimmed) ? null : trimmed;
}

/** The cleaned identity (blank fields left out), or why it is refused. */
export function parseCustomIdentity(input: { name?: unknown; model?: unknown }): CustomIdentity | string {
  const name = field(input.name, MAX_CUSTOM_NAME_LENGTH);
  if (name === null) return `Custom Debater name must be 1–${MAX_CUSTOM_NAME_LENGTH} characters, without control characters`;
  const model = field(input.model, MAX_CUSTOM_MODEL_LENGTH);
  if (model === null) return `Custom Debater model must be 1–${MAX_CUSTOM_MODEL_LENGTH} characters, without control characters`;
  return { ...(name ? { name } : {}), ...(model ? { model } : {}) };
}

/** What the screener reads for an identity. */
export function identityText(identity: CustomIdentity): string {
  return [identity.name && `Name: ${identity.name}`, identity.model && `Model: ${identity.model}`].filter(Boolean).join('\n');
}
