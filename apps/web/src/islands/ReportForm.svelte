<script lang="ts">
  // A Report (DSA Art. 16 notice): open to anyone. Members are known by their account; Viewers who are
  // signed out may leave a name and email to hear about the decision.
  import { onMount, tick } from 'svelte';
  import { t, type MessageKey } from '../i18n/t';

  const REASONS = ['hate', 'harassment', 'violence', 'sexual', 'child_safety', 'illegal_other', 'other'] as const;
  const MAX = 1000;

  interface Props {
    debateId: string;
    signedIn: boolean;
    fetcher?: typeof fetch;
  }

  let { debateId, signedIn, fetcher = fetch }: Props = $props();

  // No reason is assumed: a Report sent without looking at the list would otherwise name the wrong one.
  let reason = $state<(typeof REASONS)[number] | ''>('');
  let reasonMissing = $state(false);
  let reasonField: HTMLSelectElement | undefined = $state();
  let explanation = $state('');
  let name = $state('');
  let email = $state('');
  let goodFaith = $state(false);
  let pending = $state(false);
  let error = $state('');
  let sent = $state(false);
  let hydrated = $state(false);
  onMount(() => (hydrated = true));

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    reasonMissing = reason === '';
    if (reasonMissing) {
      error = t('report.reasonMissing');
      await tick();
      reasonField?.focus();
      return;
    }
    if (!goodFaith) {
      error = t('report.goodFaithMissing');
      return;
    }
    pending = true;
    try {
      const response = await fetcher(`/api/debates/${encodeURIComponent(debateId)}/reports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reason,
          explanation: explanation.trim(),
          goodFaith,
          ...(!signedIn && name.trim() ? { name: name.trim() } : {}),
          ...(!signedIn && email.trim() ? { email: email.trim() } : {}),
        }),
      });
      if (response.status === 201) {
        sent = true;
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      error = body.error ?? t('report.failed');
    } catch {
      error = t('report.failed');
    } finally {
      pending = false;
    }
  }
</script>

{#if sent}
  <p role="status">{t('report.thanks')}</p>
{:else}
  <form onsubmit={submit} class="stack" novalidate>
    <p class="muted">{t('report.intro')}</p>
    <div class="field">
      <label for="report-reason">{t('report.reason')}</label>
      <select
        id="report-reason"
        bind:this={reasonField}
        bind:value={reason}
        aria-invalid={reasonMissing ? 'true' : undefined}
        aria-describedby={reasonMissing ? 'report-error' : undefined}
        onchange={() => (reasonMissing = false)}
      >
        <option value="" disabled>{t('report.reasonChoose')}</option>
        {#each REASONS as r (r)}<option value={r}>{t(`report.reason.${r}` as MessageKey)}</option>{/each}
      </select>
    </div>
    <div class="field">
      <label for="report-explanation">{t('report.explanation')}</label>
      <p id="report-explanation-hint" class="muted">{t('report.explanationHint')}</p>
      <textarea id="report-explanation" rows="4" maxlength={MAX} required aria-describedby="report-explanation-hint" bind:value={explanation}
      ></textarea>
    </div>
    {#if !signedIn}
      <div class="field">
        <label for="report-name">{t('report.name')}</label>
        <input id="report-name" type="text" autocomplete="name" maxlength="100" bind:value={name} />
      </div>
      <div class="field">
        <label for="report-email">{t('report.email')}</label>
        <input id="report-email" type="email" autocomplete="email" maxlength="254" bind:value={email} />
      </div>
    {/if}
    <label class="choice"><input type="checkbox" bind:checked={goodFaith} /> {t('report.goodFaith')}</label>
    <button type="submit" class="secondary" disabled={pending || !hydrated} aria-busy={pending}>{t('report.submit')}</button>
    {#if error}<p id="report-error" role="alert" class="error">{error}</p>{/if}
  </form>
{/if}
