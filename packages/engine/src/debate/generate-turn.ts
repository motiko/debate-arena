import type { DebateSetup, Turn } from '../domain';
import { DebateCompleteError, EmptyTurnError, HumanTurnNotSupportedError } from '../errors';
import type { ModelClient } from '../models/client';
import { trimToLastSentence, truncateToWords } from '../turns/words';
import { buildTurnMessages } from './prompts';
import { nextSlot, turnOutputCap } from './schedule';

/** Generates the next AI Turn, cut at the Phase's word limit (back to the last full sentence when cut). */
export async function generateTurn(setup: DebateSetup, priorTurns: Turn[], client: ModelClient): Promise<Turn> {
  const slot = nextSlot(setup.format, priorTurns);
  if (!slot) throw new DebateCompleteError('All Turns of this Debate exist');
  const debater = setup.debaters[slot.side];
  if (debater.kind !== 'ai') throw new HumanTurnNotSupportedError(`The ${slot.side} Debater is human`);
  const phase = setup.format.phases[slot.phaseIndex]!;

  const response = await client.complete({
    model: debater.model,
    messages: buildTurnMessages(setup, slot, priorTurns),
    maxOutputTokens: turnOutputCap(phase.maxWords),
  });
  if (!response.text.trim()) throw new EmptyTurnError(`${debater.model} returned an empty Turn`);

  const cut = truncateToWords(response.text.trim(), phase.maxWords);
  const truncated = cut.truncated || response.finishReason === 'length';
  return { ...slot, text: truncated ? trimToLastSentence(cut.text) : cut.text, truncated };
}
