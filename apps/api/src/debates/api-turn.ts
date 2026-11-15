// An API Debater's Turns arrive through the API: `POST /debates/:id/turns/:slot` stores one (its body read as it
// arrives, shown to Viewers as drafts), and `PUT …/draft` shows the text so far, for clients whose uploads the edge
// buffers (Cloudflare hands a Worker the body only once it is complete).
import {
  nextSlot,
  parseCustomIdentity,
  submittedTurn,
  truncateToWords,
  type CustomIdentity,
  type ModelClient,
  type ModelId,
  type Turn,
} from '@debate-arena/engine';
import { appendTurn, awaitingOf, setCustomIdentity, type DebateRecord } from '../db/debates';
import { createDraftSender } from '../live/drafts';
import type { DebateEvent } from '../live/events';
import { screenSubmitted } from './screen-submitted';
import type { StepJob } from './start';

export const MAX_API_TURN_BYTES = 65_536;

export class TurnTooLargeError extends Error {
  override name = 'TurnTooLargeError';
}

export interface ApiTurnDeps {
  db: D1Database;
  notify: (debateId: string, event: DebateEvent) => Promise<void>;
  enqueue: (job: StepJob) => Promise<void>;
}

export type ApiTurnResult =
  /** `identity`: the nickname and model this Turn gave its Custom Debater, set now (to be screened). */
  | { status: 201; slotIndex: number; turn: Turn; identitySet: boolean; identity?: CustomIdentity }
  | { status: 400 | 409 | 413; error: string };

/** A nickname and model as a request gives them: unchecked. */
export interface GivenIdentity {
  name?: unknown;
  model?: unknown;
}

const notWaiting = (slot: number) => ({ status: 409 as const, error: `This Debate is not waiting for Turn ${slot}` });
const late = { status: 409 as const, error: "A Custom Debater's name and model can be set only at start or with its first Turn" };
const tooLarge = { status: 413 as const, error: `A Turn may be at most ${MAX_API_TURN_BYTES} bytes` };

/**
 * Whether the Debate waits for this API slot: its step has set the slot's deadline. A Turn sent earlier is refused,
 * so the one step job that set the deadline is the only one that moves the Debate on (two would pay for the next
 * AI Turn twice).
 */
function waitsFor(debate: DebateRecord, slot: number): boolean {
  return debate.visibility !== 'blocked' && awaitingOf(debate)?.slotIndex === slot;
}

const maxWordsOf = (debate: DebateRecord) => debate.setup.format.phases[nextSlot(debate.setup.format, debate.turns)!.phaseIndex]!.maxWords;

/**
 * Reads a text body as it arrives, reporting the text so far after each piece. A character split across pieces is
 * decoded whole. Past `maxBytes` it stops reading and throws TurnTooLargeError.
 */
export async function readTurnBody(body: ReadableStream<Uint8Array>, maxBytes: number, onText: (soFar: string) => void): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new TurnTooLargeError(`More than ${maxBytes} bytes`);
    }
    text += decoder.decode(value, { stream: true });
    onText(text);
  }
  return text + decoder.decode();
}

/**
 * What a Turn's identity does: nothing (none given, or the one already set given again), set it (the Side's first
 * Turn, nothing set at start), or why it is refused.
 */
function identityFor(debate: DebateRecord, given: GivenIdentity): { set: CustomIdentity | null } | { status: 400 | 409; error: string } {
  const identity = parseCustomIdentity(given);
  if (typeof identity === 'string') return { status: 400, error: identity };
  if (!identity.name && !identity.model) return { set: null };
  const side = nextSlot(debate.setup.format, debate.turns)!.side;
  const seat = debate.setup.debaters[side];
  if (seat.kind !== 'api') return late;
  if (seat.name || seat.model) {
    const same =
      (identity.name === undefined || identity.name === seat.name) && (identity.model === undefined || identity.model === seat.model);
    return same ? { set: null } : late;
  }
  return debate.turns.some(turn => turn.side === side) ? late : { set: identity };
}

