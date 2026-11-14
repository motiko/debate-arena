<script lang="ts">
  // A Moderator's decision on one Debate: relist it, or Block it with a statement of reasons (DSA Art. 17).
  import { onMount, tick } from 'svelte';
  import { t } from '../i18n/t';

  interface Props {
    debateId: string;
    fetcher?: typeof fetch;
  }

  let { debateId, fetcher = fetch }: Props = $props();

  let ground = $state<'illegal' | 'terms' | ''>('');
  let groundRef = $state('');
  let explanation = $state('');
  let pending = $state(false);
  let error = $state('');
  let outcome = $state('');
  let hydrated = $state(false);
  onMount(() => (hydrated = true));
  // Relist takes effect at once and has no undo, so it is asked once more; focus follows each step.
  let confirmingRelist = $state(false);
  let relistButton: HTMLButtonElement | undefined = $state();
  let relistYes: HTMLButtonElement | undefined = $state();

  async function askRelist() {
    confirmingRelist = true;
    await tick();
    relistYes?.focus();
  }

  async function cancelRelist() {
    confirmingRelist = false;
    await tick();
    relistButton?.focus();
  }

  const id = (name: string) => `${name}-${debateId}`;

  async function send(body: Record<string, string>, done: string) {
    pending = true;
    error = '';
    try {
      const response = await fetcher(`/api/moderation/debates/${encodeURIComponent(debateId)}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.status === 201) {
        outcome = done;
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      error = data.error ?? t('moderation.failed');
    } catch {
      error = t('moderation.failed');
    } finally {
      pending = false;
    }
  }

  function block(event: SubmitEvent) {
    event.preventDefault();
    if (!ground || groundRef.trim().length === 0 || explanation.trim().length < 10) {
      error = t('moderation.missing');
      return;
    }
    void send({ action: 'block', ground, groundRef: groundRef.trim(), explanation: explanation.trim() }, t('moderation.blocked'));
  }
</script>

{#if outcome}
  <p role="status"><strong>{outcome}</strong></p>
{:else}
  <!-- The two decisions side by side. Block's statement of reasons opens below them, in a <details> so it opens
       without JavaScript. -->
  <div class="decisions" role="group" aria-label={t('moderation.decisions')}>
    {#if confirmingRelist}
      <div class="relist confirm">
        <p>{t('moderation.relistConfirm')}</p>
        <button type="button" bind:this={relistYes} disabled={pending} aria-busy={pending} onclick={() => send({ action: 'relist' }, t('moderation.relisted'))}
          >{t('moderation.relistYes')}</button
        >
        <button type="button" class="secondary" disabled={pending} onclick={cancelRelist}>{t('moderation.cancel')}</button>
      </div>
    {:else}
      <button type="button" class="secondary relist" bind:this={relistButton} disabled={pending || !hydrated} onclick={askRelist}>{t('moderation.relist')}</button>
    {/if}
    <details class="block">
      <summary>{t('moderation.blockOpen')}</summary>
      <form onsubmit={block} class="stack" novalidate>
        <fieldset class="stack">
          <legend>{t('moderation.blockLegend')}</legend>
          <label class="choice"><input type="radio" name={id('ground')} value="illegal" bind:group={ground} /> {t('moderation.groundIllegal')}</label>
          <label class="choice"><input type="radio" name={id('ground')} value="terms" bind:group={ground} /> {t('moderation.groundTerms')}</label>
          <div class="field">
            <label for={id('ref')}>{t('moderation.reference')}</label>
            <p id={id('ref-hint')} class="muted">{t('moderation.referenceHint')}</p>
            <input id={id('ref')} type="text" maxlength="200" aria-describedby={id('ref-hint')} bind:value={groundRef} />
          </div>
          <div class="field">
            <label for={id('explanation')}>{t('moderation.explanation')}</label>
            <p id={id('explanation-hint')} class="muted">{t('moderation.explanationHint')}</p>
            <textarea id={id('explanation')} rows="3" maxlength="2000" aria-describedby={id('explanation-hint')} bind:value={explanation}></textarea>
          </div>
          <button type="submit" class="danger" disabled={pending || !hydrated} aria-busy={pending}>{t('moderation.block')}</button>
        </fieldset>
      </form>
    </details>
  </div>
{/if}
{#if error}<p role="alert" class="error">{error}</p>{/if}

<style>
  /* Relist floats beside the Block summary; the opened form clears below both. */
  .decisions {
    display: flow-root;
  }
  .relist {
    float: left;
    margin-inline-end: 0.75rem;
  }
  /* The question and its two answers, in the place of the Relist button. */
  .confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    margin-bottom: 0.5rem;
  }
  .confirm p {
    font-weight: 600;
  }
  .block summary {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
    padding: 0.4rem 1.1rem;
    border: 1.5px solid var(--green);
    border-radius: var(--radius);
    color: var(--green);
    font-weight: 600;
    cursor: pointer;
    list-style: none;
  }
  .block summary::-webkit-details-marker {
    display: none;
  }
  /* A drawn chevron: down when closed, up when open. */
  .block summary::after {
    content: '';
    width: 0.45rem;
    height: 0.45rem;
    border-right: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
    transform: translateY(-0.15rem) rotate(45deg);
  }
  .block[open] summary::after {
    transform: translateY(0.1rem) rotate(-135deg);
  }
  .block summary:hover {
    background: var(--surface);
  }
  .block form {
    clear: both;
    padding-top: 0.75rem;
  }
  fieldset {
    background: var(--surface);
  }
  .error {
    margin-top: 0.75rem;
  }
</style>
