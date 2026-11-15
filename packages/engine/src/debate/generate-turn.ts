import type { DebateSetup, Turn, TurnSlot } from '../domain';
import { ApiTurnError, DebateCompleteError, EmptyTurnError, HumanTurnNotSupportedError } from '../errors';
import type { ModelClient } from '../models/client';
import { apiTurnMaxBytes, utf8Length } from '../budget/estimate';
import { trimToLastSentence, truncateToWords } from '../turns/words';
import { buildTurnMessages } from './prompts';
import { nextSlot, turnOutputCap } from './schedule';

export interface GenerateTurnOptions {
  /** Called with the Turn so far as the model writes it, never past the Phase's word limit. */
  onDraft?: (text: string) => void;
}

/** Whether this slot belongs to an API Debater, whose Turn the platform waits for instead of generating. */
export function isApiSlot(setup: DebateSetup, slot: TurnSlot): boolean {
  return setup.debaters[slot.side].kind === 'api';
}

/** The longest start of `text` within `maxBytes` of UTF-8, never splitting a character. */
function cutToBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  let bytes = 0;
  let end = 0;
  for (const ch of text) {
    bytes += utf8Length(ch);
    if (bytes > maxBytes) return { text: text.slice(0, end), truncated: true };
    end += ch.length;
  }
  return { text, truncated: false };
}

/**
 * The next Turn from a submitted text (an API Debater's), under the same rules as an AI Turn: trimmed, cut at the
 * Phase's word limit and then back to its last full sentence. It is also cut at its byte cap (apiTurnMaxBytes), as
 * the Budget reserves for no more.
 */
export function submittedTurn(setup: DebateSetup, priorTurns: Turn[], text: string): Turn {
  const slot = nextSlot(setup.format, priorTurns);
  if (!slot) throw new DebateCompleteError('All Turns of this Debate exist');
  if (!text.trim()) throw new EmptyTurnError('The Turn is empty');
  const maxWords = setup.format.phases[slot.phaseIndex]!.maxWords;
  const byWords = truncateToWords(text.trim(), maxWords);
  const byBytes = cutToBytes(byWords.text, apiTurnMaxBytes(maxWords));
  const truncated = byWords.truncated || byBytes.truncated;
  return { ...slot, text: truncated ? trimToLastSentence(byBytes.text).trim() : byBytes.text, truncated };
}

/** Generates the next AI Turn, cut at the Phase's word limit (back to the last full sentence when cut). */
export async function generateTurn(setup: DebateSetup, priorTurns: Turn[], client: ModelClient, options: GenerateTurnOptions = {}): Promise<Turn> {
  const slot = nextSlot(setup.format, priorTurns);
  if (!slot) throw new DebateCompleteError('All Turns of this Debate exist');
  const debater = setup.debaters[slot.side];
  if (debater.kind === 'api') throw new ApiTurnError(`The ${slot.side} Debater submits its Turns through the API`);
  if (debater.kind !== 'ai') throw new HumanTurnNotSupportedError(`The ${slot.side} Debater is human`);
  const phase = setup.format.phases[slot.phaseIndex]!;

  const { onDraft } = options;
  const request = { model: debater.model, messages: buildTurnMessages(setup, slot, priorTurns), maxOutputTokens: turnOutputCap(phase.maxWords) };
  const response = onDraft
    ? await client.complete(request, {
        onText: soFar => {
          const draft = truncateToWords(soFar.trimStart(), phase.maxWords).text;
          if (draft) onDraft(draft);
        },
      })
    : await client.complete(request);
  if (!response.text.trim()) throw new EmptyTurnError(`${debater.model} returned an empty Turn`);

  const cut = truncateToWords(response.text.trim(), phase.maxWords);
  const truncated = cut.truncated || response.finishReason === 'length';
  return { ...slot, text: truncated ? trimToLastSentence(cut.text) : cut.text, truncated };
}
