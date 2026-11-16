import { fireEvent, render, screen } from '@testing-library/svelte';
import { expect, test, vi } from 'vitest';
import LabelBackfill from '../src/islands/LabelBackfill.svelte';

type Round = { labelled: number; failed: number; remaining: number; next: string | null };

function rounds(...answers: (Round | number)[]) {
  const queue = [...answers];
  const bodies: unknown[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('/api/moderation/labels');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    bodies.push(JSON.parse(String(init?.body)));
    const next = queue.shift();
    if (next === undefined) throw new Error('called too often');
    return typeof next === 'number' ? new Response('{}', { status: next }) : Response.json(next);
  }) as unknown as typeof fetch;
  return { fetcher, bodies };
}

test('labels round after round, passing the cursor on, until none are left', async () => {
  const { fetcher, bodies } = rounds({ labelled: 10, failed: 0, remaining: 3, next: 'c1' }, { labelled: 3, failed: 0, remaining: 0, next: null });
  render(LabelBackfill, { fetcher });
  await fireEvent.click(screen.getByRole('button', { name: 'Label older Debates' }));
  await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Labelled 13 Debates. None are left.'));
  expect(bodies).toEqual([{}, { after: 'c1' }]);
});

test('says how many could not be labelled', async () => {
  const { fetcher } = rounds({ labelled: 2, failed: 8, remaining: 4, next: 'c1' }, { labelled: 3, failed: 1, remaining: 0, next: null });
  render(LabelBackfill, { fetcher });
  await fireEvent.click(screen.getByRole('button', { name: 'Label older Debates' }));
  await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Labelled 5 Debates. 9 could not be labelled; try again later.'));
});

test('a failed request says so', async () => {
  render(LabelBackfill, { fetcher: rounds(500).fetcher });
  await fireEvent.click(screen.getByRole('button', { name: 'Label older Debates' }));
  await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Labelling failed. Try again.'));
});
