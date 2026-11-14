# Chamber redesign: design

Approved mockup: https://claude.ai/artifact/SAgfL6RTzws4zzTXiFeG7N (private canvas; desktop and phone artboards).
Critique of the mockup (27/40): `.impeccable/critique/2026-11-14T07-13-42Z__claude-worktrees-mockup-project-main-dc-html.md`
in the main checkout (untracked); its findings are folded in below.

## Intent

Debate Arena gets its own visual identity, taken from the debating chamber, on every page. A debate should
read as a contest between two benches facing each other across the floor, and its outcome should be earned
(Oxford rules: state your position, read, then vote again), not given away at the top.

## Decisions by the user

1. **Ask first.** The top of a Debate page asks the reader where they stand before it shows any outcome.
2. **Record kept.** "Record of this Debate" stays a section at the end, restyled in the chamber's language,
   with a quiet Report control.
3. **Whole site now.** All pages are redesigned in one plan; the critique's issues are fixed during the build.

## Visual system

- Colour tokens (light / dark), every text pair at least 4.5:1:

  | Token | Light | Dark | Use |
  |---|---|---|---|
  | `--paper` | `#EEF1EC` | `#0F1A15` | page background |
  | `--surface` | `#F8FAF6` | `#15231C` | raised boxes (Verdict, forms) |
  | `--ink` | `#16211C` | `#E3EAE5` | text |
  | `--muted` | `#4A5650` | `#A3B1A9` | secondary text |
  | `--line` | `#C5CFC7` | `#2E4137` | rules, borders |
  | `--green` | `#1D5C45` | `#86CBAE` | links, the floor line |
  | `--band` | `#1D5C45` | `#173A2C` | header band |
  | `--band-ink` | `#F2F5F1` | `#EEF3EF` | text on the band |
  | `--band-muted` | `#C2D6CC` | `#A9C2B5` | secondary text on the band |
  | `--for` | `#2457A6` | `#9BB9F2` | the For side |
  | `--against` | `#8E2433` | `#F2A6B1` | the Against side |
  | `--for-fill` | `#2457A6` | `#3462B5` | a solid For slab (bench, swing bar); the pastel `--for` stays for text and lines |
  | `--against-fill` | `#8E2433` | `#A3354A` | a solid Against slab |
  | `--on-fill` | `#FFFFFF` | `#F4F7F5` | text on a side fill |
  | `--brass` | `#B8933A` | `#D8B866` | the dispatch box edge, the logo and Verdict marker (decorative only) |
  | `--for-tint` | `rgb(36 87 166 / 0.07)` | `rgb(155 185 242 / 0.09)` | For speech background |
  | `--against-tint` | `rgb(142 36 51 / 0.065)` | `rgb(242 166 177 / 0.085)` | Against speech background |
  | `--note-bg` / `--note-text` | `#FFF4D6` / `#4D3800` | `#3A2F10` / `#FFE4A3` | notices (unchanged) |

- **Focus ring** follows the surface: `--focus` is `--ink` on paper and `--band-ink` inside the band.
  3px outline, 2px offset.
- **Type.** Speeches, the Motion, headings and the brand are set in **Source Serif 4**, self-hosted (one latin
  woff2, preloaded, `font-display: swap`, metric-adjusted fallback). Interface text stays in the system sans.
  No third-party font requests (ADR 0005).
- **Signature.** The bench-green band (header, Motion, benches, dispatch box) and the floor line down the
  middle of the Turns. Everything else stays quiet: no uppercase labels, no card grids, no gradients, no motion
  except the live marker and a new Turn appearing (both off under reduced motion).

## The Debate page

Top to bottom: band (header, Motion, benches and dispatch box), "How this Debate works", floor (Turns by phase),
after-vote (when due), Verdict, Audience division, AI Audience Result (when present), Record, the way onward.

### Band

- "The Motion before the house" above the Motion (h1, serif, paper colour). Its size steps down with length:
  up to 120 characters 3.75rem (desktop) / 2.0625rem (phone); 121–200 2.75rem / 1.75rem; longer 2.25rem / 1.5rem.
