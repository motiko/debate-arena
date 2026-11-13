<script lang="ts">
  import { t } from '../i18n/t';
  import { signOut } from '../lib/auth';

  interface Props {
    navigate?: (url: string) => void;
    fetcher?: typeof fetch;
  }

  let { navigate = url => location.assign(url), fetcher = fetch }: Props = $props();

  let pending = $state(false);
  let error = $state('');

  async function leave() {
    pending = true;
    error = '';
    try {
      await signOut(fetcher);
      navigate('/');
    } catch {
      error = t('auth.signOutFailed');
      pending = false;
    }
  }
</script>

<button type="button" class="secondary" onclick={leave} disabled={pending} aria-busy={pending}>{t('auth.signOut')}</button>
{#if error}<p role="alert" class="error">{error}</p>{/if}
