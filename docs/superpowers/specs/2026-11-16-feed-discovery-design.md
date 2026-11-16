# Feed discovery: Categories, Tags, search, filters and pagination — design

## Intent

The feed (`/`) is one date-ordered list of completed, listed Debates, 20 a page, with only an "Older" link. As
Debates accumulate, Viewers cannot find the ones they care about. This adds Categories and Tags to every Debate,
a text search, filters, and numbered pagination, so a Viewer can browse by subject, follow a Tag, look for a
Motion, or see what a given model has debated.

## Goals

- Every Debate gets one **Category** from a fixed list and 1–3 **Tags**, assigned by an AI model (the user chose
  AI-assigned, option A), so labels stay consistent and existing Debates can be labelled too.
- The feed can be searched (Motion text and Tags) and filtered by Category, Tag, Debater model and Slow Debate,
  in any combination, and pages through results with numbered pages.
- Works without JavaScript (plain GET form and links), keeps Lighthouse SEO/Accessibility 100 and Performance ≥ 90.

## Non-goals

- Members choosing or editing Categories or Tags (option B/C), Moderators editing labels.
- An outcome filter (Carried/Defeated): the feed hides the outcome while Audience voting is open, so filtering by
  the Verdict would leak it.
- Full-text ranking (FTS5), search in Turns, CLI listing commands.

## Anti-goals

- Labelling must never fail, delay or Flag a Debate: a failed labelling leaves the Debate unlabelled.
- Labels are AI-generated and must say so where shown (ADR 0005).

## Approaches considered

- **A. AI-assigned (chosen).** A cheap curated model labels the Motion in the screening step; cost reserved in the
  Budget; a Moderator-only backfill labels older Debates. Consistent, backfillable.
- B. Member-chosen in `/new` and the API: simpler, but existing Debates stay unlabelled and free Tags drift.
- C. AI suggests, Member edits: most UI, both costs. Not chosen.

Search: SQLite `LIKE` over the Motion and Tags (chosen) vs FTS5 (rejected for now: Motions are ≤ 300 chars and the
feed is small; FTS5 virtual tables add triggers and break `wrangler d1 export`).

Pagination: numbered pages with a total (`?page=n`, chosen) vs the existing date cursor (kept in the API as `before`
for compatibility; the web no longer uses it).

## Design

**Language.** GLOSSARY gains **Category** (one of a fixed list, AI-assigned) and **Tag** (a short lower-case
label, 1–3 per Debate, AI-assigned). Budget's definition gains labelling.

**Engine** (`packages/engine/src/labels/`): `CATEGORIES` (politics, economics, technology, science, health,
environment, philosophy, society, culture, sport), `LABEL_OUTPUT_TOKENS`, `labelMotion(motion, model, client,
{rethrow})` returning `{ category, tags } | null`. The model is asked for JSON `{"category": "...", "tags": [...]}`;
parsing is lenient (first JSON object in the reply), the category must be in the list, Tags are normalised (lower
case, `[a-z0-9 -]`, 2–24 chars, deduplicated, at most 3), an unknown category or bad reply gives null.
`worstCaseBudgetMicroUsd` takes an optional labeller and reserves one labelling call.

**Catalog.** New role `labeller`; Mistral Small gets it in production, a `fake-label/one` in the fake catalog;
`labellerFor(catalog)`. `catalogFor(…, 'batch')` keeps the labeller at its normal price, like the screener (labelling
is a normal call). `planDebate` reserves it and freezes its price.

**Step.** In the screen step, after the screen and before `saveScreen`, label the Motion with the screen client.
Labels are saved in the same write as the screen (so a retry never re-labels). `BudgetExhaustedError` rethrows;
anything else gives no labels.

**Storage** (migration `0010_debate_labels.sql`): `debates.category TEXT`, `debates.tags_json TEXT`, index on
`(category, completed_at)`. Null category = unlabelled.

**API.** `GET /api/debates?q&category&tag&model&kind&page` → `{ debates, page, pageCount, total }`; each summary
carries `category` and `tags`. Invalid params are ignored (a bad page is page 1). `before` still works (cursor
mode, no total). Search: up to 5 words of up to 100 chars total; every word must match the Motion or the Tags
(`LIKE` with `ESCAPE`). Model filter matches an AI Debater on either Side (`json_extract` on `setup_json`).
`GET /api/tags` → the 20 most used Tags on listed, completed Debates. `POST /api/moderation/labels` (Moderator
only) labels up to 10 unlabelled listed completed Debates, platform-paid (no Debate's Budget), and returns how many
it labelled and how many are left.

**Web.** Feed: a search form (search box, Category select, model select, Slow Debates checkbox, submit), a row of
Category links, popular Tags, active filters with "remove" links, a results count; each entry shows its Category and
Tags as links; numbered pagination (previous, pages with ellipsis, next) keeping the filters. The "how it works" strip
only on the unfiltered first page. Search results are `noindex`; Category/Tag pages are indexable with a canonical
URL. Debate page shows Category and Tags (links into the feed) with the AI-generated label. Moderation page gets a
"Label unlabelled Debates" button that calls the backfill.

## Left to the builder

Exact wording (in `i18n/en.ts`), styling within the existing order-paper look, the label prompt text.
