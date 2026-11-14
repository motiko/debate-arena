import { render, screen } from '@testing-library/svelte';
import { expect, test } from 'vitest';
import PhaseFloor from '../src/islands/PhaseFloor.svelte';

const format = {
  phases: [
    { name: 'Opening', order: ['for', 'against'] as ('for' | 'against')[], maxWords: 300 },
    { name: 'Rebuttal', order: ['for', 'against'] as ('for' | 'against')[], maxWords: 200 },
    { name: 'Closing', order: ['for', 'against'] as ('for' | 'against')[], maxWords: 150 },
  ],
};
const speakers = { for: 'Fake A', against: 'Fake B' };
const turn = (phaseIndex: number, side: 'for' | 'against') => ({ phaseIndex, side, text: `${side} ${phaseIndex}`, truncated: false });

test('one h2 per phase that has speeches, with its word limit', () => {
  render(PhaseFloor, { format, speakers, turns: [turn(0, 'for'), turn(0, 'against'), turn(1, 'for')] });
  const headings = screen.getAllByRole('heading', { level: 2 });
  expect(headings.map(h => h.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Opening 300 words', 'Rebuttal 200 words']);
  expect(screen.getAllByRole('article')).toHaveLength(3);
});

test('shows who speaks next in the next phase', () => {
  render(PhaseFloor, { format, speakers, turns: [turn(0, 'for'), turn(0, 'against')], next: { phaseIndex: 1, side: 'against' } });
  expect(screen.getByRole('heading', { level: 2, name: /Rebuttal/ })).toBeInTheDocument();
  expect(screen.getByText('Against speaks next')).toBeInTheDocument();
});

test('no placeholder without a next speaker', () => {
  const { container } = render(PhaseFloor, { format, speakers, turns: [turn(0, 'for')] });
  expect(container.querySelector('.next')).toBeNull();
});
