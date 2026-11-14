<script lang="ts">
  // One Turn. Rendered on the server by Astro pages (no JavaScript) and inside the live island, so both
  // show the same markup and labels. Text is plain: Svelte escapes it; never {@html}.
  import { t } from '../i18n/t';
  import { paragraphs } from '../lib/debate';

  interface Props {
    heading: string;
    text: string;
    truncated: boolean;
    side?: 'for' | 'against';
  }

  let { heading, text, truncated, side }: Props = $props();
</script>

<article class="turn card" class:turn-for={side === 'for'} class:turn-against={side === 'against'}>
  <header class="turn-head">
    <h3>{heading}</h3>
    <span class="badge">{t('label.ai')}</span>
  </header>
  {#each paragraphs(text) as paragraph, i (i)}
    <p>{paragraph}</p>
  {/each}
  {#if truncated}
    <p class="muted"><em>{t('turn.truncated')}</em></p>
  {/if}
</article>

<style>
  .turn > * + * {
    margin-top: 0.6rem;
  }
  .turn p {
    white-space: pre-line;
  }
  .turn-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.6rem;
  }
  .turn-for {
    border-left: 4px solid var(--for);
  }
  .turn-against {
    border-left: 4px solid var(--against);
  }
</style>
