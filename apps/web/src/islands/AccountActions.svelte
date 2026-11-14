<script lang="ts">
  // Account deletion (ADR 0005). Better Auth refuses with SESSION_EXPIRED when the sign-in is over a day old;
  // the Member is then asked to sign in again and come back here.
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

<section class="card stack" aria-labelledby="delete-title">
  <h2 id="delete-title">{t('account.deleteTitle')}</h2>
  <p>{t('account.deleteExplain')}</p>
  {#if !confirming}
    <button type="button" class="secondary" onclick={() => (confirming = true)}>{t('account.delete')}</button>
  {:else}
    <label class="choice"><input type="checkbox" bind:checked={understood} /> {t('account.deleteConfirm')}</label>
    <button type="button" onclick={remove} disabled={!understood || pending} aria-busy={pending}>{t('account.deleteFinal')}</button>
  {/if}
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  {#if needsReauth}<button type="button" class="secondary" onclick={reauth}>{t('account.reauthButton')}</button>{/if}
</section>
