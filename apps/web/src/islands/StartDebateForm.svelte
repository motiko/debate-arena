<script module lang="ts">
  const PROVIDERS: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    google: 'Google',
    deepseek: 'DeepSeek',
    'meta-llama': 'Meta',
    qwen: 'Qwen',
    mistralai: 'Mistral AI',
    'x-ai': 'xAI',
  };

  /** The provider, from the model id's prefix ("anthropic/claude-…" → "Anthropic"). */
  export function providerName(id: string): string {
    const prefix = id.split('/')[0] ?? '';
    return PROVIDERS[prefix] ?? prefix.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
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

  // With too little Quota for a full Debate but enough for a Batch Debate, the Batch Debate is the only choice.
  // svelte-ignore state_referenced_locally
  const canAffordFull = quotaRemaining >= DEBATE_QUOTA_POINTS;
  // svelte-ignore state_referenced_locally
  const canAffordAny = quotaRemaining >= BATCH_DEBATE_QUOTA_POINTS;
  let batch = $state(!canAffordFull && canAffordAny);

  const usable = $derived(batch ? models.filter(m => m.batch) : models);
  const debaters = $derived(usable.filter(m => m.roles.includes('debater')));
  const judges = $derived(usable.filter(m => m.roles.includes('judge')));

  let motion = $state('');
  // svelte-ignore state_referenced_locally
  let forModel = $state(models.filter(m => m.roles.includes('debater') && (!batch || m.batch))[0]?.id ?? '');
  // svelte-ignore state_referenced_locally
  let againstModel = $state(models.filter(m => m.roles.includes('debater') && (!batch || m.batch))[1]?.id ?? '');
  let judge = $state('');
  let aiVoters = $state(false);
  let pending = $state(false);
  let motionError = $state('');
  let error = $state('');
  // Server HTML keeps submit disabled until the island runs: an earlier submit would reload the page and
  // lose the Motion.
  let hydrated = $state(false);
  onMount(() => (hydrated = true));

  let motionField: HTMLTextAreaElement | undefined = $state();
  let forField: HTMLSelectElement | undefined = $state();
  let againstField: HTMLSelectElement | undefined = $state();
  let judgeField: HTMLSelectElement | undefined = $state();

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

  const cost = $derived(batch ? BATCH_DEBATE_QUOTA_POINTS : DEBATE_QUOTA_POINTS);
  const labelOf = (id: string) => models.find(m => m.id === id)?.label ?? id;
  const points = (count: number) => (count === 1 ? t('new.pointsOne') : t('new.points', { count }));

  // A choice the current kind of Debate cannot use stays selected (shown as an extra option) and is flagged,
  // rather than silently swapped: switching back to a full Debate makes it valid again.
  const forUnavailable = $derived(forModel !== '' && !debaters.some(m => m.id === forModel));
  const againstUnavailable = $derived(againstModel !== '' && !debaters.some(m => m.id === againstModel));
  const judgeUnavailable = $derived(judge !== '' && !judges.some(m => m.id === judge));
  const unavailable = (id: string) => t('new.notBatch', { model: labelOf(id) });

  const forError = $derived(forUnavailable ? unavailable(forModel) : '');
  const againstError = $derived(
    againstUnavailable ? unavailable(againstModel) : againstModel !== '' && againstModel === forModel ? t('new.sameModel', { model: labelOf(forModel) }) : '',
  );
  const judgeError = $derived(judgeUnavailable ? unavailable(judge) : '');
  // One polite announcement for choices a switch of kind made invalid; the messages also sit at their fields.
  const unavailableStatus = $derived(
    [forUnavailable && forError, againstUnavailable && againstError, judgeUnavailable && judgeError].filter(Boolean).join(' '),
  );

  const selfJudging = $derived(selfJudgingWarning({ for: forModel, against: againstModel }, judge || null));
  const judgePreview = $derived(
    judge ? t('new.judgeChosen', { judge: labelOf(judge) }) : t('new.judgeAutoPreview', { for: labelOf(forModel), against: labelOf(againstModel) }),
  );

  const summary = $derived(
    [
      batch && t('new.batch'),
      t('new.summaryFaceOff', { for: labelOf(forModel), against: labelOf(againstModel) }),
      t('new.summaryJudge', { judge: judge ? labelOf(judge) : t('new.summaryPlatform') }),
      aiVoters && t('new.summaryAiVoters'),
      points(cost),
    ]
      .filter(Boolean)
      .join(' · '),
  );

  const describedBy = (...ids: (string | false)[]) => ids.filter(Boolean).join(' ');

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    motionError = motion.trim().length === 0 ? t('new.motionMissing') : '';
    const invalid = motionError ? motionField : forError ? forField : againstError ? againstField : judgeError ? judgeField : undefined;
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

<form onsubmit={submit} class="start" novalidate>
  {#if !canAffordAny}
    <p class="note">{t('new.noQuota')}</p>
  {:else if !canAffordFull}
    <p class="note">{t('new.quotaBatchOnly')}</p>
  {:else}
    <p class="quota-left">{t('new.quotaLeft', { left: quotaRemaining })}</p>
  {/if}

  <!-- Without Quota nothing here can be used: say so above, and do not let the form be filled in for nothing. -->
  <fieldset class="body" disabled={!canAffordAny}>
    <fieldset class="group">
      <legend>{t('new.kind')}</legend>
      <div class="kinds">
        <label class="kind">
          <input type="radio" name="kind" value="full" checked={!batch} onchange={() => (batch = false)} disabled={!canAffordFull} aria-describedby="kind-full-hint" />
          <span class="kind-text">
            <span class="kind-name">{t('new.kindFull')}</span>
            <span id="kind-full-hint" class="kind-hint">{t(canAffordFull ? 'new.kindFullHint' : 'new.kindUnaffordable', { points: points(DEBATE_QUOTA_POINTS) })}</span>
          </span>
        </label>
        <label class="kind">
          <input type="radio" name="kind" value="batch" checked={batch} onchange={() => (batch = true)} aria-describedby="kind-batch-hint" />
          <span class="kind-text">
            <span class="kind-name">{t('new.batch')}</span>
            <span id="kind-batch-hint" class="kind-hint">{t('new.batchHint', { points: points(BATCH_DEBATE_QUOTA_POINTS) })}</span>
          </span>
        </label>
      </div>
      <p class="visually-hidden" role="status">{unavailableStatus}</p>
    </fieldset>

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
          <label for="debater-for">{t('new.debaterFor')}</label>
          <select
            id="debater-for"
            bind:this={forField}
            bind:value={forModel}
            aria-invalid={forError ? 'true' : undefined}
            aria-describedby={describedBy(forError !== '' && 'debater-for-error', 'debater-for-provider')}
          >
            {#if forUnavailable}<option value={forModel} disabled>{labelOf(forModel)}</option>{/if}
            {#each debaters as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
          </select>
          <p id="debater-for-provider" class="provider">{t('new.provider', { provider: providerName(forModel) })}</p>
          {#if forError}<p id="debater-for-error" class="error">{forError}</p>{/if}
        </div>

        <p class="versus" aria-hidden="true">{t('new.versus')}</p>

        <div class="field bench bench-against">
          <label for="debater-against">{t('new.debaterAgainst')}</label>
          <select
            id="debater-against"
            bind:this={againstField}
            bind:value={againstModel}
            aria-invalid={againstError ? 'true' : undefined}
            aria-describedby={describedBy(againstError !== '' && 'debater-against-error', 'debater-against-provider')}
          >
            {#if againstUnavailable}<option value={againstModel} disabled>{labelOf(againstModel)}</option>{/if}
            {#each debaters as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
          </select>
          <p id="debater-against-provider" class="provider">{t('new.provider', { provider: providerName(againstModel) })}</p>
          {#if againstError}<p id="debater-against-error" class="error">{againstError}</p>{/if}
        </div>
      </div>
    </fieldset>

    <fieldset class="group">
      <legend>{t('new.verdictGroup')}</legend>
      <div class="field">
        <label for="judge">{t('new.judge')}</label>
        <select
          id="judge"
          bind:this={judgeField}
          bind:value={judge}
          aria-invalid={judgeError ? 'true' : undefined}
          aria-describedby={describedBy(judgeError !== '' && 'judge-error', 'judge-preview')}
        >
          <option value="">{t('new.judgeAuto')}</option>
          {#if judgeUnavailable}<option value={judge} disabled>{labelOf(judge)}</option>{/if}
          {#each judges as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
        </select>
        <p id="judge-preview" class="muted">{judgePreview}</p>
        {#if judgeError}<p id="judge-error" class="error">{judgeError}</p>{/if}
        {#if selfJudging}<p role="note" class="note">{t('new.selfJudging')}</p>{/if}
      </div>

      <div class="field">
        <label class="choice"><input type="checkbox" bind:checked={aiVoters} aria-describedby="ai-voters-hint" /> {t('new.aiVoters')}</label>
        <p id="ai-voters-hint" class="muted">{t('new.aiVotersHint')}</p>
      </div>
    </fieldset>

    <div class="group submit">
      <p id="start-summary" class="summary">{summary}</p>
      <div class="submit-row">
        <button type="submit" disabled={pending || !canAffordAny || !hydrated} aria-busy={pending} aria-describedby={describedBy('start-summary', !canAffordAny && 'submit-reason')}
          >{t('new.submit')}</button
        >
        {#if !canAffordAny}<p id="submit-reason" class="muted">{t('new.noQuotaShort')}</p>{/if}
      </div>
      <noscript><p class="muted">{t('new.needsJs')}</p></noscript>
      {#if error}<p role="alert" class="error">{error}</p>{/if}
    </div>
  </fieldset>
</form>

<style>
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

  /* The kind of Debate: two options side by side, each naming what it costs and what it gives up. */
  .kinds {
    display: grid;
    gap: 0.75rem;
  }
  .kind {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    font-weight: 400;
    cursor: pointer;
  }
  .kind:has(input:checked) {
    border-color: var(--green);
    box-shadow: inset 0 0 0 1px var(--green);
  }
  .kind:has(input:disabled) {
    cursor: not-allowed;
    background: transparent;
  }
  .kind input {
    flex: none;
    margin: 0.15rem 0 0;
  }
  .kind-text {
    display: grid;
    gap: 0.2rem;
  }
  .kind-name {
    font-weight: 600;
  }
  .kind-hint {
    color: var(--muted);
    font-size: 0.95rem;
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
  .bench-for label {
    color: var(--for);
  }
  .bench-against label {
    color: var(--against);
  }
  .bench select {
    font-family: var(--font-serif);
    font-size: 1.25rem;
    font-weight: 600;
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
    .kinds {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
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
