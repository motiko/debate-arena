import { env, exports } from 'cloudflare:workers';
import type { Category } from '@debate-arena/engine';
import { expect, test } from 'vitest';
import { completeDebate, createDebate, saveLabels, type NewDebate } from '../src/db/debates';
import { MAX_PAGE, parseFeedQuery, popularTags } from '../src/db/feed';
import { newDebate, sampleSetup, uniqueId } from './helpers';

interface FeedPage {
  debates: { id: string; motion: string; category: string | null; tags: string[] }[];
  page: number;
  pageCount: number;
  total: number;
}

let minute = 0;

/** A completed, listed, labelled Debate; each one completes a minute after the last, so the feed order is known. */
async function seed(opts: { motion?: string; category?: Category; tags?: string[]; overrides?: Partial<NewDebate> } = {}) {
  const d = newDebate({ setup: { ...sampleSetup, motion: { text: opts.motion ?? 'Remote work beats office work' } }, ...opts.overrides });
  await createDebate(env.DB, d);
  minute += 1;
  await completeDebate(env.DB, d.id, null, new Date(Date.UTC(2026, 10, 14, 0, minute)).toISOString());
  await saveLabels(env.DB, d.id, { category: opts.category ?? 'society', tags: opts.tags ?? [] });
  return d.id;
}

