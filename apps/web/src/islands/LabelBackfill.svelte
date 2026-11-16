<script lang="ts">
  import { t, tn } from '../i18n/t';

  interface Props {
    fetcher?: typeof fetch;
  }

  let { fetcher = fetch }: Props = $props();

  let pending = $state(false);
  let status = $state('');
  let error = $state('');

  // Each request labels a few Debates and says where to go on from; ones the labeller could not label are passed
  // over, so the run always ends.
  async function run() {
    pending = true;
    status = '';
    error = '';
    let labelled = 0;
    let failed = 0;
    let after: string | null = null;
    try {
      do {
        const res = await fetcher('/api/moderation/labels', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(after ? { after } : {}),
        });
        if (!res.ok) throw new Error(`POST /api/moderation/labels failed (${res.status})`);
        const round = (await res.json()) as { labelled: number; failed: number; next: string | null };
        labelled += round.labelled;
        failed += round.failed;
        after = round.next;
      } while (after);
      status = `${tn('moderation.labelled', labelled)} ${failed > 0 ? t('moderation.labelsLeft', { count: failed }) : t('moderation.labelsDone')}`;
    } catch {
      error = t('moderation.labelsFailed');
    }
    pending = false;
  }
</script>

<button type="button" class="secondary" onclick={run} disabled={pending} aria-busy={pending}>{t('moderation.labelOlder')}</button>
<p role="status">{status}</p>
{#if error}<p role="alert" class="error">{error}</p>{/if}
