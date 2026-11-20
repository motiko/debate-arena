<script lang="ts">
  // The floor of the house: one section per phase, For speaking from the left bench and Against from the right,
  // the phase headings on the floor line between them. Shared by finished Debate pages (server only) and the
  // live island, so both render the same structure.
  import type { Side, Turn, TurnSlot } from '@debate-arena/engine';
  import TurnItem from './TurnItem.svelte';
  import { t } from '../i18n/t';
  import { sideLabel, type Draft } from '../lib/debate';

  interface Props {
    format: { phases: { name: string; order: Side[]; maxWords: number }[] };
    turns: Turn[];
    speakers: Record<Side, string>;
    next?: TurnSlot | null;
    /** The next speech as it is being written (live only). */
    draft?: Draft | null;
    /** The Sides whose Debater is an API Debater: their Turns are labelled as submitted via API. */
    apiSides?: Side[];
    /** The Debate waits for the next slot's Turn through the API (live only). */
    awaiting?: boolean;
  }

  let { format, turns, speakers, next = null, draft = null, apiSides = [], awaiting = false }: Props = $props();

  // Only the next slot is being written; any other draft is stale.
  const writing = $derived(next && draft && draft.slotIndex === turns.length ? draft.text : null);

  const sections = $derived(
    format.phases
      .map((phase, index) => ({
        index,
        phase,
        turns: turns.filter(turn => turn.phaseIndex === index),
        next: next && next.phaseIndex === index ? next.side : null,
      }))
      .filter(section => section.turns.length > 0 || section.next !== null),
  );
</script>

<div class="floor">
  {#each sections as section (section.index)}
    <section class="phase" aria-labelledby={`phase-${section.index}`}>
      <h2 id={`phase-${section.index}`} class="phase-title">
        {section.phase.name} <span class="limit">{t('floor.words', { count: section.phase.maxWords })}</span>
      </h2>
      {#each section.turns as turn, i (i)}
        <div class="seat seat-{turn.side}">
          <TurnItem
            phase={section.phase.name}
            speaker={speakers[turn.side]}
            side={turn.side}
            text={turn.text}
            truncated={turn.truncated}
            submitted={apiSides.includes(turn.side)}
          />
        </div>
      {/each}
      {#if section.next}
        <!-- The speech as it is written is for the eye only: the live region announces each Turn once, finished,
             and a screen reader hears who is speaking from the line below. -->
        {#if writing !== null}
          <div class="seat seat-{section.next}" aria-hidden="true">
            <TurnItem
              phase={section.phase.name}
              speaker={speakers[section.next]}
              side={section.next}
              text={writing}
              truncated={false}
              draft
              submitted={apiSides.includes(section.next)}
            />
          </div>
        {/if}
        <p class="seat seat-{section.next} next" class:visually-hidden={writing !== null}>
          <span class="live-dot" aria-hidden="true"></span>{t(writing !== null ? 'floor.speaking' : awaiting ? 'floor.awaiting' : 'floor.next', {
            side: sideLabel(section.next),
          })}
        </p>
      {/if}
    </section>
  {/each}
</div>

<style>
  .floor {
    position: relative;
  }
  .phase {
    display: grid;
    gap: 1rem;
  }
  .phase + .phase {
    margin-top: 2.5rem;
  }
  /* Phone: the phase heading is a full-width rule with its name in the middle; benches indent from the far edge. */
  .phase-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-family: var(--font-sans);
    font-size: 0.95rem;
    color: var(--green);
  }
  .phase-title::before,
  .phase-title::after {
    content: '';
    flex: 1;
    height: 2px;
    background: var(--green);
    opacity: 0.55;
  }
  .limit {
    font-weight: 400;
    color: var(--muted);
  }
  .seat-for {
    margin-right: 1.75rem;
  }
  .seat-against {
    margin-left: 1.75rem;
  }
  .next {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 1rem 1.25rem;
    border: 1.5px dashed var(--line);
    border-radius: var(--radius);
    color: var(--muted);
    font-weight: 600;
  }
  /* The live marker (global.css) takes the colour of the Side about to speak. */
  .seat-for .live-dot {
    background: var(--for);
  }
  .seat-against .live-dot {
    background: var(--against);
  }

  /* Wide screens: the benches face each other across the floor line; Against answers a little lower. */
  @media (min-width: 48rem) {
    .floor::before {
      content: '';
      position: absolute;
      inset-block: 0;
      left: calc(50% - 1px);
      width: 2px;
      background: var(--green);
      opacity: 0.55;
    }
    .phase {
      grid-template-columns: minmax(0, 1fr) 7.5rem minmax(0, 1fr);
      grid-auto-flow: row dense;
      gap: 1.5rem 0;
    }
    .phase + .phase {
      margin-top: 4rem;
    }
    .phase-title {
      position: relative;
      grid-column: 2;
      grid-row: 1;
      align-self: start;
      flex-direction: column;
      gap: 0;
      margin-top: 1.1rem;
      padding: 0.35rem 0.5rem;
      border: 1.5px solid var(--green);
      border-radius: 999px;
      background: var(--paper);
      text-align: center;
      line-height: 1.25;
      z-index: 1;
    }
    .phase-title::before,
    .phase-title::after {
      content: none;
    }
    .limit {
      font-size: 0.75rem;
    }
    .seat-for {
      grid-column: 1;
      margin-right: 0;
    }
    .seat-against {
      grid-column: 3;
      margin-left: 0;
      margin-top: 5rem;
    }
  }
</style>
