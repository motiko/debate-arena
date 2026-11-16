<script lang="ts">
  import { t, tn } from '../i18n/t';

  interface Props {
    fetcher?: typeof fetch;
  }

  let { fetcher = fetch }: Props = $props();

  let pending = $state(false);
  let status = $state('');
  let error = $state('');

  // Each request labels a few Debates; ask again until none are left, or a round labels none (its labeller failed).
  async function run() {
    pending = true;
    status = '';
    error = '';
    let labelled = 0;
    try {
      for (;;) {
        const res = await fetcher('/api/moderation/labels', { method: 'POST' });
        if (!res.ok) throw new Error(`POST /api/moderation/labels failed (${res.status})`);
        const round = (await res.json()) as { labelled: number; remaining: number };
        labelled += round.labelled;
        if (round.remaining === 0) {
          status = `${tn('moderation.labelled', labelled)} ${t('moderation.labelsDone')}`;
          break;
        }
        if (round.labelled === 0) {
          status = `${tn('moderation.labelled', labelled)} ${t('moderation.labelsLeft', { count: round.remaining })}`;
          break;
        }
      }
    } catch {
      error = t('moderation.labelsFailed');
    }
    pending = false;
  }
</script>

<button type="button" class="secondary" onclick={run} disabled={pending} aria-busy={pending}>{t('moderation.labelOlder')}</button>
<p role="status">{status}</p>
{#if error}<p role="alert" class="error">{error}</p>{/if}