async function feed(query: string): Promise<FeedPage> {
  const res = await exports.default.fetch(`https://api.test/api/debates?${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as FeedPage;
}

const tag = () => uniqueId('t').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(-20);

test('a feed entry carries its Category and Tags', async () => {
  const t = tag();
  const id = await seed({ category: 'science', tags: [t, 'space'] });
  const page = await feed(`tag=${t}`);
  expect(page.debates).toEqual([expect.objectContaining({ id, category: 'science', tags: [t, 'space'] })]);
  expect(page).toMatchObject({ page: 1, pageCount: 1, total: 1 });
});

test('filters by Category together with a Tag', async () => {
  const t = tag();
  const science = await seed({ category: 'science', tags: [t] });
  await seed({ category: 'sport', tags: [t] });
  expect((await feed(`tag=${t}&category=science`)).debates.map(d => d.id)).toEqual([science]);
});

test('an unknown Category or kind is ignored rather than refused', async () => {
  const t = tag();
  await seed({ tags: [t] });
  expect((await feed(`tag=${t}&category=cooking&kind=weird`)).total).toBe(1);
});

test('the feed says which query it applied, so a Viewer is never shown a filter that was dropped', async () => {
  const page = (await feed('category=cooking&tag=x&kind=live&q=%20cats%20%20dogs&page=abc')) as FeedPage & { query: unknown };
  expect(page.query).toEqual({ q: 'cats dogs', kind: 'live', page: 1 });
});

test('filters by a Debater model on either Side, never a Custom Debater\'s self-reported model', async () => {
  const t = tag();
  const model = `${tag()}/m`;
  const forSide = await seed({ tags: [t], overrides: { setup: { ...sampleSetup, debaters: { ...sampleSetup.debaters, for: { kind: 'ai', model } } } } });
  const againstSide = await seed({ tags: [t], overrides: { setup: { ...sampleSetup, debaters: { ...sampleSetup.debaters, against: { kind: 'ai', model } } } } });
  await seed({ tags: [t], overrides: { setup: { ...sampleSetup, debaters: { ...sampleSetup.debaters, for: { kind: 'api', model } } } } });
  expect((await feed(`tag=${t}&model=${encodeURIComponent(model)}`)).debates.map(d => d.id)).toEqual([againstSide, forSide]);
});

test('filters Slow Debates', async () => {
  const t = tag();
  const slow = await seed({ tags: [t], overrides: { kind: 'batch' } });
  await seed({ tags: [t] });
  expect((await feed(`tag=${t}&kind=batch`)).debates.map(d => d.id)).toEqual([slow]);
});

test('search matches every word, in the Motion or the Tags, whatever the case', async () => {
  const t = tag();
  const both = await seed({ motion: `Zebras ${t} should vote`, tags: ['democracy'] });
  await seed({ motion: `Zebras ${t} should swim` });
  expect((await feed(`q=${encodeURIComponent(`zebras ${t.toUpperCase()} DEMOCRACY`)}`)).debates.map(d => d.id)).toEqual([both]);
});

test('search treats % and _ as plain characters', async () => {
  const t = tag();
  const literal = await seed({ motion: `${t} 100% of_us` });
  await seed({ motion: `${t} 1000 offus` });
  expect((await feed(`q=${encodeURIComponent(`${t} 100%`)}`)).debates.map(d => d.id)).toEqual([literal]);
  expect((await feed(`q=${encodeURIComponent(`${t} of_us`)}`)).debates.map(d => d.id)).toEqual([literal]);
});

test('pages hold twenty Debates, newest first, and say how many pages there are', async () => {
  const t = tag();
  const ids: string[] = [];
  for (let i = 0; i < 21; i++) ids.push(await seed({ tags: [t] }));
  const first = await feed(`tag=${t}`);
  expect(first).toMatchObject({ page: 1, pageCount: 2, total: 21 });
  expect(first.debates).toHaveLength(20);
  expect(first.debates[0]?.id).toBe(ids[20]);
  const second = await feed(`tag=${t}&page=2`);
  expect(second.debates.map(d => d.id)).toEqual([ids[0]]);
  expect(second).toMatchObject({ page: 2, pageCount: 2 });
  expect(await feed(`tag=${t}&page=9`)).toMatchObject({ debates: [], page: 9, pageCount: 2, total: 21 });
});

test.each(['0', '-3', 'abc', '1.5', ''])('page=%j reads as the first page', page => {
  expect(parseFeedQuery({ page }).page).toBe(1);
});

test('an absurdly large page is an empty page, not an error', async () => {
  expect(parseFeedQuery({ page: '99999999999999999999' }).page).toBe(MAX_PAGE);
  expect(await feed('page=99999999999999999999')).toMatchObject({ debates: [], page: MAX_PAGE });
});

test('the search is cut to five words and a hundred characters', () => {
  expect(parseFeedQuery({ q: '  a  b c d e f g ' }).q).toBe('a b c d e');
  expect(parseFeedQuery({ q: 'x'.repeat(150) }).q).toHaveLength(100);
  expect(parseFeedQuery({ q: '   ' }).q).toBeUndefined();
});

test('Unlisted and unfinished Debates are never found', async () => {
  const t = tag();
  const unlisted = await seed({ tags: [t] });
  await env.DB.prepare(`UPDATE debates SET visibility = 'unlisted' WHERE id = ?`).bind(unlisted).run();
  const running = newDebate();
  await createDebate(env.DB, running);
  await saveLabels(env.DB, running.id, { category: 'society', tags: [t] });
  expect(await feed(`tag=${t}`)).toMatchObject({ debates: [], total: 0, pageCount: 1 });
  expect((await popularTags(env.DB, 10_000)).map(x => x.tag)).not.toContain(t);
});

test('popular Tags count listed, completed Debates', async () => {
  const t = tag();
  await seed({ tags: [t] });
  await seed({ tags: [t] });
  expect((await popularTags(env.DB, 10_000)).find(x => x.tag === t)).toEqual({ tag: t, count: 2 });
  const res = await exports.default.fetch('https://api.test/api/tags');
  expect(((await res.json()) as { tags: unknown[] }).tags.length).toBeLessThanOrEqual(20);
});

test('the date cursor still works, with the paging fields', async () => {
  const page = await feed(`before=${encodeURIComponent('2100-01-01T00:00:00.000Z')}`);
  expect(page).toMatchObject({ page: 1, pageCount: 1, total: page.debates.length });
});
