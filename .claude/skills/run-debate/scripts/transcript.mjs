#!/usr/bin/env node
// Prints a finished Debate's motion and Turns as plain text, for the local judge and voter subagents.
// Usage: node transcript.mjs <debate-id>
// It leaves out the debaters' names and models and the platform's verdict, so local judges are not anchored by them.
const [id] = process.argv.slice(2);
if (!id) {
  console.error('Usage: node transcript.mjs <debate-id>');
  process.exit(2);
}
const base = (process.env.DEBATE_ARENA_URL?.trim() || 'https://debate-arena-web.motiko.workers.dev').replace(/\/+$/, '');
const response = await fetch(`${base}/api/debates/${encodeURIComponent(id)}`);
if (!response.ok) {
  console.error(`Could not read debate ${id}: HTTP ${response.status}`);
  process.exit(1);
}
const d = await response.json();
const lines = [`Motion: ${d.motion}`, ''];
for (const t of d.turns) {
  const phase = d.format.phases[t.phaseIndex]?.name ?? 'turn';
  lines.push(`## ${phase} (${t.side === 'for' ? 'FOR' : 'AGAINST'})`, '', t.text.trim(), '');
}
console.log(lines.join('\n'));
