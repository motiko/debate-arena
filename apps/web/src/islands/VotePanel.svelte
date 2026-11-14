<script lang="ts">
  // Oxford Audience Votes: one before-vote, then one after-vote once the Debate is complete, within the
  // Format's voting window. The API enforces the rules; this island shows the next allowed step.
  import type { Stance } from '@debate-arena/engine';
  import { onMount } from 'svelte';
  import SignInButton from './SignInButton.svelte';
  import { t } from '../i18n/t';
  import { refreshRegions, type RefreshOptions } from '../lib/refresh';

  type Phase = 'before' | 'after';
  type Vote = { before: Stance | null; after: Stance | null };

  interface Props {
    debateId: string;
    motion: string;
    status: 'running' | 'complete' | 'failed';
    myVote: Vote | null;
    signedIn: boolean;
    turnsHidden: boolean;
    votingClosesAt: string | null;
    /** Show only this vote's form: the dispatch box asks for the before-vote, the foot of the floor for the after-vote. */
    only?: Phase;
    fetcher?: typeof fetch;
    reload?: () => void;
    /** Brings the page's outcome up to date after the after-vote (lib/refresh). */
    refresh?: (options: RefreshOptions) => Promise<boolean>;
  }

  let {
    debateId,
    motion,
    status,
    myVote,
    signedIn,
    turnsHidden,
    votingClosesAt,
    only,
    fetcher = fetch,
    reload = () => location.reload(),
    refresh = refreshRegions,
  }: Props = $props();

  // Svelte 5: the island owns its vote after hydration; props only seed it.
  // svelte-ignore state_referenced_locally
  let vote = $state<Vote>(myVote ?? { before: null, after: null });
  let choice = $state<Stance | ''>('');
  let pending = $state(false);
  let error = $state('');
  let announcement = $state('');
  // Server HTML keeps the button disabled until the island runs: an earlier submit would reload the page
  // and silently drop the vote.
  let hydrated = $state(false);
  onMount(() => (hydrated = true));

  const stanceLabel = (s: Stance) => (s === 'for' ? t('side.for') : s === 'against' ? t('side.against') : t('vote.undecided'));
  const closed = $derived(status === 'failed' || (votingClosesAt !== null && Date.parse(votingClosesAt) <= Date.now()));
  const next = $derived<Phase | null>(
    closed ? null : vote.before === null ? 'before' : status === 'complete' && vote.after === null ? 'after' : null,
  );
  const phase = $derived(only && next !== only ? null : next);
  // With `only`, the question is the form's only heading, asked once and without repeating the Motion above it.
  const legend = $derived(
    phase === 'before'
      ? only
        ? t('vote.beforeShort')
        : t('vote.before', { motion })
      : only
        ? t('vote.afterShort')
        : t('vote.after', { motion }),
  );

  async function cast(event: SubmitEvent) {
    event.preventDefault();
    if (!phase) return;
    error = '';
    if (!choice) {
      error = t('vote.choose');
      return;
    }
    pending = true;
    const castPhase = phase;
    const stance = choice;
    try {
      const response = await fetcher(`/api/debates/${debateId}/votes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phase: castPhase, stance }),
      });
      const body = (await response.json().catch(() => ({}))) as { vote?: Vote; error?: string };
      if (!response.ok || !body.vote) {
        error = body.error ?? t('vote.failed');
        return;
      }
      vote = body.vote;
      choice = '';
      const recorded = t('vote.recorded', { phase: castPhase, stance: stanceLabel(stance) });
      // The vote is said once: by the page when it brings in a fresh render (this panel is replaced), else here.
      // The Turns open with the before-vote: brought in place with focus on them, so the reader carries on
      // reading where the page now continues; a full reload only if that fails (it would start at the top).
      // Only the vote is said: the fresh dispatch box's own words are for the end of a live Debate.
      if (castPhase === 'before' && turnsHidden) {
        if (!(await refresh({ fetcher, prefix: recorded, announce: false, include: ['turns'], focus: '#turns' }))) reload();
        return;
      }
      // The hybrid rule: with the after-vote cast the outcome opens, so the page brings it in and moves focus
      // there (this form is replaced).
      if (castPhase === 'after' && (await refresh({ fetcher, prefix: recorded, focus: true }))) return;
      announcement = recorded;
    } catch {
      error = t('vote.failed');
    } finally {
      pending = false;
    }
  }
</script>

<section class="vote stack" aria-labelledby={only ? undefined : 'vote-title'}>
  {#if !only}
    <h3 id="vote-title">{t('vote.title')}</h3>
    <p class="muted">{t('vote.intro')}</p>
  {/if}

  {#if !signedIn}
    <p>{t('vote.signIn')}</p>
    <SignInButton callbackPath={`/debates/${debateId}`} {fetcher} />
  {:else}
    {#if vote.before && only !== 'after'}<p>{t('vote.youBefore', { stance: stanceLabel(vote.before) })}</p>{/if}
    {#if vote.after}<p>{t('vote.youAfter', { stance: stanceLabel(vote.after) })}</p>{/if}

    {#if closed}
      <p>{t('vote.closed')}</p>
    {:else if phase}
      <form onsubmit={cast} class="stack" novalidate>
        <fieldset>
          <legend>{legend}</legend>
          {#if phase === 'after' && only && vote.before}<p class="was">{t('vote.youBefore', { stance: stanceLabel(vote.before) })}</p>{/if}
          {#each ['for', 'against', 'undecided'] as const as stance (stance)}
            <label class="choice"><input type="radio" name="stance" value={stance} bind:group={choice} /> {stanceLabel(stance)}</label>
          {/each}
        </fieldset>
        <button type="submit" disabled={pending || !hydrated} aria-busy={pending}>{t(phase === 'before' ? 'vote.castBefore' : 'vote.castAfter')}</button>
      </form>
    {:else if vote.before && !vote.after && status === 'running' && !only}
      <p class="muted">{t('vote.waitAfter')}</p>
    {/if}
  {/if}

  <p role="status" aria-live="polite">{announcement}</p>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
</section>

<style>
  .was {
    color: var(--muted);
    font-size: 0.95rem;
  }
</style>
