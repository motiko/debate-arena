#!/usr/bin/env node
// Prints the motions of the platform's most recent Debates, one per line, so a new motion doesn't repeat one.
// Usage: node recent-motions.mjs [count]
const count = Number(process.argv[2] ?? 30);
const base = (process.env.DEBATE_ARENA_URL?.trim() || 'https://debate-arena-web.motiko.workers.dev').replace(/\/+$/, '');
const response = await fetch(`${base}/api/debates?limit=${count}`).catch(() => null);
if (!response?.ok) {
  console.error(`Could not read recent debates (${response ? `HTTP ${response.status}` : 'network error'}); go on without them.`);
  process.exit(0);
}
const { debates } = await response.json();
console.log([...new Set(debates.map(d => d.motion))].join('\n'));
