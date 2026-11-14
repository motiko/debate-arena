import { fireEvent, render, screen } from '@testing-library/svelte';
import { expect, test, vi } from 'vitest';
import CopyLink from '../src/islands/CopyLink.svelte';

const url = 'https://debate-arena.test/debates/d1';

test('copies the link and says so', async () => {
  const clipboard = { writeText: vi.fn(async () => {}) };
  render(CopyLink, { url, clipboard });
  await fireEvent.click(screen.getByRole('button', { name: 'Copy link to this Debate' }));
  await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Link copied.'));
  expect(clipboard.writeText).toHaveBeenCalledWith(url);
});

test('shows the link to copy by hand when the clipboard refuses', async () => {
  const clipboard = { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) };
  render(CopyLink, { url, clipboard });
  await fireEvent.click(screen.getByRole('button', { name: 'Copy link to this Debate' }));
  await vi.waitFor(() => expect(screen.getByDisplayValue(url)).toBeInTheDocument());
  expect(screen.getByText('Copy this link:')).toBeInTheDocument();
});
