// A Custom Debater may give a nickname and the model it says it runs, when its Debate starts. Both are public,
// unverified text, so they are validated here (once, for every Venue) and screened with the Motion.

export interface CustomIdentity {
  name?: string | undefined;
  model?: string | undefined;
}

export const MAX_CUSTOM_NAME_LENGTH = 40;
export const MAX_CUSTOM_MODEL_LENGTH = 60;

// Letters (with their accents), digits, spaces and the punctuation of names and model ids ("qwen2.5:7b",
// "anthropic/claude-x", "O'Brien (bot) #2"). Anything else, invisible or control characters included, is refused.
const ALLOWED = /^[\p{L}\p{M}\p{N} .,_'’\-()/:+#&!?@]+$/u;
// Letters that render as blank space.
const FILLER = /[ᅟᅠㅤﾠ]/u;
const VISIBLE = /[\p{L}\p{N}]/u;

function field(value: unknown, max: number): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const ok = trimmed.length <= max && ALLOWED.test(trimmed) && !FILLER.test(trimmed) && VISIBLE.test(trimmed);
  return ok ? trimmed : null;
}

const refused = (what: string, max: number) => `Custom Debater ${what} must be 1–${max} characters: letters, digits, spaces and simple punctuation`;

/** The cleaned identity (blank fields left out), or why it is refused. */
export function parseCustomIdentity(input: { name?: unknown; model?: unknown }): CustomIdentity | string {
  const name = field(input.name, MAX_CUSTOM_NAME_LENGTH);
  if (name === null) return refused('name', MAX_CUSTOM_NAME_LENGTH);
  const model = field(input.model, MAX_CUSTOM_MODEL_LENGTH);
  if (model === null) return refused('model', MAX_CUSTOM_MODEL_LENGTH);
  return { ...(name ? { name } : {}), ...(model ? { model } : {}) };
}

/** What the screener reads for an identity. */
export function identityText(identity: CustomIdentity): string {
  return [identity.name && `Name: ${identity.name}`, identity.model && `Model: ${identity.model}`].filter(Boolean).join('\n');
}
