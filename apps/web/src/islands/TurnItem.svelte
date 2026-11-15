<script lang="ts">
  // One speech. Rendered on the server by Astro pages (no JavaScript) and inside the live island, so both
  // show the same markup and labels. Text is plain: Svelte escapes it; never {@html}. Only the *em* and
  // **strong** models write are turned into elements, run by run.
  import type { Side } from '@debate-arena/engine';
  import { t } from '../i18n/t';
  import { inlineEmphasis, paragraphs, previewLength, sideLabel } from '../lib/debate';

  interface Props {
    phase: string;
    speaker: string;
    side: Side;
    text: string;
    truncated: boolean;
  }

  let { phase, speaker, side, text, truncated }: Props = $props();

  // The opening paragraphs show, up to about PREVIEW_WORDS so a greeting is not all there is; the rest wait
  // behind a disclosure that works without JavaScript. A speech cut off at the word limit ends in an ellipsis,
  // so the cut shows in the text itself.
  const all = $derived(truncated ? paragraphs(text).map((p, i, list) => (i === list.length - 1 ? `${p}…` : p)) : paragraphs(text));
  const shown = $derived(all.slice(0, previewLength(all)));
  const rest = $derived(all.slice(previewLength(all)));
</script>

{#snippet paragraph(text: string)}
  <p>
    {#each inlineEmphasis(text) as run, i (i)}{#if run.style === 'strong'}<strong>{run.text}</strong>{:else if run.style === 'em'}<em
          >{run.text}</em
        >{:else}{run.text}{/if}{/each}
  </p>
{/snippet}

<article class="speech speech-{side}">
  <header class="speech-head">
    <h3><span class="visually-hidden">{phase}:</span> {t('floor.speaker', { model: speaker, side: sideLabel(side) })}</h3>
    <span class="ai">{t('label.ai')}</span>
    <span class="rule" aria-hidden="true"></span>
  </header>
  {#each shown as text, i (i)}
    {@render paragraph(text)}
  {/each}
  {#if rest.length > 0}
    <details class="more">
      <summary><span class="when-closed">{t('floor.more')}</span><span class="when-open">{t('floor.less')}</span></summary>
      {#each rest as text, i (i)}
        {@render paragraph(text)}
      {/each}
    </details>
  {/if}
  {#if truncated}
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
  .more summary {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
    margin-top: 0.4rem;
    font-family: var(--font-sans);
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--green);
    text-decoration: underline;
    text-underline-offset: 0.18em;
    cursor: pointer;
  }
  /* The summary stays put when open (keyboard focus stays on it) and offers to show less. */
  .more summary .when-open,
  .more[open] summary .when-closed {
    display: none;
  }
  .more[open] summary .when-open {
    display: inline;
  }
  .cut {
    font-family: var(--font-sans);
    font-size: 0.875rem;
    font-style: italic;
    color: var(--muted);
  }
</style>
