<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../i18n/t';
  import { BATCH_DEBATE_QUOTA_POINTS, DEBATE_QUOTA_POINTS, MAX_MOTION_LENGTH, selfJudgingWarning } from '../lib/debate';

  interface Model {
    id: string;
    label: string;
    roles: string[];
    /** Served by the Batch API; a Batch Debate may use only these. */
    batch?: boolean;
  }

  interface Props {
    models: Model[];
    quotaRemaining: number;
    fetcher?: typeof fetch;
    navigate?: (url: string) => void;
  }

  let { models, quotaRemaining, fetcher = fetch, navigate = url => location.assign(url) }: Props = $props();

  let batch = $state(false);
  const usable = $derived(batch ? models.filter(m => m.batch) : models);
  const debaters = $derived(usable.filter(m => m.roles.includes('debater')));
  const judges = $derived(usable.filter(m => m.roles.includes('judge')));

  let motion = $state('');
  // svelte-ignore state_referenced_locally
  let forModel = $state(models.find(m => m.roles.includes('debater'))?.id ?? '');
  // svelte-ignore state_referenced_locally
  let againstModel = $state(models.filter(m => m.roles.includes('debater'))[1]?.id ?? '');
  let judge = $state('');
  let aiVoters = $state(false);
  let pending = $state(false);
  let error = $state('');
  // Server HTML keeps submit disabled until the island runs: an earlier submit would reload the page and
  // lose the Motion.
  let hydrated = $state(false);
  onMount(() => (hydrated = true));

  const cost = $derived(batch ? BATCH_DEBATE_QUOTA_POINTS : DEBATE_QUOTA_POINTS);
  const noQuota = $derived(quotaRemaining < cost);

  /** A Batch Debate can use only batch-capable models: replace any chosen model that is not. */
  function batchChanged() {
    const ids = (role: string) => usable.filter(m => m.roles.includes(role)).map(m => m.id);
    const debaterIds = ids('debater');
    if (!debaterIds.includes(forModel)) forModel = debaterIds[0] ?? '';
    if (!debaterIds.includes(againstModel)) againstModel = debaterIds.find(id => id !== forModel) ?? debaterIds[0] ?? '';
    if (judge && !ids('judge').includes(judge)) judge = '';
  }
  const selfJudging = $derived(selfJudgingWarning({ for: forModel, against: againstModel }, judge || null));

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    if (motion.trim().length === 0) {
      error = t('new.motionMissing');
      return;
    }
    pending = true;
    try {
      const response = await fetcher('/api/debates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          motion: motion.trim(),
          debaters: { for: forModel, against: againstModel },
          aiVoters,
          ...(judge ? { panel: [judge] } : {}),
          ...(batch ? { batch: true } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (response.status === 201 && body.id) {
        navigate(`/debates/${body.id}`);
        return;
      }
      error = body.error ?? t('new.failed');
    } catch {
      error = t('new.failed');
    }
    pending = false;
  }
</script>

<form onsubmit={submit} class="stack" novalidate>
  <div class="field">
    <label for="motion">{t('new.motion')}</label>
    <p id="motion-hint" class="muted">{t('new.motionHint')}</p>
    <textarea id="motion" name="motion" rows="3" maxlength={MAX_MOTION_LENGTH} required aria-describedby="motion-hint motion-count" bind:value={motion}
    ></textarea>
    <p id="motion-count" class="muted" aria-live="polite">{t('new.motionCount', { count: motion.length, max: MAX_MOTION_LENGTH })}</p>
  </div>

  <div class="field">
    <label class="choice"><input type="checkbox" bind:checked={batch} onchange={batchChanged} aria-describedby="batch-hint" /> {t('new.batch')}</label>
    <p id="batch-hint" class="muted">{t('new.batchHint')}</p>
  </div>

  <div class="field">
    <label for="debater-for">{t('new.debaterFor')}</label>
    <select id="debater-for" bind:value={forModel}>
      {#each debaters as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
    </select>
  </div>

  <div class="field">
    <label for="debater-against">{t('new.debaterAgainst')}</label>
    <select id="debater-against" bind:value={againstModel}>
      {#each debaters as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
    </select>
  </div>

  <div class="field">
    <label for="judge">{t('new.judge')}</label>
    <p id="judge-hint" class="muted">{t('new.judgeHint')}</p>
    <select id="judge" bind:value={judge} aria-describedby="judge-hint">
      <option value="">{t('new.judgeAuto')}</option>
      {#each judges as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
    </select>
    {#if selfJudging}<p role="note" class="note">{t('new.selfJudging')}</p>{/if}
  </div>

  <div class="field">
    <label class="choice"><input type="checkbox" bind:checked={aiVoters} aria-describedby="ai-voters-hint" /> {t('new.aiVoters')}</label>
    <p id="ai-voters-hint" class="muted">{t('new.aiVotersHint')}</p>
  </div>

  {#if noQuota}
    <p class="note">{t('new.noQuota')}</p>
  {:else}
    <p class="muted">{t('new.cost', { cost, left: quotaRemaining })}</p>
  {/if}

  <button type="submit" disabled={pending || noQuota || !hydrated} aria-busy={pending}>{t('new.submit')}</button>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
</form>
