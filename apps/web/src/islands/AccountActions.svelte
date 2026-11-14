<script lang="ts">
  // Account deletion (ADR 0005). Better Auth refuses with SESSION_EXPIRED when the sign-in is over a day old;
  // the Member is then asked to sign in again and come back here.
  import { tick } from 'svelte';
  import { t } from '../i18n/t';
  import { deleteAccount, signInWithGithub } from '../lib/auth';

  interface Props {
    fetcher?: typeof fetch;
    navigate?: (url: string) => void;
  }

  let { fetcher = fetch, navigate = url => location.assign(url) }: Props = $props();

  let confirming = $state(false);
  let understood = $state(false);
  let pending = $state(false);
  let error = $state('');
  let needsReauth = $state(false);
  let startButton: HTMLButtonElement | undefined = $state();
  let confirmBox: HTMLInputElement | undefined = $state();

  // Each step replaces the button that had focus, so focus moves on to the next decision rather than the page start.
  async function confirm() {
    confirming = true;
    await tick();
    confirmBox?.focus();
  }

  async function cancel() {
    confirming = false;
    understood = false;
    error = '';
    needsReauth = false;
    await tick();
    startButton?.focus();
  }

  async function remove() {
    if (!understood) return;
    pending = true;
    error = '';
    needsReauth = false;
    try {
      const result = await deleteAccount(fetcher);
      if (result.ok) {
        navigate('/');
        return;
      }
      if (result.code === 'SESSION_EXPIRED') {
        needsReauth = true;
        error = t('account.reauth');
      } else {
        error = result.message;
      }
    } catch {
      error = t('account.deleteFailed');
    }
    pending = false;
  }

  async function reauth() {
    try {
      navigate(await signInWithGithub('/account', fetcher));
    } catch {
      error = t('auth.signInFailed');
    }
  }
</script>

<section class="delete panel stack" aria-labelledby="delete-title">
  <h2 id="delete-title">{t('account.deleteTitle')}</h2>
  <p>{t('account.deleteExplain')}</p>
  {#if !confirming}
    <button type="button" class="secondary" bind:this={startButton} onclick={confirm}>{t('account.delete')}</button>
  {:else}
    <label class="choice"><input type="checkbox" bind:this={confirmBox} bind:checked={understood} /> {t('account.deleteConfirm')}</label>
    <div class="actions">
      <button type="button" class="danger" onclick={remove} disabled={!understood || pending} aria-busy={pending}>{t('account.deleteFinal')}</button>
      <button type="button" class="secondary" onclick={cancel} disabled={pending}>{t('account.cancel')}</button>
    </div>
  {/if}
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  {#if needsReauth}<button type="button" class="secondary" onclick={reauth}>{t('account.reauthButton')}</button>{/if}
</section>

<style>
  /* The island's wrapper is display: contents, so the page's flow spacing does not reach this section. */
  .delete {
    margin-top: calc(var(--space) * 2);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
</style>
