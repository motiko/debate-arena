/** At most one draft event per Turn this often: enough to look live, few enough to be cheap to relay. */
export const DRAFT_INTERVAL_MS = 300;

export interface DraftSender {
  /** The Turn so far. Sent at once if the interval has passed, else the latest text is sent when it has. */
  push(text: string): void;
  /** No more drafts: drops a pending one and waits for one in flight, so nothing is sent after the Turn. */
  stop(): Promise<void>;
}

/**
 * Throttles a Turn's drafts. Each draft is the whole text so far, so skipping one loses nothing. Only one send is
 * ever in flight: drafts written meanwhile collapse into the latest, sent when it ends, so a slow room never builds
 * a backlog for the Turn to wait on. A failed send is dropped (drafts are best-effort, and never fail a Turn).
 */
export function createDraftSender(send: (text: string) => Promise<void>, intervalMs = DRAFT_INTERVAL_MS): DraftSender {
  let pending: string | null = null;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();
  let sending = false;
  let stopped = false;

  const schedule = () => {
    if (timer !== undefined || sending || stopped || pending === null) return;
    const wait = lastSentAt + intervalMs - Date.now();
    if (wait <= 0) flush();
    else timer = setTimeout(flush, wait);
  };

  const flush = () => {
    timer = undefined;
    if (stopped || pending === null || sending) return;
    const text = pending;
    pending = null;
    lastSentAt = Date.now();
    sending = true;
    inFlight = (async () => {
      try {
        await send(text);
      } catch {
        // Best-effort: the next draft, or the Turn itself, brings Viewers up to date.
      } finally {
        sending = false;
        schedule();
      }
    })();
  };

  return {
    push(text) {
      if (stopped) return;
      pending = text;
      schedule();
    },
    async stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = null;
      await inFlight;
    },
  };
}
