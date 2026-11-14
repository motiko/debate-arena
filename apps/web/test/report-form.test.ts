import { fireEvent, render, screen } from '@testing-library/svelte';
import { expect, test, vi } from 'vitest';
import ReportForm from '../src/islands/ReportForm.svelte';

function respond(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json(body, { status });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

async function fill(explanation = 'It attacks a group of people.') {
  await fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'hate' } });
  await fireEvent.input(screen.getByLabelText('Why should a Moderator look at this Debate?'), { target: { value: explanation } });
  await fireEvent.click(screen.getByRole('checkbox', { name: /good faith/i }));
}

test('posts a Report and thanks the reporter', async () => {
  const { fetcher, calls } = respond(201, { ok: true });
  render(ReportForm, { debateId: 'd1', signedIn: true, fetcher });
  await fill();
  await fireEvent.click(screen.getByRole('button', { name: 'Send Report' }));
  await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/thank you/i));
  expect(calls[0]?.url).toBe('/api/debates/d1/reports');
  expect(new Headers(calls[0]?.init.headers).get('content-type')).toBe('application/json');
  expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ reason: 'hate', explanation: 'It attacks a group of people.', goodFaith: true });
  expect(screen.queryByRole('button', { name: 'Send Report' })).toBeNull();
});

test('asks a signed-out reporter for optional contact details', async () => {
  const { fetcher, calls } = respond(201, { ok: true });
  render(ReportForm, { debateId: 'd1', signedIn: false, fetcher });
  await fill();
  await fireEvent.input(screen.getByLabelText(/Your name/), { target: { value: 'Rae' } });
  await fireEvent.input(screen.getByLabelText(/Your email/), { target: { value: 'rae@example.test' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Send Report' }));
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ name: 'Rae', email: 'rae@example.test' });
});

test('a signed-in Member is not asked for contact details', () => {
  render(ReportForm, { debateId: 'd1', signedIn: true, fetcher: respond(201, {}).fetcher });
  expect(screen.queryByLabelText(/Your email/)).toBeNull();
});

test('requires the good-faith confirmation', async () => {
  const { fetcher } = respond(201, { ok: true });
  render(ReportForm, { debateId: 'd1', signedIn: true, fetcher });
  await fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'hate' } });
  await fireEvent.input(screen.getByLabelText('Why should a Moderator look at this Debate?'), { target: { value: 'It attacks a group of people.' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Send Report' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/good faith/i);
  expect(fetcher).not.toHaveBeenCalled();
});

test('shows the API error and keeps the input', async () => {
  const { fetcher } = respond(409, { error: 'You already reported this Debate' });
  render(ReportForm, { debateId: 'd1', signedIn: true, fetcher });
  await fill();
  await fireEvent.click(screen.getByRole('button', { name: 'Send Report' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('You already reported this Debate');
  expect(screen.getByLabelText('Why should a Moderator look at this Debate?')).toHaveValue('It attacks a group of people.');
});

test('asks for a reason instead of assuming one', async () => {
  const { fetcher } = respond(201, { ok: true });
  render(ReportForm, { debateId: 'd1', signedIn: true, fetcher });
  expect(screen.getByLabelText('Reason')).toHaveValue('');
  await fireEvent.input(screen.getByLabelText('Why should a Moderator look at this Debate?'), { target: { value: 'It attacks a group of people.' } });
  await fireEvent.click(screen.getByRole('checkbox', { name: /good faith/i }));
  await fireEvent.click(screen.getByRole('button', { name: 'Send Report' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose a reason.');
  expect(screen.getByLabelText('Reason')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Reason')).toHaveAccessibleDescription('Choose a reason.');
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Reason')));
  expect(fetcher).not.toHaveBeenCalled();
});
