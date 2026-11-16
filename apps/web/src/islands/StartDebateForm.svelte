<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { t, tn } from '../i18n/t';
  import { MAX_CUSTOM_MODEL_LENGTH, MAX_CUSTOM_NAME_LENGTH, MAX_MOTION_LENGTH, providerName, selfJudgingWarning } from '../lib/debate';
  import ModelPicker from './ModelPicker.svelte';

  interface Model {
    id: string;
    label: string;
    roles: string[];
    /** Batch-capable: may take part in a Slow Debate. */
    batch?: boolean;
    inputPerMTokUsd?: number;
    outputPerMTokUsd?: number;
  }

  interface Quote {
    quotaPoints: number;
    quotaRemaining: number;
    /** What the AI Voters add to the worst-case Budget, in micro-USD. */
    aiVotersMicroUsd: number;
  }

  interface Props {
    models: Model[];
    quotaRemaining: number;
    fetcher?: typeof fetch;
    navigate?: (url: string) => void;
  }

  let { models, quotaRemaining, fetcher = fetch, navigate = url => location.assign(url) }: Props = $props();

  // svelte-ignore state_referenced_locally
  const canAffordAny = quotaRemaining >= 1;
  const API = 'api';

  const debaters = $derived(models.filter(m => m.roles.includes('debater')));
  const isBatchModel = (id: string) => models.some(m => m.id === id && m.batch);

  let motion = $state('');
  // svelte-ignore state_referenced_locally
  let forModel = $state(models.filter(m => m.roles.includes('debater'))[0]?.id ?? '');
  // svelte-ignore state_referenced_locally
  let againstModel = $state(models.filter(m => m.roles.includes('debater'))[1]?.id ?? '');
  let judge = $state('');
  /** A Custom Debater's optional nickname and self-reported model, per bench. */
  let identity = $state({ for: { name: '', model: '' }, against: { name: '', model: '' } });
  let aiVoters = $state(false);
  /** How many AI Voters, when they are on. */
  let aiVoterCount = $state(10);
  let batch = $state(false);
  let pending = $state(false);
  let motionError = $state('');
  let error = $state('');
  let slowStatus = $state('');
  // Server HTML keeps submit disabled until the island runs: an earlier submit would reload the page and
  // lose the Motion.
  let hydrated = $state(false);
  onMount(() => (hydrated = true));

  let motionField: HTMLTextAreaElement | undefined = $state();
  let againstField: HTMLInputElement | undefined = $state();
  let judgeField: HTMLInputElement | undefined = $state();

  // The visible count is read with the field; out loud, only when the room left crosses a step, so a screen
  // reader hears it once per step rather than on every keystroke.
  const motionLeft = $derived(MAX_MOTION_LENGTH - motion.length);
  const motionRoom = $derived(
    motionLeft <= 0
      ? t('new.motionFull', { max: MAX_MOTION_LENGTH })
      : motionLeft < 10
        ? t('new.motionRoom', { left: 10 })
        : motionLeft < 20
          ? t('new.motionRoom', { left: 20 })
          : '',
  );

  const labelOf = (id: string) => (id === API ? t('debater.api') : (models.find(m => m.id === id)?.label ?? id));

  // A Slow Debate is offered only when both Debaters are batch-capable models. A change that makes it unavailable
  // unticks it, and says why.
  const slowAvailable = $derived(forModel !== API && againstModel !== API && isBatchModel(forModel) && isBatchModel(againstModel));
  $effect(() => {
    if (batch && !slowAvailable) {
      const offending = [forModel, againstModel].find(id => id === API || !isBatchModel(id)) ?? forModel;
      batch = false;
      slowStatus = t('new.slowUnavailable', { model: labelOf(offending) });
    }
  });

  const judges = $derived(models.filter(m => m.roles.includes('judge') && (!batch || m.batch)));
  // A chosen Judge the Slow Debate cannot use stays selected and is flagged, rather than silently swapped.
  const judgeUnavailable = $derived(judge !== '' && !judges.some(m => m.id === judge));
  const judgeError = $derived(judgeUnavailable ? t('new.notBatch', { model: labelOf(judge) }) : '');
  const againstError = $derived(
    againstModel !== '' && againstModel !== API && againstModel === forModel ? t('new.sameModel', { model: labelOf(forModel) }) : '',
  );
  const status = $derived([slowStatus, judgeError].filter(Boolean).join(' '));

  const selfJudging = $derived(selfJudgingWarning({ for: forModel, against: againstModel }, judge || null));
  const judgePreview = $derived(
    judge ? t('new.judgeChosen', { judge: labelOf(judge) }) : t('new.judgeAutoPreview', { for: labelOf(forModel), against: labelOf(againstModel) }),
  );

  const summary = $derived(
    [
      batch && t('new.batch'),
      t('new.summaryFaceOff', { for: labelOf(forModel), against: labelOf(againstModel) }),
      t('new.summaryJudge', { judge: judge ? labelOf(judge) : t('new.summaryPlatform') }),
      aiVoters && t('new.summaryAiVoters', { count: aiVoterCount }),
    ]
      .filter(Boolean)
      .join(' · '),
  );

  /** A bench as the API takes it: a model id, "api", or a Custom Debater with its nickname and model. */
  const seatOf = (side: 'for' | 'against', model: string) => {
    if (model !== API) return model;
    const name = identity[side].name.trim();
    const self = identity[side].model.trim();
    return name || self ? { kind: 'custom', ...(name ? { name } : {}), ...(self ? { model: self } : {}) } : API;
  };

  const body = (forMotion: string) => ({
    motion: forMotion,
    debaters: { for: seatOf('for', forModel), against: seatOf('against', againstModel) },
    aiVoters: aiVoters ? aiVoterCount : false,
    ...(judge ? { panel: [judge] } : {}),
    ...(batch ? { batch: true } : {}),
  });

  // What this line-up costs, quoted by the API (the authority) shortly after the last change; older answers are dropped.
  let quote = $state<Quote | null>(null);
  let quoteError = $state('');
  let quoteSeq = 0;
  $effect(() => {
    const request = JSON.stringify(body(motion.trim() || t('new.motionPlaceholder')));
    if (!canAffordAny) return;
    const seq = ++quoteSeq;
    const timer = setTimeout(async () => {
      try {
        const response = await fetcher('/api/debates/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: request });
        const data = (await response.json().catch(() => ({}))) as Partial<Quote> & { error?: string };
        if (seq !== quoteSeq) return;
        if (response.ok && typeof data.quotaPoints === 'number' && typeof data.quotaRemaining === 'number') {
          quote = { quotaPoints: data.quotaPoints, quotaRemaining: data.quotaRemaining, aiVotersMicroUsd: data.aiVotersMicroUsd ?? 0 };
          quoteError = '';
        } else {
          quote = null;
          quoteError = response.status === 400 && data.error ? data.error : '';
        }
      } catch {
        if (seq === quoteSeq) quote = null;
      }
    }, 300);
    return () => clearTimeout(timer);
  });
  const cost = $derived(quote ? tn('new.cost', quote.quotaPoints, { left: quote.quotaRemaining }) : '');
  const overQuota = $derived(quote !== null && quote.quotaPoints > quote.quotaRemaining);
  const aiVotersCost = $derived(
    t('new.aiVotersCount', { count: aiVoterCount, usd: quote ? (quote.aiVotersMicroUsd / 1e6).toFixed(2) : '…' }),
  );

  const describedBy = (...ids: (string | false)[]) => ids.filter(Boolean).join(' ');

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    motionError = motion.trim().length === 0 ? t('new.motionMissing') : '';
    const invalid = motionError ? motionField : againstError ? againstField : judgeError ? judgeField : undefined;
    if (invalid) {
      // Let the message render first, so the field is announced with it.
      await tick();
      invalid.focus();
      return;
    }
    pending = true;
    try {
      const response = await fetcher('/api/debates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body(motion.trim())),
      });
      const result = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (response.status === 201 && result.id) {
        navigate(`/debates/${result.id}`);
        return;
      }
      error = result.error ?? t('new.failed');
    } catch {
      error = t('new.failed');
    }
    pending = false;
  }
