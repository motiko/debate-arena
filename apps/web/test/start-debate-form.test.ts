import { fireEvent, render, screen } from '@testing-library/svelte';
import { expect, test, vi } from 'vitest';
import StartDebateForm from '../src/islands/StartDebateForm.svelte';

const models = [
  { id: 'fake-a/one', label: 'Fake A', roles: ['debater', 'judge', 'voter'], batch: true, inputPerMTokUsd: 1, outputPerMTokUsd: 1 },
  { id: 'fake-b/one', label: 'Fake B', roles: ['debater', 'judge', 'voter'], batch: true, inputPerMTokUsd: 1, outputPerMTokUsd: 1 },
  { id: 'fake-c/one', label: 'Fake C', roles: ['debater', 'judge', 'voter'], batch: true, inputPerMTokUsd: 1, outputPerMTokUsd: 1 },
  { id: 'fake-slow/one', label: 'Fake Slow', roles: ['debater'], batch: false, inputPerMTokUsd: 1, outputPerMTokUsd: 1 },
  { id: 'fake-think/one', label: 'Fake Thinker', roles: ['debater', 'judge'], batch: false, inputPerMTokUsd: 1, outputPerMTokUsd: 1 },
];

const QUOTE = { budgetMicroUsd: 47_816, quotaPoints: 4, quotaRemaining: 20, slowAvailable: true, panel: ['fake-c/one'], selfJudging: false };

/** Answers quotes with `quote` and the start of a Debate with `status`/`body`; records each kind separately. */
function respond(status: number, body: unknown, quote: (request: unknown) => Response = () => Response.json(QUOTE)) {
  const calls: RequestInit[] = [];
  const quotes: unknown[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (url === '/api/debates/quote') {
      const request = JSON.parse(String(init.body));
      quotes.push(request);
      return quote(request);
    }
    calls.push(init);
    return Response.json(body, { status });
  }) as unknown as typeof fetch;
  return { fetcher, calls, quotes };
}

const picker = (label: string) => screen.getByRole('combobox', { name: label });

/** Types into a picker and takes the first match. */
async function choose(label: string, text: string) {
  const input = picker(label);
  await fireEvent.input(input, { target: { value: text } });
  await fireEvent.keyDown(input, { key: 'ArrowDown' });
  await fireEvent.keyDown(input, { key: 'Enter' });
}

async function fill(motion: string, forModel: string, againstModel: string) {
  await fireEvent.input(screen.getByLabelText('Motion'), { target: { value: motion } });
  await choose('Debater For', forModel);
  await choose('Debater Against', againstModel);
}

const startButton = () => screen.getByRole('button', { name: 'Start the Debate' });
const slowBox = () => screen.queryByRole('checkbox', { name: /Slow Debate/ });

test('posts the Debate and goes to its page', async () => {
  const { fetcher, calls } = respond(201, { id: 'd9', panel: ['fake-c/one'], selfJudging: false });
  const navigate = vi.fn();
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher, navigate });
  await fill('Cats beat dogs', 'Fake A', 'Fake B');
  await fireEvent.click(screen.getByRole('checkbox', { name: /AI Voters/ }));
  await vi.waitFor(() => expect(startButton()).toBeEnabled());
  await fireEvent.click(startButton());
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/debates/d9'));
  expect(new Headers(calls[0]?.headers).get('content-type')).toBe('application/json');
  expect(JSON.parse(String(calls[0]?.body))).toEqual({ motion: 'Cats beat dogs', debaters: { for: 'fake-a/one', against: 'fake-b/one' }, aiVoters: 10 });
});

test('the Debater pickers offer Custom first and Debater models; the Judge picker offers Judge models after the platform', async () => {
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  await fireEvent.keyDown(picker('Debater For'), { key: 'ArrowDown' });
  const debaterOptions = screen.getAllByRole('option').map(o => o.textContent);
  expect(debaterOptions[0]).toContain('Custom');
  expect(debaterOptions.some(o => o?.includes('Fake Slow'))).toBe(true);
  await fireEvent.keyDown(picker('Debater For'), { key: 'Escape' });
  await fireEvent.keyDown(picker('Judge'), { key: 'ArrowDown' });
  const judgeOptions = screen.getAllByRole('option').map(o => o.textContent);
  expect(judgeOptions[0]).toContain('Let the platform choose');
  expect(judgeOptions.some(o => o?.includes('Fake Slow'))).toBe(false);
  expect(judgeOptions.some(o => o?.includes('Custom'))).toBe(false);
});

