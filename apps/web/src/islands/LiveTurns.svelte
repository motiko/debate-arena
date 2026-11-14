<script lang="ts">
  // A running Debate's Turns, kept up to date over the Debate's WebSocket. After each (re)connect the Debate is
  // fetched once, so Turns written between page render and socket open still appear, exactly once.
  import type { DebateEvent } from '@debate-arena/api-client';
  import type { Side, Turn } from '@debate-arena/engine';
  import { onMount } from 'svelte';
  import PhaseFloor from './PhaseFloor.svelte';
  import { t } from '../i18n/t';
  import { mergeTurns, nextSpeaker, type SlotTurn } from '../lib/debate';
  import { connectLive, liveUrl, type LiveStatus } from '../lib/live';

  interface Props {
    debateId: string;
    format: { phases: { name: string; order: Side[]; maxWords: number }[] };
    speakers: Record<Side, string>;
    initialTurns: Turn[];
    fetcher?: typeof fetch;
    WebSocketImpl?: typeof WebSocket;
    reload?: () => void;
  }

  let { debateId, format, speakers, initialTurns, fetcher = fetch, WebSocketImpl, reload = () => location.reload() }: Props = $props();

  // svelte-ignore state_referenced_locally
  let turns = $state<Turn[]>(initialTurns);
  let waiting: SlotTurn[] = [];
  let status = $state<LiveStatus>('connecting');
  let outcome = $state<'running' | 'complete' | 'failed'>('running');

  const next = $derived(outcome === 'running' ? nextSpeaker(format, turns.length) : null);
  const statusText = $derived(
    outcome === 'complete' ? t('live.finished') : outcome === 'failed' ? t('debate.failed') : t(`live.${status}`),
  );

  function add(incoming: SlotTurn[]) {
    turns = mergeTurns(turns, [...waiting, ...incoming]);
    waiting = [...waiting, ...incoming].filter(s => s.slotIndex >= turns.length);
  }

  async function catchUp(live: { close(): void }) {
    try {
      const response = await fetcher(`/api/debates/${encodeURIComponent(debateId)}`);
      if (response.status === 410) return blocked(live);
      if (!response.ok) return;
      const debate = (await response.json()) as { status: string; turns: Turn[] };
      add(debate.turns.map((turn, slotIndex) => ({ slotIndex, turn })));
      if (debate.status === 'complete' || debate.status === 'failed') finish(debate.status, live);
    } catch {
      // The socket still delivers new Turns; the next reconnect tries again.
    }
  }

  /** A Moderator Blocked the Debate: stop showing it at once, and reload to the Blocked page. */
  function blocked(live: { close(): void }) {
    turns = [];
    waiting = [];
    live.close();
    reload();
  }

  function finish(result: 'complete' | 'failed', live: { close(): void }) {
    outcome = result;
    live.close();
  }

  onMount(() => {
    const live = connectLive(
      liveUrl(location, debateId),
      {
        onEvent(event: DebateEvent) {
          if (event.type === 'turn') add([{ slotIndex: event.slotIndex, turn: event.turn }]);
          else if (event.type === 'complete' || event.type === 'verdict') finish('complete', live);
          else if (event.type === 'failed') finish('failed', live);
          else if (event.type === 'blocked') blocked(live);
        },
        onStatus(next) {
          status = next;
          if (next === 'open') void catchUp(live);
        },
      },
      WebSocketImpl ? { WebSocketImpl } : {},
    );
    return () => live.close();
  });
</script>

<div role="log" aria-live="polite" aria-relevant="additions" aria-label={t('live.region')} class="stack">
  <PhaseFloor {format} {turns} {speakers} {next} />
</div>

<p class="live-status" role="status">
  {#if outcome === 'running' && status === 'open'}<span class="dot" aria-hidden="true"></span>{/if}
  {statusText}
  {#if outcome !== 'running'}
    <a href={`/debates/${debateId}`}>{t('live.showVerdict')}</a>
  {/if}
</p>

<style>
  .live-status {
    margin-top: 1.5rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
  }
  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--against);
  }
</style>