</script>

<form onsubmit={submit} class="start" novalidate>
  {#if !canAffordAny}
    <p class="note">{t('new.noQuota')}</p>
  {:else}
    <p class="quota-left">{t('new.quotaLeft', { left: quotaRemaining })}</p>
  {/if}

  <!-- Without Quota nothing here can be used: say so above, and do not let the form be filled in for nothing. -->
  <fieldset class="body" disabled={!canAffordAny}>
    <div class="group field">
      <label for="motion" class="motion-label">{t('new.motion')}</label>
      <p id="motion-hint" class="muted">{t('new.motionHint')}</p>
      <textarea
        id="motion"
        name="motion"
        rows="3"
        maxlength={MAX_MOTION_LENGTH}
        required
        placeholder={t('new.motionPlaceholder')}
        aria-invalid={motionError ? 'true' : undefined}
        aria-describedby={describedBy(motionError !== '' && 'motion-error', 'motion-hint', 'motion-count')}
        bind:this={motionField}
        bind:value={motion}
        oninput={() => (motionError = '')}
      ></textarea>
      {#if motionError}<p id="motion-error" class="error">{motionError}</p>{/if}
      <p id="motion-count" class="muted count">{t('new.motionCount', { count: motion.length, max: MAX_MOTION_LENGTH })}</p>
      <p class="visually-hidden" role="status" id="motion-room">{motionRoom}</p>
    </div>

    <fieldset class="group">
      <legend>{t('new.benches')}</legend>
      <div class="benches">
        <div class="field bench bench-for">
          <ModelPicker
            id="debater-for"
            label={t('new.debaterFor')}
            models={debaters}
            value={forModel}
            allowApi
            {labelOf}
            describedBy="debater-for-provider"
            onchange={value => (forModel = value)}
          />
          <p id="debater-for-provider" class="provider">
            {forModel === API ? t('new.apiHint') : t('new.provider', { provider: providerName(forModel) })}
          </p>
          {#if forModel === API}{@render customFields('for')}{/if}
        </div>

        <p class="versus" aria-hidden="true">{t('new.versus')}</p>

        <div class="field bench bench-against">
          <ModelPicker
            id="debater-against"
            label={t('new.debaterAgainst')}
            models={debaters}
            value={againstModel}
            allowApi
            {labelOf}
            invalid={againstError !== ''}
            describedBy={describedBy(againstError !== '' && 'debater-against-error', 'debater-against-provider')}
            onchange={value => (againstModel = value)}
            bind:input={againstField}
          />
          <p id="debater-against-provider" class="provider">
            {againstModel === API ? t('new.apiHint') : t('new.provider', { provider: providerName(againstModel) })}
          </p>
          {#if againstModel === API}{@render customFields('against')}{/if}
          {#if againstError}<p id="debater-against-error" class="error">{againstError}</p>{/if}
        </div>
      </div>
    </fieldset>

    <fieldset class="group">
      <legend>{t('new.verdictGroup')}</legend>
      <div class="field">
        <ModelPicker
          id="judge"
          label={t('new.judge')}
          models={judges}
          value={judge}
          autoLabel={t('new.judgeAuto')}
          {labelOf}
          invalid={judgeError !== ''}
          describedBy={describedBy(judgeError !== '' && 'judge-error', 'judge-preview')}
          onchange={value => (judge = value)}
          bind:input={judgeField}
        />
        <p id="judge-preview" class="muted">{judgePreview}</p>
        {#if judgeError}<p id="judge-error" class="error">{judgeError}</p>{/if}
        {#if selfJudging}<p role="note" class="note">{t('new.selfJudging')}</p>{/if}
      </div>

      <div class="field">
        <label class="choice"><input type="checkbox" bind:checked={aiVoters} aria-describedby="ai-voters-hint" /> {t('new.aiVoters')}</label>
        <p id="ai-voters-hint" class="muted">{t('new.aiVotersHint')}</p>
        {#if aiVoters}
          <div class="voter-count">
            <input type="range" min="1" max="100" step="1" aria-label={t('new.aiVotersSlider')} bind:value={aiVoterCount} />
            <output>{aiVotersCost}</output>
          </div>
        {/if}
      </div>
    </fieldset>

    <!-- Optional, and last: the same Debate, cheaper and slower. Offered only when both Debaters can run as batch. -->
    <div class="group field slow">
      {#if slowAvailable}
        <label class="choice"><input type="checkbox" bind:checked={batch} onchange={() => (slowStatus = '')} aria-describedby="batch-hint" /> {t('new.batchChoice')}</label>
        <p id="batch-hint" class="muted">{t('new.batchHint')}</p>
      {/if}
      <p class="visually-hidden" role="status" id="batch-status">{status}</p>
    </div>

    <div class="group submit">
      <p id="start-summary" class="summary">{summary}</p>
      <p id="start-cost" class="muted">{cost}</p>
      <div class="submit-row">
        <button
          type="submit"
          disabled={pending || !canAffordAny || !hydrated || quoteError !== '' || overQuota}
          aria-busy={pending}
          aria-describedby={describedBy('start-summary', cost !== '' && 'start-cost', quoteError !== '' && 'quote-error', !canAffordAny && 'submit-reason')}
          >{t('new.submit')}</button
        >
        {#if !canAffordAny}<p id="submit-reason" class="muted">{t('new.noQuotaShort')}</p>{/if}
      </div>
      {#if quoteError}<p id="quote-error" class="error">{quoteError}</p>{/if}
      <noscript><p class="muted">{t('new.needsJs')}</p></noscript>
      {#if error}<p role="alert" class="error">{error}</p>{/if}
    </div>
  </fieldset>
</form>

{#snippet customFields(side: 'for' | 'against')}
  <div class="custom">
    <label for={`custom-${side}-name`}>{t('new.customName')}</label>
    <input id={`custom-${side}-name`} type="text" maxlength={MAX_CUSTOM_NAME_LENGTH} autocomplete="off" bind:value={identity[side].name} />
    <label for={`custom-${side}-model`}>{t('new.customModel')}</label>
    <input id={`custom-${side}-model`} type="text" maxlength={MAX_CUSTOM_MODEL_LENGTH} autocomplete="off" bind:value={identity[side].model} />
  </div>
{/snippet}

<style>
  /* The AI Voter count: the slider fills the line, what it costs beside it (below it on a narrow screen). */
  .voter-count {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
  }
  .voter-count input {
    flex: 1 1 12rem;
    min-height: 2.75rem;
    accent-color: var(--for);
  }
  .voter-count output {
    font-variant-numeric: tabular-nums;
  }
  /* Fieldsets here are groups, not boxes: a rule above each, the legend as its heading. */
  fieldset {
    border: 0;
    border-radius: 0;
    padding: 0;
  }
  .body > * + * {
    margin-top: calc(var(--space) * 1.25);
  }
  .start > * + * {
    margin-top: var(--space);
  }
  .group + .group {
    border-top: 1px solid var(--line);
    padding-top: calc(var(--space) * 1.25);
  }
  /* With no Slow Debate to offer, its group is only a status line: no rule, no gap. */
  .group.slow:not(:has(input)) {
    border-top: 0;
    padding-top: 0;
    margin-top: 0;
  }
  legend,
  .motion-label {
    padding: 0;
    font-family: var(--font-serif);
    font-size: 1.3rem;
    font-weight: 600;
    line-height: 1.25;
  }
  legend {
    float: left;
    width: 100%;
    margin-bottom: 0.75rem;
  }
  legend + * {
    clear: both;
  }
  .quota-left {
    color: var(--muted);
  }

  #motion {
    font-family: var(--font-serif);
    font-size: clamp(1.375rem, 1.2rem + 0.8vw, 1.75rem);
    line-height: 1.3;
    padding: 0.75rem 0.9rem;
    resize: vertical;
  }
  #motion::placeholder {
    color: var(--muted);
    font-style: italic;
    opacity: 1;
  }
  .count {
    font-size: 0.9rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  /* The two Debaters face each other: For on the cobalt-edged bench, Against on the oxblood-edged one,
     square-cornered like the benches on a Debate page. Stacked on the phone, side by side when wide. */
  .benches {
    display: grid;
    gap: 0.5rem;
  }
  .bench {
    padding: 0.9rem 1rem 1rem;
    border: 1px solid var(--line);
    border-top: 6px solid;
    border-radius: 0;
    background: var(--surface);
  }
  .bench-for {
    border-top-color: var(--for);
    background: linear-gradient(var(--for-tint), var(--for-tint)), var(--surface);
  }
  .bench-against {
    border-top-color: var(--against);
    background: linear-gradient(var(--against-tint), var(--against-tint)), var(--surface);
  }
  .bench-for :global(label) {
    color: var(--for);
  }
  .bench-against :global(label) {
    color: var(--against);
  }
  .bench :global(input[role='combobox']) {
    font-family: var(--font-serif);
    font-size: 1.25rem;
    font-weight: 600;
  }
  .custom {
    display: grid;
    gap: 0.25rem;
    margin-top: 0.5rem;
  }
  .custom label {
    font-size: 0.85rem;
  }
  .provider {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .versus {
    justify-self: center;
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 1.2rem;
    color: var(--muted);
  }

  .summary {
    font-family: var(--font-serif);
    font-size: 1.15rem;
    font-weight: 600;
  }
  .submit > * + * {
    margin-top: 0.75rem;
  }
  .submit-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
  }
  .error {
    margin-top: 0.35rem;
  }

  @media (min-width: 40rem) {
    .benches {
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      align-items: start;
      gap: 1rem;
    }
    .versus {
      align-self: center;
    }
  }
</style>
