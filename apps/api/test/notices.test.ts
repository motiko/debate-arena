import { env } from 'cloudflare:workers';
import { expect, test, vi } from 'vitest';
import { completeDebate, createDebate, getDebate } from '../src/db/debates';
import { addReport, type ModerationDecision } from '../src/db/moderation';
import { createEmailSender, NoEmailSender, ScalewayEmailSender, type EmailMessage, type EmailSender } from '../src/notices/email';
import { noticeDecision, noticeReportReceived, type NoticeDeps } from '../src/notices/notify';
import { signedInHeaders } from './auth-helpers';
import { newDebate, sampleSetup, uniqueId } from './helpers';

function recorder(fail = false) {
  const sent: EmailMessage[] = [];
  const sender: EmailSender = {
    async send(message) {
      if (fail) throw new Error('Scaleway is down');
      sent.push(message);
    },
  };
  return { sender, sent };
}

const deps = (sender: EmailSender): NoticeDeps => ({ db: env.DB, sender, siteUrl: 'https://arena.test', contact: 'notices@arena.test' });

async function debateBy(memberId: string, motion = 'A Motion under review') {
  const d = newDebate({ memberId, setup: { ...sampleSetup, motion: { text: motion } } });
  await createDebate(env.DB, d);
  await completeDebate(env.DB, d.id, null, new Date().toISOString());
  return (await getDebate(env.DB, d.id))!;
}

async function report(debateId: string, email: string | null, memberId: string | null = null) {
  await addReport(
    env.DB,
    {
      id: crypto.randomUUID(),
      debateId,
      reporterMemberId: memberId,
      reporterName: null,
      reporterEmail: email,
      reason: 'hate',
      explanation: 'It attacks a group of people.',
      ipHash: null,
      createdAt: new Date().toISOString(),
    },
    100,
    new Date(Date.now() - 3600_000).toISOString(),
  );
}

const block = (debateId: string): ModerationDecision => ({
  id: crypto.randomUUID(),
  debateId,
  action: 'block',
  source: 'reports',
  automatedDetection: false,
  ground: 'terms',
  groundRef: 'Terms: Acceptable use',
  explanation: 'The Motion attacks a group of people.',
  moderatorId: 'mod-1',
  decidedAt: '2026-11-14T10:00:00.000Z',
});

test('Scaleway sender posts the documented request', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json({ emails: [{ id: 'e1' }] });
  }) as unknown as typeof fetch;
  await new ScalewayEmailSender('secret-key', 'project-1', 'notices@arena.test', fetcher).send({ to: 'rae@example.test', subject: 'Hi', text: 'Body' });
  expect(calls[0]?.url).toBe('https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails');
  expect(new Headers(calls[0]?.init.headers).get('x-auth-token')).toBe('secret-key');
  expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
    from: { email: 'notices@arena.test' },
    to: [{ email: 'rae@example.test' }],
    subject: 'Hi',
    text: 'Body',
    project_id: 'project-1',
  });
});

test('Scaleway sender fails loudly on an error response', async () => {
  const fetcher = (async () => Response.json({ message: 'invalid' }, { status: 400 })) as unknown as typeof fetch;
  await expect(new ScalewayEmailSender('k', 'p', 'f@x.test', fetcher).send({ to: 'a@b.test', subject: 's', text: 't' })).rejects.toThrow(/400/);
});

test('a Scaleway error does not carry the response body (it may echo the address) into logs', async () => {
  const fetcher = (async () => Response.json({ message: 'invalid recipient rae@example.test' }, { status: 422 })) as unknown as typeof fetch;
  const error = await new ScalewayEmailSender('k', 'p', 'f@x.test', fetcher).send({ to: 'rae@example.test', subject: 's', text: 't' }).catch(e => e);
  expect(String(error)).toMatch(/422/);
  expect(String(error)).not.toContain('rae@example.test');
});

test('with EMAIL_PROVIDER none nothing is sent', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(createEmailSender({ EMAIL_PROVIDER: 'none', EMAIL_FROM: '' })).toBeInstanceOf(NoEmailSender);
  await createEmailSender({ EMAIL_PROVIDER: 'none', EMAIL_FROM: '' }).send({ to: 'rae@example.test', subject: 'Hi', text: 'secret body' });
  expect(JSON.stringify(log.mock.calls)).not.toContain('rae@example.test');
  log.mockRestore();
});

test('a Report with an email gets a receipt', async () => {
  const { sender, sent } = recorder();
  const debate = await debateBy('someone');
  await noticeReportReceived(deps(sender), debate.id, 'rae@example.test');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ to: 'rae@example.test' });
  expect(sent[0]?.text).toContain(`https://arena.test/debates/${debate.id}`);
});

test('a Block sends the statement of reasons to the author', async () => {
  const { sender, sent } = recorder();
  const { userId } = await signedInHeaders('Author');
  const author = await env.DB.prepare('SELECT email FROM "user" WHERE id = ?').bind(userId).first<{ email: string }>();
  const debate = await debateBy(userId, 'A Motion that gets Blocked');
  await noticeDecision(deps(sender), debate, block(debate.id), null);
  const statement = sent.find(m => m.to === author!.email);
  expect(statement?.subject).toMatch(/blocked/i);
  for (const part of ['Terms: Acceptable use', 'The Motion attacks a group of people.', 'A Motion that gets Blocked', 'a person', 'notices@arena.test']) {
    expect(statement?.text).toContain(part);
  }
});

test('a decision notifies reporters who left an email, and only them', async () => {
  const { sender, sent } = recorder();
  const debate = await debateBy('someone');
  await report(debate.id, 'rae@example.test');
  await report(debate.id, null);
  await report(debate.id, null, uniqueId('member'));
  await noticeDecision(deps(sender), debate, { ...block(debate.id), action: 'relist', ground: null, groundRef: null, explanation: null }, null);
  expect(sent.map(m => m.to)).toEqual(['rae@example.test']);
  expect(sent[0]?.text).toMatch(/back in the feed|relisted/i);
});

test('only Reports since the last review are told about this decision', async () => {
  const { sender, sent } = recorder();
  const debate = await debateBy('someone');
  await report(debate.id, 'old@example.test');
  const reviewedAt = new Date(Date.now() + 5).toISOString();
  await new Promise(resolve => setTimeout(resolve, 10));
  await report(debate.id, 'new@example.test');
  await noticeDecision(deps(sender), debate, block(debate.id), reviewedAt);
  expect(sent.map(m => m.to)).toEqual(['new@example.test']);
});

test('a failing email never fails the decision', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { sender } = recorder(true);
  const debate = await debateBy('someone');
  await report(debate.id, 'rae@example.test');
  await expect(noticeDecision(deps(sender), debate, block(debate.id), null)).resolves.toBeUndefined();
  await expect(noticeReportReceived(deps(sender), debate.id, 'rae@example.test')).resolves.toBeUndefined();
  expect(error).toHaveBeenCalled();
  error.mockRestore();
});

test('a deleted author gets no email', async () => {
  const { sender, sent } = recorder();
  const debate = await debateBy('deleted-0123456789abcdef');
  await noticeDecision(deps(sender), debate, block(debate.id), null);
  expect(sent).toEqual([]);
});
