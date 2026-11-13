import { CLASSIC_FORMAT, type DebateSetup, type Turn } from '@debate-arena/engine';
import type { NewDebate } from '../src/db/debates';

export const sampleSetup: DebateSetup = {
  motion: { text: 'Remote work beats office work' },
  format: CLASSIC_FORMAT,
  debaters: { for: { kind: 'ai', model: 'fake-a/one' }, against: { kind: 'ai', model: 'fake-b/one' } },
  panel: ['fake-c/one'],
};

let counter = 0;
export function uniqueId(prefix = 'd'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function newDebate(overrides: Partial<NewDebate> = {}): NewDebate {
  return {
    id: uniqueId(),
    memberId: 'm1',
    setup: sampleSetup,
    aiVoters: [],
    selfJudging: false,
    quotaPoints: 2,
    budgetReservedMicroUsd: 1000,
    createdAt: '2026-11-13T12:00:00.000Z',
    ...overrides,
  };
}

export function turnAt(slotIndex: number, text = `Turn ${slotIndex}`): Turn {
  return { phaseIndex: Math.floor(slotIndex / 2), side: slotIndex % 2 === 0 ? 'for' : 'against', text, truncated: false };
}