test('says how much room is left only near the Motion limit, once per step', async () => {
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  const motion = screen.getByLabelText('Motion');
  expect(screen.getByText('0 / 300')).not.toHaveAttribute('aria-live');
  const status = document.getElementById('motion-room');
  expect(status).toHaveAttribute('role', 'status');
  await fireEvent.input(motion, { target: { value: 'x'.repeat(285) } });
  expect(status).toHaveTextContent('Fewer than 20 characters left.');
  await fireEvent.input(motion, { target: { value: 'x'.repeat(300) } });
  expect(status).toHaveTextContent('The Motion is at its 300-character limit.');
});

test('sends the chosen Judge as a one-Judge Panel', async () => {
  const { fetcher, calls } = respond(201, { id: 'd9' });
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher, navigate: vi.fn() });
  await fill('Cats beat dogs', 'Fake A', 'Fake B');
  await choose('Judge', 'Fake C');
  await vi.waitFor(() => expect(startButton()).toBeEnabled());
  await fireEvent.click(startButton());
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(JSON.parse(String(calls[0]?.body)).panel).toEqual(['fake-c/one']);
});

test('warns about Self-Judging before submit', async () => {
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  await fill('Cats beat dogs', 'Fake A', 'Fake B');
  expect(screen.queryByText(/Self-Judging/)).toBeNull();
  await choose('Judge', 'Fake A');
  expect(screen.getByText(/Self-Judging/)).toBeInTheDocument();
});

test('shows the API error and keeps the input', async () => {
  const { fetcher } = respond(429, { error: 'Daily Debate limit reached' });
  const navigate = vi.fn();
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher, navigate });
  await fill('Cats beat dogs', 'Fake A', 'Fake B');
  await vi.waitFor(() => expect(startButton()).toBeEnabled());
  await fireEvent.click(startButton());
  expect(await screen.findByRole('alert')).toHaveTextContent('Daily Debate limit reached');
  expect(screen.getByLabelText('Motion')).toHaveValue('Cats beat dogs');
  expect(navigate).not.toHaveBeenCalled();
});

test('says up front when there is no Quota left and disables the form', () => {
  render(StartDebateForm, { models, quotaRemaining: 0, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  expect(screen.getAllByText(/not enough Quota/i).length).toBeGreaterThan(0);
  expect(screen.getByLabelText('Motion')).toBeDisabled();
  expect(picker('Debater For')).toBeDisabled();
  expect(startButton()).toBeDisabled();
  expect(startButton()).toHaveAccessibleDescription(/not enough Quota/i);
});

test('shows the Quota left at the top', () => {
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  expect(screen.getByText('You have 24 Quota points left today.')).toBeInTheDocument();
});

test('asks for a Motion at the field before posting', async () => {
  const { fetcher, calls } = respond(201, {});
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher, navigate: vi.fn() });
  await fill('   ', 'Fake A', 'Fake B');
  await vi.waitFor(() => expect(startButton()).toBeEnabled());
  await fireEvent.click(startButton());
  const motion = screen.getByLabelText('Motion');
  await vi.waitFor(() => expect(motion).toHaveFocus());
  expect(motion).toHaveAttribute('aria-invalid', 'true');
  expect(calls).toHaveLength(0);
});

test('shows what the line-up costs, quoted by the API', async () => {
  const { fetcher, quotes } = respond(201, {});
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher, navigate: vi.fn() });
  await vi.waitFor(() => expect(screen.getByText('4 Quota points · you have 20 left today')).toBeInTheDocument());
  expect(startButton()).toHaveAccessibleDescription(/4 Quota points · you have 20 left today/);
  expect(quotes.at(-1)).toMatchObject({ debaters: { for: 'fake-a/one', against: 'fake-b/one' }, aiVoters: false });
});

test('checking AI Voters shows a slider at 10 and sends the count', async () => {
  const { fetcher, calls } = respond(201, { id: 'd9', panel: ['fake-c/one'], selfJudging: false });
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher, navigate: vi.fn() });
  await fill('Cats beat dogs', 'Fake A', 'Fake B');
  expect(screen.queryByRole('slider', { name: 'AI Voters' })).toBeNull();
  await fireEvent.click(screen.getByRole('checkbox', { name: /AI Voters/ }));
  const slider = screen.getByRole('slider', { name: 'AI Voters' });
  expect(slider).toHaveValue('10');
  expect(slider).toHaveAttribute('min', '1');
  expect(slider).toHaveAttribute('max', '100');
  await fireEvent.input(slider, { target: { value: '25' } });
  await vi.waitFor(() => expect(startButton()).toBeEnabled());
  await fireEvent.click(startButton());
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(JSON.parse(String(calls[0]?.body))).toMatchObject({ aiVoters: 25 });
});

