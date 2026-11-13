import type { DebateSetup, Format, Side, Turn, TurnSlot } from '../domain';
import type { ModelMessage } from '../models/client';

export function sideLabel(side: Side): string {
  return side === 'for' ? 'For' : 'Against';
}

/** Turns as a labeled transcript, oldest first. */
export function formatTranscript(format: Format, turns: Turn[]): string {
  return turns
    .map(t => `[${format.phases[t.phaseIndex]?.name ?? 'Phase'} · ${sideLabel(t.side)}]\n${t.text}`)
    .join('\n\n');
}

export function buildTurnMessages(setup: DebateSetup, slot: TurnSlot, priorTurns: Turn[]): ModelMessage[] {
  const phase = setup.format.phases[slot.phaseIndex];
  if (!phase) throw new RangeError(`No Phase at index ${slot.phaseIndex}`);
  const system = [
    'You are a Debater in a structured debate.',
    `Motion: "${setup.motion.text}"`,
    `You argue the ${sideLabel(slot.side)} Side of the Motion.`,
    `This is your ${phase.name} Turn. Write at most ${phase.maxWords} words.`,
    "Respond in the Motion's language.",
    'Write only your Turn, with no preamble or labels.',
  ].join('\n');
  const user = priorTurns.length
    ? `The debate so far:\n\n${formatTranscript(setup.format, priorTurns)}\n\nWrite your ${phase.name} Turn now.`
    : `You speak first. Write your ${phase.name} Turn now.`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}
