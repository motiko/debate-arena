import { fireEvent, render, screen } from '@testing-library/svelte';
import { expect, test, vi } from 'vitest';
import VotePanel from '../src/islands/VotePanel.svelte';

const future = new Date(Date.now() + 86_400_000).toISOString();
const base = {
  debateId: 'd1',
  motion: 'Cats beat dogs',
  signedIn: true,
  turnsHidden: false,
  votingClosesAt: null as string | null,
  myVote: null as { before: 'for' | 'against' | 'undecided' | null; after: 'for' | 'against' | 'undecided' | null } | null,
  status: 'running' as 'running' | 'complete' | 'failed',
};

function respond(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Response.json(body, { status });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

test('casts a before-vote and announces it', async () => {
  const { fetcher, calls } = respond(201, { vote: { before: 'for', after: null } });
  render(VotePanel, { ...base, fetcher, reload: vi.fn() });
  await fireEvent.click(screen.getByRole('radio', { name: 'For' }));
  await fireEvent.click(screen.getByRole('button', { name: /cast before-vote/i }));
  await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Your before-vote is recorded: For.'));
  expect(calls[0]?.url).toBe('/api/debates/d1/votes');
  expect(calls[0]?.init?.method).toBe('POST');
  expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('application/json');
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ phase: 'before', stance: 'for' });
  // Still running: the after-vote waits for the end of the Debate.
  expect(screen.queryByRole('group', { name: /after/i })).toBeNull();
});

test('offers the after-vote once complete', async () => {
  const { fetcher, calls } = respond(201, { vote: { before: 'for', after: 'against' } });
  render(VotePanel, { ...base, status: 'complete', votingClosesAt: future, myVote: { before: 'for', after: null }, fetcher, reload: vi.fn() });
  expect(screen.getByRole('group', { name: /after/i })).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('radio', { name: 'Against' }));
  await fireEvent.click(screen.getByRole('button', { name: /cast after-vote/i }));
  await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Your after-vote is recorded: Against.'));
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ phase: 'after', stance: 'against' });
});

test('shows the API error', async () => {
  const { fetcher } = respond(409, { error: 'You already voted before this Debate' });
  render(VotePanel, { ...base, fetcher, reload: vi.fn() });
  await fireEvent.click(screen.getByRole('radio', { name: 'Undecided' }));
  await fireEvent.click(screen.getByRole('button', { name: /cast before-vote/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent('You already voted before this Debate');
});

test('reloads to reveal Turns after the before-vote', async () => {
  const { fetcher } = respond(201, { vote: { before: 'against', after: null } });
  const reload = vi.fn();
  render(VotePanel, { ...base, turnsHidden: true, fetcher, reload });
  await fireEvent.click(screen.getByRole('radio', { name: 'Against' }));
  await fireEvent.click(screen.getByRole('button', { name: /cast before-vote/i }));
  await vi.waitFor(() => expect(reload).toHaveBeenCalled());
});

test('asks a signed-out Viewer to sign in', () => {
  render(VotePanel, { ...base, signedIn: false, fetcher: respond(200, {}).fetcher, reload: vi.fn() });
  expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toBeInTheDocument();
  expect(screen.queryByRole('radio')).toBeNull();
});

test('needs a stance before casting', async () => {
  const { fetcher } = respond(201, {});
  render(VotePanel, { ...base, fetcher, reload: vi.fn() });
  await fireEvent.click(screen.getByRole('button', { name: /cast before-vote/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose For, Against or Undecided.');
  expect(fetcher).not.toHaveBeenCalled();
});

test('shows both votes and no form once voting is closed', () => {
  render(VotePanel, {
    ...base,
    status: 'complete',
    votingClosesAt: new Date(Date.now() - 1000).toISOString(),
    myVote: { before: 'for', after: null },
    fetcher: respond(200, {}).fetcher,
    reload: vi.fn(),
  });
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.getByText(/voting is closed/i)).toBeInTheDocument();
  expect(screen.getByText(/you voted for before/i)).toBeInTheDocument();
});

test('only="before" offers the before-vote', () => {
  render(VotePanel, { ...base, only: 'before' });
  expect(screen.getByRole('button', { name: 'Cast before-vote' })).toBeInTheDocument();
});

test('only="after" shows no form before the before-vote', () => {
  render(VotePanel, { ...base, only: 'after' });
  expect(screen.queryByRole('button')).toBeNull();
});

test('only="after" offers the after-vote once complete', () => {
  render(VotePanel, { ...base, status: 'complete', myVote: { before: 'for', after: null }, only: 'after' });
  expect(screen.getByRole('button', { name: 'Cast after-vote' })).toBeInTheDocument();
});

test('only="before" asks once, without repeating the Motion', () => {
  render(VotePanel, { ...base, only: 'before' });
  expect(screen.getByRole('group', { name: 'Where do you stand?' })).toBeInTheDocument();
});

test('only="after" asks where the reader stands now', () => {
  render(VotePanel, { ...base, status: 'complete', myVote: { before: 'for', after: null }, only: 'after' });
  expect(screen.getByRole('group', { name: 'Where do you stand now?' })).toBeInTheDocument();
  expect(screen.queryByRole('heading')).toBeNull();
});

test('after the after-vote, the page brings the outcome in without a reload', async () => {
  const { fetcher } = respond(201, { vote: { before: 'for', after: 'against' } });
  const refresh = vi.fn(async () => true);
  render(VotePanel, { ...base, status: 'complete', votingClosesAt: future, myVote: { before: 'for', after: null }, only: 'after', fetcher, refresh });
  await fireEvent.click(screen.getByRole('radio', { name: 'Against' }));
  await fireEvent.click(screen.getByRole('button', { name: /cast after-vote/i }));
  await vi.waitFor(() =>
    expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'Your after-vote is recorded: Against.', focus: true })),
  );
});

test('only="before" leaves out the title and intro', () => {
  render(VotePanel, { ...base, only: 'before' });
  expect(screen.queryByRole('heading', { name: 'Your Audience Vote' })).toBeNull();
});