test('the slider shows what its AI Voters cost, from the latest quote', async () => {
  const { fetcher } = respond(201, {}, request => {
    const voters = (request as { aiVoters: number | false }).aiVoters;
    return Response.json({ ...QUOTE, aiVotersMicroUsd: voters === false ? 0 : voters * 3600 });
  });
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher, navigate: vi.fn() });
  await fireEvent.click(screen.getByRole('checkbox', { name: /AI Voters/ }));
  await fireEvent.input(screen.getByRole('slider', { name: 'AI Voters' }), { target: { value: '25' } });
  await vi.waitFor(() => expect(screen.getByText('25 AI Voters · up to $0.09')).toBeInTheDocument());
});

test('a quick second change drops the first answer', async () => {
  let n = 0;
  const { fetcher } = respond(201, {}, () => Response.json({ ...QUOTE, quotaPoints: ++n === 1 ? 4 : 12 }));
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher, navigate: vi.fn() });
  await fireEvent.click(screen.getByRole('checkbox', { name: /AI Voters/ }));
  await vi.waitFor(() => expect(screen.getByText(/^\d+ Quota points/)).toBeInTheDocument());
  expect(screen.getByText(/^\d+ Quota points/)).toHaveTextContent('4 Quota points');
  expect(n).toBe(1);
});

test('a line-up the API refuses shows why and cannot be started', async () => {
  const refusal = 'This line-up needs 31 Quota points; a day has 24. Choose cheaper models or leave out AI Voters.';
  const { fetcher } = respond(201, {}, () => Response.json({ error: refusal }, { status: 400 }));
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher, navigate: vi.fn() });
  await vi.waitFor(() => expect(screen.getByText(refusal)).toBeInTheDocument());
  expect(startButton()).toBeDisabled();
});

test('a line-up costing more than the Quota left cannot be started', async () => {
  const { fetcher } = respond(201, {}, () => Response.json({ ...QUOTE, quotaPoints: 8, quotaRemaining: 4 }));
  render(StartDebateForm, { models, quotaRemaining: 4, fetcher, navigate: vi.fn() });
  await vi.waitFor(() => expect(screen.getByText('8 Quota points · you have 4 left today')).toBeInTheDocument());
  expect(startButton()).toBeDisabled();
});

test('Slow Debate is offered only when both Debaters are batch-capable', async () => {
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  expect(slowBox()).not.toBeNull();
  expect(slowBox()).toHaveAccessibleDescription(/^Fewer Quota points, at batch prices\./);
  await choose('Debater For', 'Fake Thinker');
  expect(slowBox()).toBeNull();
  await choose('Debater For', 'Fake C');
  expect(slowBox()).not.toBeNull();
  await choose('Debater Against', 'Custom');
  expect(slowBox()).toBeNull();
});

test('choosing a model that cannot run as batch unticks Slow Debate and says why', async () => {
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  await fireEvent.click(slowBox()!);
  await choose('Debater For', 'Fake Slow');
  expect(slowBox()).toBeNull();
  expect(document.getElementById('batch-status')).toHaveTextContent('Slow Debate is not available for Fake Slow');
  await choose('Debater For', 'Fake A');
  expect(slowBox()).not.toBeChecked();
});

test('with Slow Debate ticked the Judge picker lists only batch-capable models', async () => {
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  await fireEvent.click(slowBox()!);
  await fireEvent.keyDown(picker('Judge'), { key: 'ArrowDown' });
  const judgeOptions = screen.getAllByRole('option').map(o => o.textContent);
  expect(judgeOptions.some(o => o?.includes('Fake Thinker'))).toBe(false);
});

test('posts batch: true for a Slow Debate', async () => {
  const { fetcher, calls } = respond(201, { id: 'd7' });
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher, navigate: vi.fn() });
  await fill('Cats beat dogs', 'Fake A', 'Fake B');
  await fireEvent.click(slowBox()!);
  await vi.waitFor(() => expect(startButton()).toBeEnabled());
  await fireEvent.click(startButton());
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(JSON.parse(String(calls[0]?.body))).toMatchObject({ batch: true, debaters: { for: 'fake-a/one', against: 'fake-b/one' } });
});

