<script lang="ts">
  // A running Debate's Turns, kept up to date over the Debate's WebSocket. After each (re)connect the Debate is
  // fetched once, so Turns written between page render and socket open still appear, exactly once. When the
  // Debate ends, the rest of the page (dispatch box, after-vote, outcome) is brought up to date in place.
  import type { DebateEvent } from '@debate-arena/api-client';
  import type { Side, Turn } from '@debate-arena/engine';
  import { onMount } from 'svelte';
  import PhaseFloor from './PhaseFloor.svelte';
  import { t } from '../i18n/t';
  import { applyDraft, debaterLabel, mergeTurns, nextSpeaker, type Draft, type SlotTurn } from '../lib/debate';
  import { connectLive, liveUrl, type LiveStatus } from '@debate-arena/api-client/live';
  import { refreshRegions, type RefreshOptions } from '../lib/refresh';
  import { Typist } from '../lib/typist';

  interface Props {
    debateId: string;
    format: { phases: { name: string; order: Side[]; maxWords: number }[] };
    speakers: Record<Side, string>;
    initialTurns: Turn[];
    /** The Sides whose Debater is an API Debater. */
    apiSides?: Side[];
    /** The API slot the Debate already waits for when the page is rendered. */
    initialAwaiting?: number | null;
    fetcher?: typeof fetch;
    WebSocketImpl?: typeof WebSocket;
    reload?: () => void;
    refresh?: (options: RefreshOptions) => Promise<boolean>;
    /** Write speeches out at an even pace; off when the reader prefers reduced motion. */
    smooth?: boolean;
  }

  let {
    debateId,
    format,
    speakers,
    initialTurns,
    apiSides = [],
    initialAwaiting = null,
    fetcher = fetch,
    WebSocketImpl,
    reload = () => location.reload(),
    refresh = refreshRegions,
    smooth = !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches),
  }: Props = $props();

  const now = () => performance.now();
  const requestFrame = (callback: () => void) =>
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : window.setTimeout(callback, 16);
  const cancelFrame = (id: number) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id));

  // svelte-ignore state_referenced_locally
  let turns = $state<Turn[]>(initialTurns);
  // A Custom Debater may name itself with its first Turn; its Turns here show the name at once. The bench above is
  // server-rendered and shows it on the next load.
  // svelte-ignore state_referenced_locally
  let names = $state<Record<Side, string>>({ ...speakers });
  let waiting: SlotTurn[] = [];
  let status = $state<LiveStatus>('connecting');
  let outcome = $state<'running' | 'complete' | 'failed'>('running');
  // Whether the page around the floor caught up with the end; false offers a reload instead.
  let caughtUp = $state<boolean | null>(null);

  // The next speech as it has arrived; gone once its Turn is on the floor.
  let draft = $state<Draft | null>(null);
  // The API slot the Debate waits for; only ever the next slot counts, so a stale one shows nothing.
  // svelte-ignore state_referenced_locally
  let awaitingSlot = $state<number | null>(initialAwaiting);

  // What the floor shows of it: written out at an even pace by the Typist, so chunks do not land all at once. A
  // finished Turn whose writing has not caught up stays in the seat (`settling`) until it has, then takes its place
  // on the floor, where the live region announces it. With reduced motion, drafts show as they arrive.
  let written = $state<Draft | null>(null);
  let settling = $state<number | null>(null);
  let typist: { slotIndex: number; typist: Typist } | null = null;
  let frame: number | null = null;

  const floorTurns = $derived(settling === null ? turns : turns.slice(0, settling));
  const next = $derived(settling !== null ? nextSpeaker(format, settling) : outcome === 'running' ? nextSpeaker(format, turns.length) : null);
  const statusText = $derived(
    outcome === 'failed'
      ? t('debate.failed')
      : status === 'open' && next === null
        ? t('live.deliberating')
        : t(`live.${status}`),
  );

  function write() {
    if (!smooth) {
      written = draft;
      return;
    }
    const slotIndex = settling ?? draft?.slotIndex;
    const text = settling !== null ? turns[settling]!.text : draft?.text;
    if (slotIndex === undefined || text === undefined) return stopWriting();
    if (typist?.slotIndex !== slotIndex) typist = { slotIndex, typist: new Typist() };
    typist.typist.push(text, now(), settling !== null);
    frame ??= requestFrame(step);
  }

  function step() {
    frame = null;
    if (!typist) return;
    typist.typist.tick(now());
    written = { slotIndex: typist.slotIndex, text: typist.typist.text };
    if (typist.typist.done) {
      // The finished Turn is written: it takes its place, and the next speech (if it has begun) is written next.
      settling = null;
      typist = null;
      written = null;
      if (draft && draft.slotIndex === turns.length) write();
    } else if (!typist.typist.caughtUp) frame = requestFrame(step);
  }

  function stopWriting() {
    if (frame !== null) cancelFrame(frame);
    frame = null;
    typist = null;
    written = null;
    settling = null;
  }

  function add(incoming: SlotTurn[]) {
    const before = turns.length;
    turns = mergeTurns(turns, [...waiting, ...incoming]);
    waiting = [...waiting, ...incoming].filter(s => s.slotIndex >= turns.length);
    if (draft && draft.slotIndex < turns.length) draft = null;
    if (turns.length === before) return;
    // The speech being written is finished: write it to its end. Any later Turn is already history; show it now.
    if (smooth && typist && typist.slotIndex === before && turns.length === before + 1) {
      settling = before;
      write();
    } else stopWriting();
  }

  function onDraft(event: Draft) {
    draft = applyDraft(draft, event, turns.length);
    if (settling === null) write();
  }

  async function catchUp(live: { close(): void }) {
    try {
      const response = await fetcher(`/api/debates/${encodeURIComponent(debateId)}`);
      if (response.status === 410) return blocked(live);
      if (!response.ok) return;
      const debate = (await response.json()) as { status: string; turns: Turn[] };
      add(debate.turns.map((turn, slotIndex) => ({ slotIndex, turn })));
      if (debate.status === 'complete' || debate.status === 'failed') void finish(debate.status, live);
    } catch {
      // The socket still delivers new Turns; the next reconnect tries again.
    }
  }

  /** A Moderator Blocked the Debate: stop showing it at once, and reload to the Blocked page. */
  function blocked(live: { close(): void }) {
    turns = [];
    waiting = [];
    draft = null;
    stopWriting();
    live.close();
    reload();
  }

  async function finish(result: 'complete' | 'failed', live: { close(): void }) {
    if (outcome !== 'running') return;
    outcome = result;
    live.close();
    // Nothing stale stays: the dispatch box, the after-vote and the outcome are rendered again by the server,
    // which applies the hybrid rule for this reader and announces what changed.
    caughtUp = await refresh({ fetcher });
  }

  onMount(() => {
    const live = connectLive(
      liveUrl(location.origin, debateId),
      {
        onEvent(event: DebateEvent) {
          if (event.type === 'draft') onDraft(event);
          else if (event.type === 'awaiting') awaitingSlot = event.slotIndex;
          else if (event.type === 'turn') add([{ slotIndex: event.slotIndex, turn: event.turn }]);
          // A Custom Debater's label needs no catalog.
          else if (event.type === 'debater') names[event.side] = debaterLabel(event.debater, []);
          // The Verdict comes first, then the AI Audience; the Debate is complete (and votes open) after both.
          else if (event.type === 'complete') void finish('complete', live);
          else if (event.type === 'failed') void finish('failed', live);
          else if (event.type === 'blocked') blocked(live);
        },
        onStatus(next) {
          status = next;
          if (next === 'open') void catchUp(live);
        },
      },
      WebSocketImpl ? { WebSocketImpl } : {},
    );
    return () => {
      live.close();
      stopWriting();
    };
  });
