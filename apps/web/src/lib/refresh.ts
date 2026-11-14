// Brings parts of a server-rendered page up to date without a reload: the page is rendered again and each
// element marked data-region="name" is replaced by its fresh render. Islands inside a fresh region hydrate on
// their own (Astro islands start when connected). Used when a live Debate ends and after the after-vote.

export interface RefreshOptions {
  fetcher?: typeof fetch;
  doc?: Document;
  /** The page to render again; defaults to the current one. */
  url?: string;
  /** Said before the fresh regions' own announcements (their data-announce), e.g. that a vote is recorded. */
  prefix?: string;
  /** Move focus to the fresh render's [data-focus] element: the control that had it is about to be replaced. */
  focus?: boolean;
}

/** True when at least one region was replaced; false leaves the page exactly as it was. */
export async function refreshRegions(options: RefreshOptions = {}): Promise<boolean> {
  const { fetcher = fetch, doc = document, prefix = '', focus = false } = options;
  let html: string;
  try {
    const response = await fetcher(options.url ?? doc.location.href, { headers: { accept: 'text/html' }, cache: 'no-store' });
    if (!response.ok) return false;
    html = await response.text();
  } catch {
    return false;
  }
  const fresh = new DOMParser().parseFromString(html, 'text/html');
  const swaps: [HTMLElement, HTMLElement][] = [];
  for (const region of doc.querySelectorAll<HTMLElement>('[data-region]')) {
    const next = fresh.querySelector<HTMLElement>(`[data-region="${region.dataset.region}"]`);
    if (next) swaps.push([region, doc.importNode(next, true)]);
  }
  if (swaps.length === 0) return false;

  const said: string[] = prefix ? [prefix] : [];
  for (const [region, next] of swaps) {
    next.dataset.arrived = '';
    region.replaceWith(next);
    if (next.dataset.announce) said.push(next.dataset.announce);
  }
  const announcer = doc.getElementById('debate-announcer');
  if (announcer) announcer.textContent = said.join(' ');
  if (focus) swaps.map(([, next]) => next.querySelector<HTMLElement>('[data-focus]')).find(Boolean)?.focus();
  return true;
}
