// Follows a Debate live: loads it over HTTP, then applies the room's events (the same order the web uses).
// The socket opens first and its events wait until the Debate is loaded, so nothing written in between is lost;
// after a reconnect the Debate is loaded again and only Turns not yet printed are printed.
import { connectLive, createApiClient, liveUrl, type DebateEvent, type LiveOptions, type PublicDebate } from '@debate-arena/api-client';
import { renderAiAudience, renderDebate, renderHeader, renderTurn, renderVerdict, renderVoteLink, turnHeader } from './render.ts';
import type { CliDeps } from './run.ts';
import { safeOutput } from './terminal.ts';

type Turn = PublicDebate['turns'][number];

export interface FollowDeps extends CliDeps {
  base: string;
  liveOptions?: Omit<LiveOptions, 'WebSocketImpl'>;
}

/** Returns 0 when the Debate completes; 1 when it failed, was Blocked, or the live connection gave up. */
export function follow(debateId: string, deps: FollowDeps): Promise<number> {
  const { out, err } = safeOutput(deps, deps.env.DEBATE_ARENA_TOKEN?.trim() || undefined);
  const client = createApiClient(deps.base, { fetch: deps.fetch });

  return new Promise<number>(resolve => {
    let debate: PublicDebate | null = null;
    /** Finished Turns printed so far: the next Turn to print is this slot. */
    let printed = 0;
    let verdictPrinted = false;
    /** The slot whose draft is on screen (TTY only), and how much of it. */
    let draftSlot: number | null = null;
    let shown = '';
    let done = false;
    // Events and reloads run one at a time, in order.
    let queue: Promise<void> = Promise.resolve();
    const enqueue = (step: () => Promise<void> | void) => {
      queue = queue.then(step).catch(error => {
        err(`${error instanceof Error ? error.message : String(error)}\n`);
        finish(1);
      });
    };

    const finish = (code: number) => {
      if (done) return;
      done = true;
      live.close();
      resolve(code);
    };

    const printTurn = (turn: Turn) => {
      if (!debate) return;
      if (draftSlot === printed) {
        const rest = turn.text.startsWith(shown) ? turn.text.slice(shown.length) : `\n[rewritten]\n${turn.text}`;
        out(`${rest}${turn.truncated ? ' (cut at the word limit)' : ''}\n`);
      } else {
        out(`\n${renderTurn(debate, turn)}`);
      }
      printed += 1;
      draftSlot = null;
      shown = '';
    };

    const printEnd = (current: PublicDebate) => {
      if (current.status === 'complete') {
        if (current.verdict && !verdictPrinted) out(`\n${renderVerdict(current.verdict)}`);
        if (current.aiAudience) out(`\n${renderAiAudience(current.aiAudience)}`);
        out(`\n${renderVoteLink(deps.base, current.id)}`);
        finish(0);
      } else if (current.status === 'failed') {
        err('The Debate failed.\n');
        finish(1);
      }
    };

    /** Loads the Debate and prints what is not on screen yet. */
    const load = async (first: boolean) => {
      const response = await client.api.debates[':id'].$get({ param: { id: debateId } });
      if (response.status === 410) {
        err('This Debate was Blocked by a Moderator.\n');
        return finish(1);
      }
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        err(`${body.error ?? `Could not load the Debate (${response.status})`}\n`);
        return finish(1);
      }
      const current = (await response.json()) as PublicDebate;
      debate = current;
      if (first && current.status !== 'running') {
        out(renderDebate(current, deps.base));
        return finish(current.status === 'complete' ? 0 : 1);
      }
      if (first) out(renderHeader(current));
      for (const turn of current.turns.slice(printed)) printTurn(turn);
      if (current.verdict && !verdictPrinted) {
        out(`\n${renderVerdict(current.verdict)}`);
        verdictPrinted = true;
      }
      printEnd(current);
    };

    const draft = (slotIndex: number, text: string) => {
      if (!deps.isTTY || !debate || slotIndex !== printed) return;
      if (draftSlot !== slotIndex) {
        if (text === '') return;
        out(`\n${turnHeader(debate, debate.turns[slotIndex] ?? slotOf(debate, slotIndex))}\n`);
        draftSlot = slotIndex;
        shown = '';
      }
      if (text === '') {
        if (shown) out('\n[retrying]\n');
        shown = '';
      } else if (text.startsWith(shown)) {
        out(text.slice(shown.length));
        shown = text;
      } else {
        out(`\n[rewritten]\n${text}`);
        shown = text;
      }
    };

    const apply = async (event: DebateEvent) => {
      if (done || !debate) return;
      switch (event.type) {
        case 'draft':
          return draft(event.slotIndex, event.text);
        case 'turn':
          if (event.slotIndex < printed) return;
          if (event.slotIndex > printed) return load(false);
          return printTurn(event.turn);
        case 'verdict':
          if (!verdictPrinted) out(`\n${renderVerdict(event.verdict)}`);
          verdictPrinted = true;
          return;
        case 'complete':
          // A Turn or the Verdict may have been missed (broadcasts are best-effort): load first, so the end prints them.
          await load(false);
          if (done) return;
          if (event.aiAudience) out(`\n${renderAiAudience(event.aiAudience)}`);
          out(`\n${renderVoteLink(deps.base, debateId)}`);
          return finish(0);
        case 'failed':
          err(`The Debate failed: ${event.reason}\n`);
          return finish(1);
        case 'blocked':
          err('This Debate was Blocked by a Moderator.\n');
          return finish(1);
      }
    };

    const live = connectLive(
      liveUrl(deps.base, debateId),
      {
        onEvent: event => enqueue(() => apply(event)),
        onStatus: status => {
          if (status === 'open') {
            // Turns written before this socket opened (first connect or reconnect) never reach it: load again.
            enqueue(() => load(false));
          } else if (status === 'closed' && !done) {
            err(`Lost the live connection. Resume with: debate show ${debateId} --follow\n`);
            finish(1);
          }
        },
      },
      { ...deps.liveOptions, WebSocketImpl: deps.WebSocketImpl },
    );
    enqueue(() => load(true));
  });
}

/** The phase and Side of a slot, from the Format's speaking order. */
function slotOf(debate: PublicDebate, slotIndex: number): { phaseIndex: number; side: 'for' | 'against' } {
  let index = slotIndex;
  for (const [phaseIndex, phase] of debate.format.phases.entries()) {
    if (index < phase.order.length) return { phaseIndex, side: phase.order[index]! };
    index -= phase.order.length;
  }
  return { phaseIndex: 0, side: 'for' };
}
