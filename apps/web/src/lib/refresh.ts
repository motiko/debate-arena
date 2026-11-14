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

  const active = doc.activeElement;
  const lost = active && swaps.find(([region]) => region.contains(active));

  const said: string[] = prefix ? [prefix] : [];
  for (const [region, next] of swaps) {
    next.dataset.arrived = '';
    region.replaceWith(next);
    if (next.dataset.announce) said.push(next.dataset.announce);
  }
  const announcer = doc.getElementById('debate-announcer');
  if (announcer) announcer.textContent = said.join(' ');
  const target = focus ? swaps.map(([, next]) => next.querySelector<HTMLElement>('[data-focus]')).find(Boolean) : null;
  if (target) target.focus();
  else if (lost) keepFocus(active, lost[1]);
  return true;
}

/**
 * Focus was inside a region that has just been replaced, so it would fall back to the page's start: move it to
 * the same control in the fresh render (by id, else by name), or else to the fresh region itself.
 */
function keepFocus(was: Element, next: HTMLElement) {
  const all = [...next.querySelectorAll<HTMLElement>('[id], [name]')];
  const name = was.getAttribute('name');
  const match = (was.id && all.find(el => el.id === was.id)) || (name && all.find(el => el.getAttribute('name') === name));
  if (match) return match.focus();
  if (!next.hasAttribute('tabindex')) next.tabIndex = -1;
  next.focus();
}
