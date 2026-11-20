<script lang="ts">
  // One speech. Rendered on the server by Astro pages (no JavaScript) and inside the live island, so both
  // show the same markup and labels. Text is plain: Svelte escapes it; never {@html}. Only the *em* and
  // **strong** models write are turned into elements, run by run.
  import type { Side } from '@debate-arena/engine';
  import { t } from '../i18n/t';
  import { closeEmphasis, inlineEmphasis, paragraphs, sideLabel } from '../lib/debate';

  interface Props {
    phase: string;
    speaker: string;
    side: Side;
    text: string;
    truncated: boolean;
    /** The speech as it is being written: all of it shows, growing, with a caret at its end. */
    draft?: boolean;
    /** An API Debater's Turn: labelled as submitted via API, since the platform did not generate it (ADR 0005). */
    submitted?: boolean;
  }

  let { phase, speaker, side, text, truncated, draft = false, submitted = false }: Props = $props();

  // The whole speech shows: the Phase's word limit keeps it short enough to read in place. A speech cut off at
  // the word limit ends in an ellipsis, so the cut shows in the text itself. A draft's last paragraph may stop
  // inside emphasis; it shows emphasised, not as asterisks.
  const all = $derived(
    paragraphs(text).map((p, i, list) => (i < list.length - 1 ? p : truncated ? `${p}…` : draft ? closeEmphasis(p) : p)),
  );
</script>

{#snippet paragraph(text: string, caret: boolean)}
  <p>
    {#each inlineEmphasis(text) as run, i (i)}{#if run.style === 'strong'}<strong>{run.text}</strong>{:else if run.style === 'em'}<em
          >{run.text}</em
        >{:else}{run.text}{/if}{/each}{#if caret}<span class="caret" aria-hidden="true"></span>{/if}
  </p>
{/snippet}

<article class="speech speech-{side}" class:speech-draft={draft}>
  <header class="speech-head">
    <h3><span class="visually-hidden">{phase}:</span> {t('floor.speaker', { model: speaker, side: sideLabel(side) })}</h3>
    <span class="ai">{t(submitted ? 'label.api' : 'label.ai')}</span>
    <span class="rule" aria-hidden="true"></span>
  </header>
  {#each all as text, i (i)}
    {@render paragraph(text, draft && i === all.length - 1)}
  {/each}
  {#if truncated && !draft}
    <p class="cut">{t('turn.truncated')}</p>
  {/if}
</article>

<style>
  .speech {
    padding: 1.25rem 1.4rem 1.1rem;
    border-radius: var(--radius);
    font-family: var(--font-serif);
    font-size: 1.125rem;
    line-height: 1.7;
  }
  .speech-for {
    background: var(--for-tint);
  }
  .speech-against {
    background: var(--against-tint);
  }
  .speech p {
    margin-top: 0.85rem;
    white-space: pre-line;
  }
  .speech-head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-family: var(--font-sans);
    line-height: 1.3;
  }
  .speech-head h3 {
    font-family: var(--font-sans);
    font-size: 0.95rem;
  }
  .speech-for h3 {
    color: var(--for);
  }
  .speech-against h3 {
    color: var(--against);
  }
  .speech-against .speech-head {
    flex-direction: row-reverse;
  }
  .ai {
    font-size: 0.8rem;
    color: var(--muted);
    white-space: nowrap;
  }
  /* The rule runs from the speaker toward the floor; it stops at the speech's edge. */
  .rule {
    flex: 1;
    min-width: 1rem;
    height: 2px;
    background: currentColor;
    opacity: 0.45;
  }
  .speech-for .rule {
    color: var(--for);
  }
  .speech-against .rule {
    color: var(--against);
  }
  .cut {
    font-family: var(--font-sans);
    font-size: 0.875rem;
    font-style: italic;
    color: var(--muted);
  }
  /* The pen on the page: a thin bar in the Side's colour where the speech is being written. */
  .caret {
    display: inline-block;
    width: 2px;
    height: 1.05em;
    margin-left: 0.15em;
    vertical-align: -0.15em;
    background: currentColor;
  }
  .speech-for .caret {
    background: var(--for);
  }
  .speech-against .caret {
    background: var(--against);
  }
  @media (prefers-reduced-motion: no-preference) {
    .caret {
      animation: caret-blink 1s steps(2, jump-none) infinite;
    }
  }
  @keyframes caret-blink {
    to {
      opacity: 0;
    }
  }
</style>
