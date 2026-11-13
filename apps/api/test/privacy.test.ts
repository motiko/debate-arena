import { env } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { anonymiseMember } from '../src/account/account';
import { createDebate } from '../src/db/debates';
import { castBefore } from '../src/db/votes';
import { voterKey } from '../src/votes/voter-key';
import { newDebate } from './helpers';

test('voter keys differ between Debates, so a person’s votes cannot be linked across Debates', async () => {
  const a = await voterKey(env, 'member-1', 'debate-a');
  const b = await voterKey(env, 'member-1', 'debate-b');
  expect(a).not.toBe(b);
  expect(await voterKey(env, 'member-1', 'debate-a')).toBe(a);
});

test('anonymisation gives each row its own random id', async () => {
  const memberId = `m-${crypto.randomUUID()}`;
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const d = newDebate({ memberId });
    await createDebate(env.DB, d);
    await castBefore(env.DB, d.id, memberId, 'for', d.createdAt);
    ids.push(d.id);
  }
  await anonymiseMember(env.DB, memberId);
  const rows = await env.DB.prepare(
    `SELECT member_id FROM debates WHERE id IN (?, ?) UNION ALL SELECT member_id FROM audience_votes WHERE debate_id IN (?, ?)`,
  )
    .bind(...ids, ...ids)
    .all<{ member_id: string }>();
  const replaced = rows.results.map(r => r.member_id);
  expect(replaced).toHaveLength(4);
  expect(new Set(replaced).size).toBe(4);
  for (const id of replaced) expect(id).toMatch(/^deleted-[0-9a-f]{32}$/);
});
