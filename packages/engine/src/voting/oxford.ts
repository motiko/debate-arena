import type { Side, Stance } from '../domain';
import { DuplicateVoterError } from '../errors';

export interface VoterStances { voterId: string; before?: Stance; after?: Stance }
export interface OxfordResult { counted: number; swing: Record<Side, number>; winner: Side | 'tie' }

/**
 * Oxford voting: Swing per Side is the change in its share of paired voters, in percentage points.
 * Only voters with both a before and an after stance count.
 */
export function computeOxfordResult(votes: VoterStances[]): OxfordResult {
  const seen = new Set<string>();
  for (const v of votes) {
    if (seen.has(v.voterId)) throw new DuplicateVoterError(`Voter ${v.voterId} appears more than once`);
    seen.add(v.voterId);
  }

  const paired = votes.filter(v => v.before !== undefined && v.after !== undefined);
  const counted = paired.length;
  if (counted === 0) return { counted, swing: { for: 0, against: 0 }, winner: 'tie' };

  // Compare whole-voter changes so equal Swings never differ by floating-point rounding.
  const change = (side: Side) =>
    paired.filter(v => v.after === side).length - paired.filter(v => v.before === side).length;
  const delta = { for: change('for'), against: change('against') };
  const swing = { for: (delta.for / counted) * 100, against: (delta.against / counted) * 100 };
  const winner = delta.for === delta.against ? 'tie' : delta.for > delta.against ? 'for' : 'against';
  return { counted, swing, winner };
}
