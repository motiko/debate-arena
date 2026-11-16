import { fireEvent, render, screen } from '@testing-library/svelte';
import { expect, test, vi } from 'vitest';
import LabelBackfill from '../src/islands/LabelBackfill.svelte';

function rounds(...bodies: ({ labelled: number; remaining: number } | number)[]) {
  const queue = [...bodies];
  return vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('/api/moderation/labels');
    expect(init?.method).toBe('POST');
    const next = queue.shift();
    if (next === undefined) throw new Error('called too often');
    return typeof next === 'number' ? new Response('{}', { status: next }) : Response.json(next);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

test('labels round after round until none are left, then says how many', async () => {
  const fetcher = rounds({ labelled: 10, remaining: 3 }, { labelled: 3, remaining: 0 });
  render(LabelBackfill, { fetcher });
  await fireEvent.click(screen.getByRole('button', { name: 'Label older Debates' }));
  await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Labelled 13 Debates. None are left.'));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('stops when a round labels nothing, saying how many are still unlabelled', async () => {
  const fetcher = rounds({ labelled: 2, remaining: 4 }, { labelled: 0, remaining: 4 });
  render(LabelBackfill, { fetcher });
  await fireEvent.click(screen.getByRole('button', { name: 'Label older Debates' }));
  await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Labelled 2 Debates. 4 could not be labelled; try again later.'));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('a failed request says so', async () => {
  render(LabelBackfill, { fetcher: rounds(500) });
  await fireEvent.click(screen.getByRole('button', { name: 'Label older Debates' }));
  await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Labelling failed. Try again.'));
});
