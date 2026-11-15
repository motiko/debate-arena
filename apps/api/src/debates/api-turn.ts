// An API Debater's Turns arrive through the API: `POST /debates/:id/turns/:slot` stores one (its body read as it
// arrives, shown to Viewers as drafts), and `PUT …/draft` shows the text so far, for clients whose uploads the edge
// buffers (Cloudflare hands a Worker the body only once it is complete).
import { isApiSlot, nextSlot, screenMotion, submittedTurn, truncateToWords, type ModelClient, type ModelId, type Turn } from '@debate-arena/engine';
import { appendTurn, type DebateRecord } from '../db/debates';
import { flagDebate } from '../db/moderation';
import { createDraftSender } from '../live/drafts';
import type { DebateEvent } from '../live/events';
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
  | { status: 201; slotIndex: number; turn: Turn }
  | { status: 400 | 409 | 413; error: string };

const notWaiting = (slot: number) => ({ status: 409 as const, error: `This Debate is not waiting for Turn ${slot}` });
const tooLarge = { status: 413 as const, error: `A Turn may be at most ${MAX_API_TURN_BYTES} bytes` };

/** Whether the Debate's next slot is this one, and an API Debater's, while it runs. */
function waitsFor(debate: DebateRecord, slot: number): boolean {
  if (debate.status !== 'running' || debate.visibility === 'blocked' || debate.turns.length !== slot) return false;
  const next = nextSlot(debate.setup.format, debate.turns);
  return next !== null && isApiSlot(debate.setup, next);
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
 * Stores the API Debater's Turn for this slot from the body, and moves the Debate on. While the body arrives,
 * Viewers see it as drafts (cut to the word limit); a Turn that is refused or cut off clears its draft. When two
 * submissions race, the first to finish is stored and the other gets 409.
 */
export async function submitApiTurn(
  deps: ApiTurnDeps,
  debate: DebateRecord,
  slot: number,
  body: ReadableStream<Uint8Array> | null,
): Promise<ApiTurnResult> {
  if (!waitsFor(debate, slot)) return notWaiting(slot);
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
  await deps.notify(debate.id, { type: 'turn', slotIndex: slot, turn });
  await deps.enqueue({ debateId: debate.id });
  return { status: 201, slotIndex: slot, turn };
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

/**
 * Screens a stored API Turn, as a Motion is screened: a Flag Unlists the Debate for a Moderator to review; it never
 * removes anything. It fails closed: a failed screen, or no screener to ask, Flags.
 */
export async function screenApiTurn(
  screening: () => Promise<{ client: ModelClient; screener: ModelId }>,
  db: D1Database,
  debateId: string,
  text: string,
): Promise<void> {
  let flagged = true;
  try {
    const { client, screener } = await screening();
    flagged = (await screenMotion(text, screener, client, { what: 'turn' })).flagged;
  } catch (error) {
    console.error(`Could not screen an API Turn of Debate ${debateId}`, error);
  }
  if (flagged) await flagDebate(db, debateId);
}
