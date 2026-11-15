<script lang="ts">
  // One speech. Rendered on the server by Astro pages (no JavaScript) and inside the live island, so both
  // show the same markup and labels. Text is plain: Svelte escapes it; never {@html}. Only the *em* and
  // **strong** models write are turned into elements, run by run.
  import type { Side } from '@debate-arena/engine';
  import { t, tn } from '../i18n/t';
  import { closeEmphasis, inlineEmphasis, paragraphs, previewLength, sideLabel } from '../lib/debate';

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

  // The opening paragraphs show, up to about PREVIEW_WORDS so a greeting is not all there is; the rest wait
  // behind a disclosure that works without JavaScript. A speech cut off at the word limit ends in an ellipsis,
  // so the cut shows in the text itself. A draft is short-lived and read as it grows, so it is never folded.
  // A draft's last paragraph may stop inside emphasis; it shows emphasised, not as asterisks.
  const all = $derived(
    paragraphs(text).map((p, i, list) => (i < list.length - 1 ? p : truncated ? `${p}…` : draft ? closeEmphasis(p) : p)),
  );
  const preview = $derived(draft ? all.length : previewLength(all));
  const shown = $derived(all.slice(0, preview));
  const rest = $derived(all.slice(preview));
  const restWords = $derived(rest.join(' ').split(/\s+/).filter(Boolean).length);
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
  {#each shown as text, i (i)}
    {@render paragraph(text, draft && i === shown.length - 1)}
  {/each}
  {#if rest.length > 0}
    <details class="more">
      <summary>
        <span class="when-closed"><span class="phrase">{t('floor.more')}</span><span class="count">{' · '}{tn('floor.moreWords', restWords)}</span></span><span
          class="when-open">{t('floor.less')}</span
        >
        <svg class="chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
      </summary>
      {#each rest as text, i (i)}
        {@render paragraph(text, false)}
      {/each}
    </details>
  {/if}
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
  .speech p,
  .more p {
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
  /* Folded, the preview's last lines fade, so the speech reads as going on, not as ending where the fold is. */
  .speech p:has(+ .more:not([open])) {
    mask-image: linear-gradient(to bottom, #000 calc(100% - 3.4em), rgb(0 0 0 / 0.2));
  }
  /* The disclosure is a pill in the Side's colour, saying how much is folded away. Open, it moves below the whole
     speech (where the reader arrives at the end) and offers to fold it again; focus stays on it either way. */
  .more {
    display: flex;
    flex-direction: column;
  }
  .more[open] summary {
    order: 1;
    margin-top: 1rem;
  }
  .more summary {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: 0.45rem;
    min-height: 2.75rem;
    margin-top: 0.6rem;
    padding: 0 0.95rem 0 1.1rem;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
    /* Half the minimum height: a pill on one line, and still even when a narrow screen wraps the count. */
    border-radius: 1.375rem;
    font-family: var(--font-sans);
    font-size: 0.9rem;
    font-weight: 600;
    line-height: 1.2;
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      border-color 0.15s ease;
  }
  .speech-for .more summary {
    color: var(--for);
  }
  .speech-against .more summary {
    color: var(--against);
  }
  .more summary:hover {
    border-color: currentColor;
    background: color-mix(in srgb, currentColor 8%, transparent);
  }
  .more summary .phrase {
    white-space: nowrap;
  }
  .more summary .count {
    font-weight: 400;
    color: var(--muted);
    white-space: nowrap;
  }
  .more summary {
    padding-block: 0.45rem;
  }
  .chevron {
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .more[open] .chevron {
    transform: rotate(180deg);
  }
  .more summary .when-open,
  .more[open] summary .when-closed {
    display: none;
  }
  .more[open] summary .when-open {
    display: inline;
  }
  /* Where the browser can animate to auto height, the rest of the speech unrolls rather than appearing. */
  @media (prefers-reduced-motion: no-preference) {
    .more {
      interpolate-size: allow-keywords;
    }
    .more::details-content {
      height: 0;
      opacity: 0;
      overflow: clip;
      transition:
        height 0.35s cubic-bezier(0.16, 1, 0.3, 1),
        opacity 0.25s ease,
        content-visibility 0.35s allow-discrete;
    }
    .more[open]::details-content {
      height: auto;
      opacity: 1;
    }
    .chevron {
      transition: transform 0.2s ease;
    }
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
