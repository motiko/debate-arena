<script lang="ts">
  // Copies the Debate's link. When the clipboard refuses (permissions, older browsers), the link is shown
  // selected in a field so it can be copied by hand.
  import { t } from '../i18n/t';

  interface Props {
    url: string;
    clipboard?: Pick<Clipboard, 'writeText'>;
  }

  let { url, clipboard }: Props = $props();

  let status = $state('');
  let manual = $state(false);
  let field = $state<HTMLInputElement>();

  async function copy() {
    status = '';
    try {
      await (clipboard ?? navigator.clipboard).writeText(url);
      manual = false;
      status = t('share.copied');
    } catch {
      manual = true;
      queueMicrotask(() => field?.select());
    }
  }
</script>

<div class="copy-link">
  <button type="button" class="secondary" onclick={copy}>
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
      ><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"></path><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"></path></svg
    >
    {t('share.copy')}
  </button>
  {#if manual}
    <label class="manual">{t('share.manual')} <input bind:this={field} readonly value={url} /></label>
  {/if}
  <p role="status" class="copied">{status}</p>
</div>

<style>
  .copy-link {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .manual {
    font-weight: 400;
  }
  .copied {
    font-size: 0.9rem;
  }
  .copied:empty {
    display: none;
  }
</style>