</script>

<div role="log" aria-live="polite" aria-relevant="additions" aria-label={t('live.region')} class="stack">
  <PhaseFloor
    {format}
    turns={floorTurns}
    speakers={names}
    {next}
    draft={written}
    {apiSides}
    awaiting={settling === null && awaitingSlot === turns.length}
  />
</div>

<div class="live-status" class:closing={outcome === 'complete'} role="status">
  {#if outcome === 'complete'}
    <span class="rule" aria-hidden="true"></span>
    <span class="lozenge" aria-hidden="true"></span>
    <span class="closing-line">{t('live.finished')}</span>
    <span class="lozenge" aria-hidden="true"></span>
    <span class="rule" aria-hidden="true"></span>
  {:else}
    <p>
      {#if outcome === 'running' && status === 'open'}<span class="live-dot" aria-hidden="true"></span>{/if}
      {statusText}
    </p>
  {/if}
</div>
{#if caughtUp === false}
  <p class="fallback"><a href={`/debates/${debateId}`}>{t('live.reload')}</a></p>
{/if}

<style>
  .live-status {
    margin-top: 1.5rem;
    font-weight: 600;
  }
  .live-status p {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  /* The end of the Debate: the floor closes with a brass rule drawn out from the middle, as the house rises. */
  .closing {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 3rem;
  }
  .closing .rule {
    flex: 1;
    height: 2px;
    background: var(--brass);
  }
  .closing .rule:first-child {
    transform-origin: right;
  }
  .closing .rule:last-child {
    transform-origin: left;
  }
  .closing .lozenge {
    --size: 0.55rem;
  }
  .closing-line {
    font-family: var(--font-serif);
    font-size: clamp(1.35rem, 1.1rem + 1vw, 1.75rem);
    text-align: center;
    text-wrap: balance;
  }
  @media (prefers-reduced-motion: no-preference) {
    .closing .rule {
      animation: draw 1.2s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .closing-line {
      animation: rise 0.9s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
  }
  @keyframes draw {
    from {
      transform: scaleX(0.15);
    }
  }
  @keyframes rise {
    from {
      opacity: 0.4;
      transform: translateY(0.35rem);
    }
  }
  .fallback {
    margin-top: 0.75rem;
    text-align: center;
  }
</style>
