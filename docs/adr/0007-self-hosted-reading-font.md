# One self-hosted reading serif

Debates are read, not skimmed: each speech runs to hundreds of words, and the chamber design sets the Motion, the speeches and the headings in a serif that reads well at length. The web app ships exactly one font file, the latin subset of Source Serif 4 as a variable font (weights 200–900, normal style), vendored at `apps/web/src/assets/fonts/` with its SIL Open Font License. Astro's Fonts API (local provider) serves it from our own origin, preloads it, and generates a metric-adjusted fallback face, so text shows at once and barely shifts when the font arrives. Interface text stays in system fonts.

The cost is one same-origin request of 50.9 KB, about 0.3 s on the slow-4G profile of the quality bar (ADR 0004), off the critical path because the stylesheet is inlined and the font is preloaded with `font-display: swap`.

## Considered Options

- **System fonts only** (the previous rule): no download, but no serif that is both good for long reading and present on every platform.
- **Google Fonts**: a third-party request that sends visitors' IP addresses to Google, which ADR 0005 rules out.
- **The optical-size variable file** (122 KB): nicer at display sizes, more than twice the bytes for a difference few readers see.
- **Static 400 and 600 files** (about 41.6 KB in two requests): smaller in total, but two requests and no in-between weights.
