import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { expect, test, vi } from 'vitest';
import ApiTokens from '../src/islands/ApiTokens.svelte';

const laptop = { id: 't1', name: 'Laptop', start: 'da_abc', createdAt: '2026-11-15T10:00:00.000Z', expiresAt: '2027-02-13T10:00:00.000Z', lastRequest: null };
const ci = { id: 't2', name: 'CI', start: 'da_xyz', createdAt: '2026-11-01T10:00:00.000Z', expiresAt: '2026-12-01T10:00:00.000Z', lastRequest: '2026-11-14T08:00:00.000Z' };

/** Answers by path; each path's responses are used in order (the last one repeats). */
function responder(responses: Record<string, Response[]>) {
  const calls: { path: string; body: unknown }[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ path: url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const queue = responses[url];
    if (!queue?.length) throw new Error(`unexpected ${url}`);
    return (queue.length > 1 ? queue.shift() : queue[0])!.clone();
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const list = (...tokens: object[]) => Response.json({ apiKeys: tokens, total: tokens.length });

test('lists tokens with name, start, expiry and last use', async () => {
  const { fetcher } = responder({ '/api/auth/api-key/list': [list(laptop, ci)] });
  render(ApiTokens, { fetcher });
  const rows = await screen.findAllByRole('listitem');
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('Laptop');
  expect(rows[0]).toHaveTextContent('da_abc…');
  expect(rows[0]).toHaveTextContent('Expires Feb 13, 2027');
  expect(rows[0]).toHaveTextContent('Never used');
  expect(rows[1]).toHaveTextContent('Last used Nov 14, 2026');
});

test('shows a new token once with a copy hint, and hides it after Done', async () => {
  const { fetcher, calls } = responder({
    '/api/auth/api-key/list': [list(), list(laptop)],
    '/api/auth/api-key/create': [Response.json({ ...laptop, key: 'da_secret' })],
  });
  render(ApiTokens, { fetcher });
  await fireEvent.input(await screen.findByRole('textbox', { name: 'Token name' }), { target: { value: 'Laptop' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
  const shown = await screen.findByRole('textbox', { name: 'Your new token' });
  expect(shown).toHaveValue('da_secret');
  expect(shown).toHaveAttribute('readonly');
  expect(screen.getByText(/won't be shown again/)).toBeInTheDocument();
  expect(calls.find(c => c.path === '/api/auth/api-key/create')?.body).toEqual({ name: 'Laptop', expiresIn: 90 * 86_400 });
  await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByDisplayValue('da_secret')).toBeNull();
  expect(await screen.findByRole('listitem')).toHaveTextContent('Laptop');
});

test('the expiry can be 30, 90 or 365 days', async () => {
  const { fetcher, calls } = responder({
    '/api/auth/api-key/list': [list()],
    '/api/auth/api-key/create': [Response.json({ ...laptop, key: 'da_secret' })],
  });
  render(ApiTokens, { fetcher });
  const select = await screen.findByRole('combobox', { name: 'Expires after' });
  expect(within(select).getAllByRole('option').map(o => o.textContent)).toEqual(['30 days', '90 days', '365 days']);
  expect(select).toHaveValue('90');
  await fireEvent.change(select, { target: { value: '365' } });
  await fireEvent.input(screen.getByRole('textbox', { name: 'Token name' }), { target: { value: 'CI' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
  await screen.findByRole('textbox', { name: 'Your new token' });
  expect(calls.find(c => c.path === '/api/auth/api-key/create')?.body).toEqual({ name: 'CI', expiresIn: 365 * 86_400 });
});

test('the name is required and at most 50 characters', async () => {
  const { fetcher } = responder({ '/api/auth/api-key/list': [list()] });
  render(ApiTokens, { fetcher });
  const name = await screen.findByRole('textbox', { name: 'Token name' });
  expect(name).toBeRequired();
  expect(name).toHaveAttribute('maxlength', '50');
  await fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('revoking asks for confirmation then removes the row', async () => {
  const { fetcher, calls } = responder({
    '/api/auth/api-key/list': [list(laptop, ci), list(ci)],
    '/api/auth/api-key/delete': [Response.json({ success: true })],
  });
  render(ApiTokens, { fetcher });
  const [first] = await screen.findAllByRole('listitem');
  await fireEvent.click(within(first!).getByRole('button', { name: 'Revoke Laptop' }));
  expect(calls.some(c => c.path === '/api/auth/api-key/delete')).toBe(false);
  await fireEvent.click(within(first!).getByRole('button', { name: 'Revoke Laptop for good' }));
  await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
  expect(calls.find(c => c.path === '/api/auth/api-key/delete')?.body).toEqual({ keyId: 't1' });
  expect(screen.getByRole('listitem')).toHaveTextContent('CI');
});

test('a failed request shows the error and keeps the list', async () => {
  const { fetcher } = responder({
    '/api/auth/api-key/list': [list(laptop)],
    '/api/auth/api-key/create': [Response.json({ code: 'X', message: 'Something broke' }, { status: 500 })],
  });
  render(ApiTokens, { fetcher });
  await fireEvent.input(await screen.findByRole('textbox', { name: 'Token name' }), { target: { value: 'CI' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Something broke');
  expect(screen.getByRole('listitem')).toHaveTextContent('Laptop');
});
