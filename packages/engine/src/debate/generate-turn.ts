import type { DebateSetup, Turn, TurnSlot } from '../domain';
import { ApiTurnError, DebateCompleteError, EmptyTurnError, HumanTurnNotSupportedError } from '../errors';
import type { ModelClient } from '../models/client';
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
