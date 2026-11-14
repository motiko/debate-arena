<script lang="ts">
  // A Moderator's decision on one Debate: relist it, or Block it with a statement of reasons (DSA Art. 17).
  import { onMount } from 'svelte';
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
  <div class="stack">
    <button type="button" class="secondary" disabled={pending || !hydrated} onclick={() => send({ action: 'relist' }, t('moderation.relisted'))}
      >{t('moderation.relist')}</button
    >
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
        <button type="submit" disabled={pending || !hydrated} aria-busy={pending}>{t('moderation.block')}</button>
      </fieldset>
    </form>
  </div>
{/if}
{#if error}<p role="alert" class="error">{error}</p>{/if}