- Two benches on the band's bottom edge, solid side colour, text `--on-side`: "For the Motion" / "Against the
  Motion", the model's label (serif) and "Spoke {count} times" (only once the Debate has Turns).
- Between them, the **dispatch box**: paper background, brass edge, the tallest of the three. Content by state
  (first match wins):

  | State | Box shows |
  |---|---|
  | `turnsHidden` (signed-in Member who can still cast a before-vote) | the before-vote form, whose legend "Where do you stand?" is the box's only question (no inner fieldset border); while the Debate runs, "Live now" with the marker above it |
  | Batch, not complete | "Being argued through batch processing. Published when complete." |
  | Live, running | "Live now" with a pulsing marker, and "Follow the speeches below." (the floor shows who speaks next) |
  | Failed, with Turns | "Judging failed. The speeches are below; there is no Verdict." |
  | Failed, without Turns | "This Debate could not be completed." |
  | Complete, outcome shown (see below) | the Outcome summary |
  | Complete, outcome hidden, after-vote due | "Voting open", "You voted {stance} before the Debate.", "Vote again after the speeches, then see the result." and a link to the after-vote at the foot of the floor |
  | Complete, outcome hidden | "Voting open", why the result is folded away, and a "Show the result" link that opens the one folded outcome (below) |

  Signed-out Viewers, while voting is open (running, or complete and hidden), also see the page's one sign-in
  button in the box: "Members vote before and after the Debate." / "Sign in to vote".
- **The hybrid rule** (`outcomeHidden` in `lib/debate.ts`, used by the Debate page and the home feed): the
  outcome (Verdict, Audience Result, AI Audience Result, Swing, Outcome summary, home "Carried"/"Defeated") is
  **hidden while Audience voting is open for the Debate and the reader has not cast their after-vote**. Once
  voting has closed, or the reader cast the after-vote, or the Debate is a Batch Debate (no Audience Votes) or
  failed, it is shown openly everywhere. While hidden, **one reveal governs the page**: the Verdict, Audience
  Result and AI Audience Result sit in a single `<details id="outcome">` under the floor ("Show the result" /
  "Hide the result", works without JavaScript); the dispatch box's "Show the result" link opens it and jumps
  there (without JavaScript it jumps to its summary), and while it is open the dispatch box shows the Outcome
  summary too (CSS `:has`).
- **The end of a live Debate**, in place and without a reload: the floor closes with "The Debate is over." between
  two brass rules drawn out from the middle (static under reduced motion); the page then renders its dispatch box
  and outcome again (`lib/refresh.ts` swaps the `data-region` elements for a fresh server render), so nothing from
  the running state remains. A reader who cast a before-vote is asked "Where do you stand now?" at the foot of the
  floor, where the reading ends; casting it brings the outcome in the same way. Each change is announced once in a
  polite live region. If the fresh render fails, a "Reload to see the result" link remains; without JavaScript the
  running page says to reload.
- **Outcome summary**:
  - Headline (serif, bench size): judge and audience agree, or the audience has no counted votes → For:
    "{model} carries the Motion"; Against: "{model} defeats the Motion". They disagree (audience winner is a
    Side, not a tie, and differs from the Verdict) → "Split decision".
  - Rows: "Judge: {side}" and, for live Debates, "Audience: {side}, {swing} points" / "Audience: tied" /
    "Audience: no paired votes yet". Batch Debates have no Audience row.
- **Copy link**: once, in the Record (never before the Motion h1 in reading order).
- On the phone the dispatch box sits above the two benches, which sit side by side.

### Floor

- One section per phase with an **h2**: "{phase name}" plus the word limit "{maxWords} words" as a smaller
  line. The phase heading sits on the floor line (centred on desktop, a full-width rule with the label on the
  phone).
- Speeches are **h3** "{model}, {side}" with a visually hidden prefix "{phase}: " for screen readers, then
  "AI-generated". For hangs from the left, Against from the right, staggered 5rem lower on desktop; on the phone
  each is indented 1.75rem from the opposite edge. The header rule runs toward the floor and stops 0.75rem short
  of the phase heading.
- The first two paragraphs show; the rest sit in a `<details>` whose summary is "Read the full speech" (works
  without JavaScript). A speech cut off at the word limit shows "This Turn was cut off at the word limit." **below
  the visible text, always**, and its last visible text ends with "…".
