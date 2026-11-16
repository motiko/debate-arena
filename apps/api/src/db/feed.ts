import { isCategory, normaliseTag, type Category } from '@debate-arena/engine';
import type { DebateKind } from '../models/catalog';
import { toRecord, type DebateRecord, type DebateRow } from './debates';

/** What a Viewer asked the feed for. Every filter is optional; together they narrow the list. */
export interface FeedQuery {
  /** Words that must all appear in the Motion or the Tags. */
  q?: string;
  category?: Category;
  tag?: string;
  /** An AI Debater's model, on either Side. */
  model?: string;
  kind?: DebateKind;
  page: number;
}

export const MAX_SEARCH_WORDS = 5;
export const MAX_SEARCH_LENGTH = 100;
const MAX_MODEL_LENGTH = 200;

/** Reads a feed query from request parameters. Anything unusable is dropped, never refused: a bad page is page 1. */
export function parseFeedQuery(params: Record<string, string | undefined>): FeedQuery {
  const words = (params.q ?? '').slice(0, MAX_SEARCH_LENGTH).trim().split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_WORDS);
  const page = /^\d+$/.test(params.page ?? '') ? Number(params.page) : 1;
  const tag = params.tag ? normaliseTag(params.tag) : null;
  const model = params.model?.trim();
  return {
    ...(words.length > 0 ? { q: words.join(' ') } : {}),
    ...(isCategory(params.category) ? { category: params.category } : {}),
    ...(tag ? { tag } : {}),
    ...(model && model.length <= MAX_MODEL_LENGTH ? { model } : {}),
    ...(params.kind === 'live' || params.kind === 'batch' ? { kind: params.kind } : {}),
    page: page >= 1 ? page : 1,
  };
}

/** A LIKE pattern matching `text` anywhere, with LIKE's own wildcards (and the escape) taken literally. */
const contains = (text: string) => `%${text.replace(/[\\%_]/g, c => `\\${c}`)}%`;

// Only completed, listed Debates are in feeds (Unlisted and Blocked ones stay out).
const LISTED = `visibility = 'listed' AND status = 'complete'`;

function where(query: FeedQuery): { sql: string; binds: unknown[] } {
  const clauses = [LISTED];
  const binds: unknown[] = [];
  for (const word of query.q?.split(' ') ?? []) {
    clauses.push(`(json_extract(setup_json, '$.motion.text') LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\')`);
    binds.push(contains(word), contains(word));
  }
  if (query.category) {
    clauses.push('category = ?');
    binds.push(query.category);
  }
  if (query.tag) {
    clauses.push('EXISTS (SELECT 1 FROM json_each(debates.tags_json) WHERE json_each.value = ?)');
    binds.push(query.tag);
  }
  if (query.model) {
    // A Custom Debater's model is self-reported, never verified: only AI Debaters count.
    clauses.push(
      `((json_extract(setup_json, '$.debaters.for.kind') = 'ai' AND json_extract(setup_json, '$.debaters.for.model') = ?)
        OR (json_extract(setup_json, '$.debaters.against.kind') = 'ai' AND json_extract(setup_json, '$.debaters.against.model') = ?))`,
    );
    binds.push(query.model, query.model);
  }
  if (query.kind) {
    clauses.push('kind = ?');
    binds.push(query.kind);
  }
  return { sql: clauses.join(' AND '), binds };
}

/** One page of the feed, newest first, and how many Debates match in all. */
export async function searchDebates(db: D1Database, query: FeedQuery, pageSize: number): Promise<{ debates: DebateRecord[]; total: number }> {
  const { sql, binds } = where(query);
  const [rows, count] = await db.batch([
    db
      .prepare(`SELECT * FROM debates WHERE ${sql} ORDER BY completed_at DESC, id DESC LIMIT ? OFFSET ?`)
      .bind(...binds, pageSize, (query.page - 1) * pageSize),
    db.prepare(`SELECT COUNT(*) AS n FROM debates WHERE ${sql}`).bind(...binds),
  ]);
  return {
    debates: ((rows?.results ?? []) as DebateRow[]).map(row => toRecord(row, [])),
    total: ((count?.results[0] as { n: number } | undefined)?.n) ?? 0,
  };
}

/** The Tags most used on listed, completed Debates, most used first. */
export async function popularTags(db: D1Database, limit: number): Promise<{ tag: string; count: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT tag.value AS tag, COUNT(*) AS count FROM debates, json_each(debates.tags_json) AS tag
       WHERE ${LISTED} AND debates.tags_json IS NOT NULL
       GROUP BY tag.value ORDER BY count DESC, tag ASC LIMIT ?`,
    )
    .bind(limit)
    .all<{ tag: string; count: number }>();
  return results;
}