/**
 * Stores the API Debater's Turn for this slot from the body, and moves the Debate on. While the body arrives,
 * Viewers see it as drafts (cut to the word limit); a Turn that is refused or cut off clears its draft. When two
 * submissions race, the first to finish is stored and the other gets 409.
 */
export async function submitApiTurn(
  deps: ApiTurnDeps,
  debate: DebateRecord,
  slot: number,
  body: ReadableStream<Uint8Array> | null,
  given: GivenIdentity = {},
): Promise<ApiTurnResult> {
  if (!waitsFor(debate, slot)) return notWaiting(slot);
  // Decided before the body is read: a refused identity stores no Turn.
  const identity = identityFor(debate, given);
  if ('error' in identity) return identity;
  const maxWords = maxWordsOf(debate);
  const drafts = createDraftSender(text => deps.notify(debate.id, { type: 'draft', slotIndex: slot, text }));
  let drafted = false;
  const clearDraft = async () => {
    await drafts.stop();
    if (drafted) await deps.notify(debate.id, { type: 'draft', slotIndex: slot, text: '' });
  };

  let text = '';
  try {
    if (body) {
      text = await readTurnBody(body, MAX_API_TURN_BYTES, soFar => {
        const draft = truncateToWords(soFar.trimStart(), maxWords).text;
        if (draft) {
          drafted = true;
          drafts.push(draft);
        }
      });
    }
  } catch (error) {
    await clearDraft();
    return error instanceof TurnTooLargeError ? tooLarge : { status: 400, error: 'The Turn was cut off before it ended' };
  }
  if (!text.trim()) {
    await clearDraft();
    return { status: 400, error: 'The Turn is empty' };
  }

  const turn = submittedTurn(debate.setup, debate.turns, text);
  await drafts.stop();
  // Only into a Debate still running, and only once per slot: a later submission, or a Debate failed meanwhile, loses.
  if (!(await appendTurn(deps.db, debate.id, slot, turn))) {
    await clearDraft();
    return notWaiting(slot);
  }
  // Viewers learn the name before the Turn it comes with.
  const named = identity.set;
  const identitySet = named !== null && (await setCustomIdentity(deps.db, debate.id, turn.side, named));
  if (identitySet) await deps.notify(debate.id, { type: 'debater', side: turn.side, debater: { kind: 'api', ...named } });
  await deps.notify(debate.id, { type: 'turn', slotIndex: slot, turn });
  await deps.enqueue({ debateId: debate.id });
  return { status: 201, slotIndex: slot, turn, identitySet, ...(identitySet && named ? { identity: named } : {}) };
}

/** Shows Viewers the API Debater's Turn so far (the whole text so far, cut to the word limit). */
export async function relayDraft(
  deps: Pick<ApiTurnDeps, 'notify'>,
  debate: DebateRecord,
  slot: number,
  body: ReadableStream<Uint8Array> | null,
): Promise<{ status: 204 } | { status: 409 | 413; error: string }> {
  if (!waitsFor(debate, slot)) return notWaiting(slot);
  let text = '';
  try {
    if (body) text = await readTurnBody(body, MAX_API_TURN_BYTES, () => {});
  } catch {
    return tooLarge;
  }
  await deps.notify(debate.id, { type: 'draft', slotIndex: slot, text: truncateToWords(text.trimStart(), maxWordsOf(debate)).text });
  return { status: 204 };
}

/** Screens a stored Custom Debater's Turn: see screenSubmitted (fails closed, a Flag Unlists). */
export const screenApiTurn = (
  screening: () => Promise<{ client: ModelClient; screener: ModelId }>,
  db: D1Database,
  debateId: string,
  text: string,
): Promise<void> => screenSubmitted(screening, db, debateId, text, 'turn');
