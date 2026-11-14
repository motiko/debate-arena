import { fireEvent, render, screen } from '@testing-library/svelte';
import { expect, test, vi } from 'vitest';
import DecisionForm from '../src/islands/DecisionForm.svelte';

function respond(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json(body, { status });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

test('relists', async () => {
  const { fetcher, calls } = respond(201, { visibility: 'listed' });
  render(DecisionForm, { debateId: 'd1', fetcher });
  await fireEvent.click(screen.getByRole('button', { name: 'Relist' }));
  await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/relisted/i));
  expect(calls[0]?.url).toBe('/api/moderation/debates/d1/decision');
  expect(new Headers(calls[0]?.init.headers).get('content-type')).toBe('application/json');
  expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ action: 'relist' });
  expect(screen.queryByRole('button', { name: 'Relist' })).toBeNull();
});

test('blocks with ground, reference and explanation', async () => {
  const { fetcher, calls } = respond(201, { visibility: 'blocked' });
  render(DecisionForm, { debateId: 'd1', fetcher });
  await fireEvent.click(screen.getByRole('radio', { name: /terms of use/i }));
  await fireEvent.input(screen.getByLabelText('Reference'), { target: { value: 'Terms §3 Hate' } });
  await fireEvent.input(screen.getByLabelText('Explanation for the author'), { target: { value: 'The Motion attacks a group of people.' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Block' }));
  await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/blocked/i));
  expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
    action: 'block',
    ground: 'terms',
    groundRef: 'Terms §3 Hate',
    explanation: 'The Motion attacks a group of people.',
  });
});

test('does not Block without an explanation', async () => {
  const { fetcher } = respond(201, {});
  render(DecisionForm, { debateId: 'd1', fetcher });
  await fireEvent.click(screen.getByRole('radio', { name: /illegal/i }));
  await fireEvent.input(screen.getByLabelText('Reference'), { target: { value: 'StGB §130' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Block' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/explanation/i);
  expect(fetcher).not.toHaveBeenCalled();
});

test('shows the API error', async () => {
  const { fetcher } = respond(409, { error: 'This Debate is already blocked' });
  render(DecisionForm, { debateId: 'd1', fetcher });
  await fireEvent.click(screen.getByRole('button', { name: 'Relist' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This Debate is already blocked');
});
