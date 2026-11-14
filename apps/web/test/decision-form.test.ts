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
  await fireEvent.click(screen.getByRole('button', { name: 'Yes, relist' }));
  await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/relisted/i));
  expect(calls[0]?.url).toBe('/api/moderation/debates/d1/decision');
  expect(new Headers(calls[0]?.init.headers).get('content-type')).toBe('application/json');
  expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ action: 'relist' });
  expect(screen.queryByRole('button', { name: 'Relist' })).toBeNull();
});

test('offers Relist and Block side by side, with the Block form disclosed', async () => {
  const { container } = render(DecisionForm, { debateId: 'd1', fetcher: respond(201, {}).fetcher });
  const decisions = screen.getByRole('group', { name: 'Decision' });
  expect(decisions).toContainElement(screen.getByRole('button', { name: 'Relist' }));
  const disclosure = container.querySelector('details');
  expect(disclosure).not.toBeNull();
  expect(disclosure?.open).toBe(false);
  expect(disclosure?.querySelector('summary')).toHaveTextContent('Block…');
  expect(disclosure).toContainElement(screen.getByRole('button', { name: 'Block' }));
});

test('blocks with ground, reference and explanation', async () => {
  const { fetcher, calls } = respond(201, { visibility: 'blocked' });
  render(DecisionForm, { debateId: 'd1', fetcher });
  await fireEvent.click(screen.getByText('Block…'));
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
  await fireEvent.click(screen.getByText('Block…'));
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
  await fireEvent.click(screen.getByRole('button', { name: 'Yes, relist' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This Debate is already blocked');
});

test('asks before relisting, with focus on the answer, and Cancel goes back', async () => {
  const { fetcher } = respond(201, {});
  render(DecisionForm, { debateId: 'd1', fetcher });
  await fireEvent.click(screen.getByRole('button', { name: 'Relist' }));
  expect(screen.getByText('Relist this Debate?')).toBeInTheDocument();
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Yes, relist' })));
  expect(fetcher).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Relist' })));
  expect(fetcher).not.toHaveBeenCalled();
});

test('the final Block is drawn as destructive', async () => {
  render(DecisionForm, { debateId: 'd1', fetcher: respond(201, {}).fetcher });
  expect(screen.getByRole('button', { name: 'Block' })).toHaveClass('danger');
});
