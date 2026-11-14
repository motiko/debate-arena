import { fireEvent, render, screen } from '@testing-library/svelte';
import { expect, test, vi } from 'vitest';
import StartDebateForm from '../src/islands/StartDebateForm.svelte';

const models = [
  { id: 'fake-a/one', label: 'Fake A', roles: ['debater', 'judge', 'voter'] },
  { id: 'fake-b/one', label: 'Fake B', roles: ['debater', 'judge', 'voter'] },
  { id: 'fake-c/one', label: 'Fake C', roles: ['debater', 'judge', 'voter'] },
  { id: 'fake-slow/one', label: 'Fake Slow', roles: ['debater'] },
];

function respond(status: number, body: unknown) {
  const calls: RequestInit[] = [];
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(init);
    return Response.json(body, { status });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

async function fill(motion: string, forModel: string, againstModel: string) {
  await fireEvent.input(screen.getByLabelText('Motion'), { target: { value: motion } });
  await fireEvent.change(screen.getByLabelText('Debater For'), { target: { value: forModel } });
  await fireEvent.change(screen.getByLabelText('Debater Against'), { target: { value: againstModel } });
}

test('posts the Debate and goes to its page', async () => {
  const { fetcher, calls } = respond(201, { id: 'd9', panel: ['fake-c/one'], selfJudging: false });
  const navigate = vi.fn();
  render(StartDebateForm, { models, quotaRemaining: 6, fetcher, navigate });
  await fill('Cats beat dogs', 'fake-a/one', 'fake-b/one');
  await fireEvent.click(screen.getByRole('checkbox', { name: /AI Voters/ }));
  await fireEvent.click(screen.getByRole('button', { name: 'Start the Debate' }));
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/debates/d9'));
  expect(new Headers(calls[0]?.headers).get('content-type')).toBe('application/json');
  expect(JSON.parse(String(calls[0]?.body))).toEqual({ motion: 'Cats beat dogs', debaters: { for: 'fake-a/one', against: 'fake-b/one' }, aiVoters: true });
});

test('lists only Debater models for Debaters and Judge models for the Judge', () => {
  render(StartDebateForm, { models, quotaRemaining: 6, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  const optionValues = (label: string) => [...screen.getByLabelText(label).querySelectorAll('option')].map(o => o.getAttribute('value'));
  const debaterOptions = optionValues('Debater For');
  const judgeOptions = optionValues('Judge');
  expect(debaterOptions).toContain('fake-slow/one');
  expect(judgeOptions).not.toContain('fake-slow/one');
  expect(judgeOptions[0]).toBe('');
});

test('sends the chosen Judge as a one-Judge Panel', async () => {
  const { fetcher, calls } = respond(201, { id: 'd9' });
  render(StartDebateForm, { models, quotaRemaining: 6, fetcher, navigate: vi.fn() });
  await fill('Cats beat dogs', 'fake-a/one', 'fake-b/one');
  await fireEvent.change(screen.getByLabelText('Judge'), { target: { value: 'fake-c/one' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Start the Debate' }));
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(JSON.parse(String(calls[0]?.body)).panel).toEqual(['fake-c/one']);
});

test('warns about Self-Judging before submit', async () => {
  render(StartDebateForm, { models, quotaRemaining: 6, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  await fill('Cats beat dogs', 'fake-a/one', 'fake-b/one');
  expect(screen.queryByText(/Self-Judging/)).toBeNull();
  await fireEvent.change(screen.getByLabelText('Judge'), { target: { value: 'fake-a/one' } });
  expect(screen.getByRole('note')).toHaveTextContent(/Self-Judging/);
});

test('shows the API error and keeps the input', async () => {
  const { fetcher } = respond(429, { error: 'Your Quota for today is used up' });
  const navigate = vi.fn();
  render(StartDebateForm, { models, quotaRemaining: 6, fetcher, navigate });
  await fill('Cats beat dogs', 'fake-a/one', 'fake-b/one');
  await fireEvent.click(screen.getByRole('button', { name: 'Start the Debate' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your Quota for today is used up');
  expect(screen.getByLabelText('Motion')).toHaveValue('Cats beat dogs');
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Start the Debate' })).toBeEnabled();
});

test('explains when the Quota is used up', () => {
  render(StartDebateForm, { models, quotaRemaining: 1, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  expect(screen.getByRole('button', { name: 'Start the Debate' })).toBeDisabled();
  expect(screen.getByText(/not enough Quota/i)).toBeInTheDocument();
});

test('asks for a Motion before posting', async () => {
  const { fetcher } = respond(201, {});
  render(StartDebateForm, { models, quotaRemaining: 6, fetcher, navigate: vi.fn() });
  await fill('   ', 'fake-a/one', 'fake-b/one');
  await fireEvent.click(screen.getByRole('button', { name: 'Start the Debate' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/write a Motion/i);
  expect(fetcher).not.toHaveBeenCalled();
});

test('counts Motion characters up to the limit', async () => {
  render(StartDebateForm, { models, quotaRemaining: 6, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  expect(screen.getByLabelText('Motion')).toHaveAttribute('maxlength', '300');
  await fireEvent.input(screen.getByLabelText('Motion'), { target: { value: 'abc' } });
  expect(screen.getByText('3 / 300')).toBeInTheDocument();
});

const batchModels = [
  { id: 'fake-a/one', label: 'Fake A', roles: ['debater', 'judge', 'voter'], batch: true },
  { id: 'fake-b/one', label: 'Fake B', roles: ['debater', 'judge', 'voter'], batch: true },
  { id: 'fake-c/one', label: 'Fake C', roles: ['debater', 'judge', 'voter'], batch: true },
  { id: 'fake-slow/one', label: 'Fake Slow', roles: ['debater'], batch: false },
];
const optionValues = (label: string) => [...screen.getByLabelText(label).querySelectorAll('option')].map(o => o.getAttribute('value'));

test('a Batch Debate lists only batch-capable models and costs one point', async () => {
  render(StartDebateForm, { models: batchModels, quotaRemaining: 6, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  expect(optionValues('Debater For')).toContain('fake-slow/one');
  await fireEvent.click(screen.getByRole('checkbox', { name: /Batch Debate/ }));
  expect(optionValues('Debater For')).not.toContain('fake-slow/one');
  expect(screen.getByText(/Costs 1 of your 6 Quota points/)).toBeInTheDocument();
});

test('posts batch: true for a Batch Debate', async () => {
  const { fetcher, calls } = respond(201, { id: 'd7' });
  render(StartDebateForm, { models: batchModels, quotaRemaining: 6, fetcher, navigate: vi.fn() });
  await fireEvent.click(screen.getByRole('checkbox', { name: /Batch Debate/ }));
  await fill('Cats beat dogs', 'fake-a/one', 'fake-b/one');
  await fireEvent.click(screen.getByRole('button', { name: 'Start the Debate' }));
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(JSON.parse(String(calls[0]?.body))).toMatchObject({ batch: true, debaters: { for: 'fake-a/one', against: 'fake-b/one' } });
});

test('one Quota point is enough for a Batch Debate', async () => {
  render(StartDebateForm, { models: batchModels, quotaRemaining: 1, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  expect(screen.getByRole('button', { name: 'Start the Debate' })).toBeDisabled();
  await fireEvent.click(screen.getByRole('checkbox', { name: /Batch Debate/ }));
  expect(screen.getByRole('button', { name: 'Start the Debate' })).toBeEnabled();
});

test('switching to a Batch Debate replaces a Debater without batch', async () => {
  render(StartDebateForm, { models: batchModels, quotaRemaining: 6, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  await fireEvent.change(screen.getByLabelText('Debater For'), { target: { value: 'fake-slow/one' } });
  await fireEvent.click(screen.getByRole('checkbox', { name: /Batch Debate/ }));
  expect(screen.getByLabelText('Debater For')).toHaveValue('fake-a/one');
});