- Live Debates: the same structure, filled in by the existing live island; the next empty slot shows a
  placeholder "{side} speaks next" with the live marker in that Side's colour.
- Above the floor, a collapsed "How this Debate works" (`<details>`, text-style summary): the Debaters, the
  Judge and Verdict, the Audience Vote and Swing, in plain words (Batch Debates: no Audience Votes).
- `turnsHidden`: the floor shows the existing notice ("Cast your before-vote to read the Turns…"); the Verdict,
  Audience division and AI Audience Result are not rendered.

### Verdict, division, AI audience, record

- **After-vote** (when due): under a brass rule at the foot of the floor, "Where do you stand now?" as the
  form's legend, the reader's before-vote, and "Cast after-vote".
- **Verdict** at the foot of the floor under the brass lozenge: h2 "Verdict" (serif, heading size, with the
  AI-generated label), the winner as
  "{side}: {model}" (serif, side colour), the reasoning paragraphs (serif), "Judged by {judges}. AI-generated."
  Self-Judging badge as today.
- **Audience division** (live Debates only): h2 "Audience Result", then the swing chart: one horizontal axis,
  For's swing drawn left of the centre and Against's to the right, length proportional to the points (max 100),
  each labelled outside the bar ("For +13", "Against −13"). The chart is `aria-hidden`; the existing sentence from
  `swingText()` sits under it as the text alternative. With no counted votes there is no chart, only that
  sentence and, while voting is open, what will appear. Then the reader's own votes and the voting-closes line.
- **AI Audience Result**: same chart and sentence (AI voters), with the existing voter list and notes.
- **Record of this Debate** (h2), two columns on desktop, stacked on the phone: a definition list (Format:
  "{name}: {phase names joined with commas}", Judge: "{labels}, picked by the platform" or "chosen by the
  starter", Started: date, Finished: date when complete, Kind: "Batch Debate" when batch), then "Copy link to
  this Debate" and, below it, the existing Report form behind a quiet disclosure whose summary is
  "Report this Debate" (flag icon, text style), with "A moderator reviews every report."
- Last, a way onward for Viewers arriving from a shared link: "More Debates on the order paper" and "Start a Debate".

## Other pages

All pages share the band header (brand with the brass lozenge, nav, quota, sign in/out) and the footer.

- **Home** is the order paper: h1 "Debates", the tagline, then a list (`<ol>`, unnumbered: the feed pages by a date
  cursor, so a position means nothing) of Motions in serif. From 64rem the date sits in the left margin and the
  outcome, AI label and Batch badge in a right gutter; on a phone it is one column. Each entry: the Motion as a link, "{For model} for, {Against model} against", the outcome in words when complete
  ("Carried" / "Defeated" by the Verdict; "Voting open" instead while the hybrid rule hides the outcome, from the
  feed's `votingClosesAt`), the Batch badge, the date. A thin rule between entries; no cards.
- **Start a Debate**: the h1 in the band, then the Quota line, the kind (Full or Batch Debate, two radio cards with
  their cost), the Motion field large (serif), the two benches side by side as the two Debater selects (For on
  cobalt-edged, Against on oxblood-edged fieldsets; the same model cannot sit on both), the Judge and AI Voters,
  a one-line summary, the submit button.
- **Account, moderation, blocked, legal, 404, 500**: the shared header and footer; the h1 and intro in a slim band
  (`PageHead`) closed by a brass rule and lozenge; cards become plain sections separated by rules. The moderation
  queue is a triage list: one ruled row per Debate, Relist and Block side by side, the Block form disclosed.

## Constraints

- ADR 0004: Lighthouse Performance ≥ 0.9, SEO 1, Accessibility 1 (mobile, slow 4G) on home, a Debate page and
  /new; axe passes on every page; WCAG 2.2 AA, keyboard-only use, reduced motion.
- ADR 0005: no third-party requests (fonts included).
- Every string a viewer sees comes from `src/i18n/en.ts`.
- Behaviour, API and data stay as they are; only `apps/web` changes. Existing e2e flows keep working; their
  selectors change only where this design renames visible text.