test('a Custom Debater without a name is posted as "api" and the bench says how to send its Turns', async () => {
  const { fetcher, calls } = respond(201, { id: 'd8' });
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher, navigate: vi.fn() });
  await fill('Cats beat dogs', 'Custom', 'Fake B');
  expect(picker('Debater For')).toHaveValue('Custom — submit this side’s Turns yourself');
  expect(picker('Debater For')).toHaveAccessibleDescription(/debate speak <id>/);
  await vi.waitFor(() => expect(startButton()).toBeEnabled());
  await fireEvent.click(startButton());
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(JSON.parse(String(calls[0]?.body)).debaters).toEqual({ for: 'api', against: 'fake-b/one' });
});

test('a Custom Debater may be given a nickname and a self-reported model', async () => {
  const { fetcher, calls } = respond(201, { id: 'd8' });
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher, navigate: vi.fn() });
  await fill('Cats beat dogs', 'Custom', 'Fake B');
  const name = screen.getByLabelText('Nickname (optional)');
  const model = screen.getByLabelText('Model (optional, self-reported)');
  expect(name).toHaveAttribute('maxlength', '40');
  expect(model).toHaveAttribute('maxlength', '60');
  await fireEvent.input(name, { target: { value: 'Atlas' } });
  await fireEvent.input(model, { target: { value: 'gpt-6' } });
  await vi.waitFor(() => expect(startButton()).toBeEnabled());
  await fireEvent.click(startButton());
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(JSON.parse(String(calls[0]?.body)).debaters).toEqual({ for: { kind: 'custom', name: 'Atlas', model: 'gpt-6' }, against: 'fake-b/one' });
});

test('a model bench has no nickname field', async () => {
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  await fill('Cats beat dogs', 'Fake A', 'Fake B');
  expect(screen.queryByLabelText('Nickname (optional)')).toBeNull();
});

test('Custom on both benches is not the same model twice', async () => {
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  await fill('Cats beat dogs', 'Custom', 'Custom');
  expect(picker('Debater Against')).not.toHaveAttribute('aria-invalid', 'true');
});

test('the same model cannot sit on both benches', async () => {
  const { fetcher, calls } = respond(201, { id: 'd7' });
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher, navigate: vi.fn() });
  await fill('Cats beat dogs', 'Fake A', 'Fake A');
  const against = picker('Debater Against');
  expect(against).toHaveAttribute('aria-invalid', 'true');
  expect(against).toHaveAccessibleDescription(/Fake A already debates For/);
  await vi.waitFor(() => expect(startButton()).toBeEnabled());
  await fireEvent.click(startButton());
  await vi.waitFor(() => expect(against).toHaveFocus());
  expect(calls).toHaveLength(0);
});

test('each bench names the provider of its model', () => {
  render(StartDebateForm, {
    models: [
      { id: 'anthropic/claude-x', label: 'Claude X', roles: ['debater'] },
      { id: 'openai/gpt-y', label: 'GPT Y', roles: ['debater'] },
    ],
    quotaRemaining: 24,
    fetcher: respond(201, {}).fetcher,
  });
  expect(picker('Debater For')).toHaveAccessibleDescription(/Anthropic/);
  expect(picker('Debater Against')).toHaveAccessibleDescription(/OpenAI/);
});

test('says plainly who will judge', async () => {
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  await fill('Cats beat dogs', 'Fake A', 'Fake B');
  expect(picker('Judge')).toHaveAccessibleDescription(/neither Fake A nor Fake B/);
  await choose('Judge', 'Fake C');
  expect(picker('Judge')).toHaveAccessibleDescription(/Fake C gives the Verdict/);
});

test('sums up the Debate before the submit button', async () => {
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher: respond(201, {}).fetcher, navigate: vi.fn() });
  await fill('Cats beat dogs', 'Fake Slow', 'Fake B');
  expect(screen.getByText('Fake Slow vs Fake B · judged by the platform')).toBeInTheDocument();
  await choose('Judge', 'Fake C');
  await fireEvent.click(screen.getByRole('checkbox', { name: /AI Voters/ }));
  expect(screen.getByText('Fake Slow vs Fake B · judged by Fake C · with 10 AI Voters')).toBeInTheDocument();
});

test('the two Debaters are chosen as two benches', () => {
  render(StartDebateForm, { models, quotaRemaining: 24, fetcher: respond(201, {}).fetcher });
  expect(picker('Debater For').closest('.bench-for')).not.toBeNull();
  expect(picker('Debater Against').closest('.bench-against')).not.toBeNull();
});
