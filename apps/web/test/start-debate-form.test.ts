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

test('says up front when there is no Quota left and disables the form', () => {
  render(StartDebateForm, { models, quotaRemaining: 0, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  expect(screen.getAllByText(/not enough Quota/i).length).toBeGreaterThan(0);
  expect(screen.getByLabelText('Motion')).toBeDisabled();
  expect(screen.getByLabelText('Debater For')).toBeDisabled();
  const button = screen.getByRole('button', { name: 'Start the Debate' });
  expect(button).toBeDisabled();
  expect(button).toHaveAccessibleDescription(/not enough Quota/i);
});

test('shows the Quota left at the top', () => {
  render(StartDebateForm, { models, quotaRemaining: 6, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  expect(screen.getByText('You have 6 Quota points left today.')).toBeInTheDocument();
});

test('asks for a Motion at the field before posting', async () => {
  const { fetcher } = respond(201, {});
  render(StartDebateForm, { models, quotaRemaining: 6, fetcher, navigate: vi.fn() });
  await fill('   ', 'fake-a/one', 'fake-b/one');
  await fireEvent.click(screen.getByRole('button', { name: 'Start the Debate' }));
  const motion = screen.getByLabelText('Motion');
  await vi.waitFor(() => expect(motion).toHaveFocus());
  expect(motion).toHaveAttribute('aria-invalid', 'true');
  expect(motion).toHaveAccessibleDescription(/write a Motion/i);
  expect(fetcher).not.toHaveBeenCalled();
  await fireEvent.input(motion, { target: { value: 'Cats beat dogs' } });
  expect(motion).not.toHaveAttribute('aria-invalid', 'true');
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

const batchRadio = () => screen.getByRole('radio', { name: /Batch Debate/ });

test('a Batch Debate lists only batch-capable models and costs one point', async () => {
  render(StartDebateForm, { models: batchModels, quotaRemaining: 6, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  expect(screen.getByRole('radio', { name: /Full Debate/ })).toBeChecked();
  expect(optionValues('Debater For')).toContain('fake-slow/one');
  await fireEvent.click(batchRadio());
  expect(optionValues('Debater For')).not.toContain('fake-slow/one');
  expect(screen.getByText(/Fake A vs Fake B · judged by the platform · 1 Quota point$/)).toBeInTheDocument();
});

test('posts batch: true for a Batch Debate', async () => {
  const { fetcher, calls } = respond(201, { id: 'd7' });
  render(StartDebateForm, { models: batchModels, quotaRemaining: 6, fetcher, navigate: vi.fn() });
  await fireEvent.click(batchRadio());
  await fill('Cats beat dogs', 'fake-a/one', 'fake-b/one');
  await fireEvent.click(screen.getByRole('button', { name: 'Start the Debate' }));
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(JSON.parse(String(calls[0]?.body))).toMatchObject({ batch: true, debaters: { for: 'fake-a/one', against: 'fake-b/one' } });
});

test('with one Quota point only a Batch Debate can be chosen, and it is chosen for you', () => {
  render(StartDebateForm, { models: batchModels, quotaRemaining: 1, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  expect(screen.getByRole('radio', { name: /Full Debate/ })).toBeDisabled();
  expect(batchRadio()).toBeChecked();
  expect(screen.getByText(/enough for a Batch Debate/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start the Debate' })).toBeEnabled();
});

test('switching to a Batch Debate keeps a Debater without batch and says it cannot take part', async () => {
  const { fetcher } = respond(201, { id: 'd7' });
  render(StartDebateForm, { models: batchModels, quotaRemaining: 6, fetcher, navigate: vi.fn() });
  await fill('Cats beat dogs', 'fake-slow/one', 'fake-b/one');
  await fireEvent.click(batchRadio());
  const forSelect = screen.getByLabelText('Debater For');
  expect(forSelect).toHaveValue('fake-slow/one');
  expect(forSelect).toHaveAttribute('aria-invalid', 'true');
  expect(forSelect).toHaveAccessibleDescription(/Fake Slow cannot take part in a Batch Debate/);
  expect(screen.getByRole('status')).toHaveTextContent(/Fake Slow cannot take part in a Batch Debate/);
  await fireEvent.click(screen.getByRole('button', { name: 'Start the Debate' }));
  await vi.waitFor(() => expect(forSelect).toHaveFocus());
  expect(fetcher).not.toHaveBeenCalled();
  // Back to a full Debate: the choice is valid again.
  await fireEvent.click(screen.getByRole('radio', { name: /Full Debate/ }));
  expect(forSelect).toHaveValue('fake-slow/one');
  expect(forSelect).not.toHaveAttribute('aria-invalid', 'true');
});

test('the same model cannot sit on both benches', async () => {
  const { fetcher } = respond(201, { id: 'd7' });
  render(StartDebateForm, { models, quotaRemaining: 6, fetcher, navigate: vi.fn() });
  await fill('Cats beat dogs', 'fake-a/one', 'fake-a/one');
  const against = screen.getByLabelText('Debater Against');
  expect(against).toHaveAttribute('aria-invalid', 'true');
  expect(against).toHaveAccessibleDescription(/Fake A already debates For/);
  await fireEvent.click(screen.getByRole('button', { name: 'Start the Debate' }));
  await vi.waitFor(() => expect(against).toHaveFocus());
  expect(fetcher).not.toHaveBeenCalled();
});

test('each bench names the provider of its model', () => {
  render(StartDebateForm, { models: [{ id: 'anthropic/claude-x', label: 'Claude X', roles: ['debater'] }, { id: 'openai/gpt-y', label: 'GPT Y', roles: ['debater'] }], quotaRemaining: 6 });
  expect(screen.getByLabelText('Debater For')).toHaveAccessibleDescription(/Anthropic/);
  expect(screen.getByLabelText('Debater Against')).toHaveAccessibleDescription(/OpenAI/);
});

test('says plainly who will judge', async () => {
  render(StartDebateForm, { models, quotaRemaining: 6, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  await fill('Cats beat dogs', 'fake-a/one', 'fake-b/one');
  const judge = screen.getByLabelText('Judge');
  expect(judge).toHaveAccessibleDescription(/neither Fake A nor Fake B/);
  await fireEvent.change(judge, { target: { value: 'fake-c/one' } });
  expect(judge).toHaveAccessibleDescription(/Fake C gives the Verdict/);
});

test('sums up the Debate before the submit button', async () => {
  render(StartDebateForm, { models, quotaRemaining: 6, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  await fill('Cats beat dogs', 'fake-slow/one', 'fake-b/one');
  expect(screen.getByRole('button', { name: 'Start the Debate' })).toHaveAccessibleDescription('Fake Slow vs Fake B · judged by the platform · 2 Quota points');
  await fireEvent.change(screen.getByLabelText('Judge'), { target: { value: 'fake-c/one' } });
  await fireEvent.click(screen.getByRole('checkbox', { name: /AI Voters/ }));
  expect(screen.getByRole('button', { name: 'Start the Debate' })).toHaveAccessibleDescription('Fake Slow vs Fake B · judged by Fake C · with AI Voters · 2 Quota points');
});

test('the two Debaters are chosen as two benches', () => {
  render(StartDebateForm, { models, quotaRemaining: 6 });
  expect(screen.getByLabelText('Debater For').closest('.bench-for')).not.toBeNull();
  expect(screen.getByLabelText('Debater Against').closest('.bench-against')).not.toBeNull();
});
