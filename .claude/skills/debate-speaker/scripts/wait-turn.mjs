#!/usr/bin/env node
// Waits until a Debate awaits this Side's Custom Debater Turn, or ends, and prints one JSON line describing it.
// Usage: node wait-turn.mjs <debate-id> <for|against|end> [max-seconds]
//   {"turn":{...}}   it is this Side's Turn: slot, phase, word limit, deadline and the transcript so far
//   {"done":{...}}   the Debate is no longer running (complete or failed), with the verdict when there is one
//   {"waiting":true} max-seconds passed with neither; run it again
// Side "end" only waits for the Debate to end. Reads need no token.
const [id, side, maxArg] = process.argv.slice(2);
if (!id || !['for', 'against', 'end'].includes(side)) {
  console.error('Usage: node wait-turn.mjs <debate-id> <for|against|end> [max-seconds]');
  process.exit(2);
}
const base = (process.env.DEBATE_ARENA_URL?.trim() || 'https://debate-arena-web.motiko.workers.dev').replace(/\/+$/, '');
const until = Date.now() + Number(maxArg ?? 540) * 1000;
const url = `${base}/debates/${encodeURIComponent(id)}`;

/** The phase of each slot, in speaking order. */
const slots = format => format.phases.flatMap(phase => phase.order.map(side => ({ phase, side })));

for (;;) {
  const response = await fetch(`${base}/api/debates/${encodeURIComponent(id)}`).catch(() => null);
  if (response?.status === 404 || response?.status === 410) {
    console.log(JSON.stringify({ done: { status: response.status === 410 ? 'blocked' : 'not found', url } }));
    process.exit(1);
  }
  if (response?.ok) {
    const d = await response.json();
    if (d.status !== 'running') {
      console.log(JSON.stringify({ done: { status: d.status, url, verdict: d.verdict, audience: d.audienceResult } }));
      process.exit(0);
    }
    if (side !== 'end' && d.awaiting?.side === side) {
      const order = slots(d.format);
      const { phase } = order[d.awaiting.slotIndex];
      console.log(JSON.stringify({
        turn: {
          debate: id,
          url,
          motion: d.motion,
          side,
          slot: d.awaiting.slotIndex,
          phase: phase.name,
          maxWords: phase.maxWords,
          deadline: d.awaiting.deadline,
          remaining: order.slice(d.awaiting.slotIndex + 1).map(s => `${s.phase.name} ${s.side}`),
          transcript: d.turns.map(t => ({ phase: d.format.phases[t.phaseIndex]?.name, side: t.side, text: t.text })),
        },
      }));
      process.exit(0);
    }
  }
  // A transient network or server error is retried like an unchanged Debate.
  if (Date.now() > until) {
    console.log(JSON.stringify({ waiting: true }));
    process.exit(0);
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
