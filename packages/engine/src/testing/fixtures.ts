// Test-only fixtures shared across engine tests. Not exported from the package.
import type { DebateSetup, Turn } from '../domain';
import { CLASSIC_FORMAT } from '../formats/classic';

export const setup: DebateSetup = {
  motion: { text: 'Remote work beats office work' },
  format: CLASSIC_FORMAT,
  debaters: { for: { kind: 'ai', model: 'a/for-model' }, against: { kind: 'ai', model: 'b/against-model' } },
  panel: ['c/judge'],
};

export const sixTurns: Turn[] = [
  { phaseIndex: 0, side: 'for', text: 'Opening for: commutes waste hours.', truncated: false },
  { phaseIndex: 0, side: 'against', text: 'Opening against: offices build teams.', truncated: false },
  { phaseIndex: 1, side: 'for', text: 'Rebuttal for: teams thrive online.', truncated: false },
  { phaseIndex: 1, side: 'against', text: 'Rebuttal against: mentoring suffers remotely.', truncated: false },
  { phaseIndex: 2, side: 'for', text: 'Closing for: flexibility wins.', truncated: false },
  { phaseIndex: 2, side: 'against', text: 'Closing against: presence matters.', truncated: false },
];
