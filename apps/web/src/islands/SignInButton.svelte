<script lang="ts">
  import { t } from '../i18n/t';
  import { signInWithGithub } from '../lib/auth';

  interface Props {
    callbackPath: string;
    label?: string;
    navigate?: (url: string) => void;
    fetcher?: typeof fetch;
  }

  let { callbackPath, label = t('auth.signIn'), navigate = url => location.assign(url), fetcher = fetch }: Props = $props();

  let pending = $state(false);
  let error = $state('');

  async function signIn() {
    pending = true;
    error = '';
    try {
      navigate(await signInWithGithub(callbackPath, fetcher));
    } catch {
      error = t('auth.signInFailed');
      pending = false;
    }
  }
</script>

<button type="button" onclick={signIn} disabled={pending} aria-busy={pending}>{label}</button>
{#if error}<p role="alert" class="error">{error}</p>{/if}
