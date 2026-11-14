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
  | `--on-side` | `#FFFFFF` | `#0F1A15` | text on a solid side colour |
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

Top to bottom: band (header, Motion, benches and dispatch box), floor (Turns by phase), Verdict, Audience
division, AI Audience Result (when present), Record.

### Band

- "The Motion before the house" above the Motion (h1, serif, paper colour). Its size steps down with length:
  up to 120 characters 3.75rem (desktop) / 2.0625rem (phone); 121–200 2.75rem / 1.75rem; longer 2.25rem / 1.5rem.
- Two benches on the band's bottom edge, solid side colour, text `--on-side`: "For the Motion" / "Against the
  Motion", the model's label (serif) and "Spoke {count} times" (only once the Debate has Turns).
- Between them, the **dispatch box**: paper background, brass edge, the tallest of the three. Content by state
  (first match wins):

  | State | Box shows |
  |---|---|
  | `turnsHidden` (signed-in Member who can still cast a before-vote) | "Where do you stand?" and the before-vote form (the existing VotePanel, before phase only) |
  | Batch, not complete | "Being argued through batch processing. Published when complete." |
  | Live, running | "Live now" with a pulsing marker, and "Follow the speeches below." (the floor shows who speaks next) |
  | Failed, with Turns | "Judging failed. The speeches are below; there is no Verdict." |
  | Failed, without Turns | "This Debate could not be completed." |
  | Complete, outcome revealed (see below) | the Outcome summary |
  | Complete, outcome not revealed | a `<details>` whose summary is "Show the result" and whose body is the Outcome summary |

- **Outcome revealed** only for a live Debate whose reader has nothing left to vote on: they cast their
  after-vote, or voting is closed. Otherwise (signed out, still to cast the after-vote, or any Batch Debate) the
  outcome is behind "Show the result". (Interpretation of decision 1: revealing right after the before-vote would show
  the result before the reader has read the Debate.)
- **Outcome summary**:
  - Headline (serif, bench size): judge and audience agree, or the audience has no counted votes → For:
    "{model} carries the Motion"; Against: "{model} defeats the Motion". They disagree (audience winner is a
    Side, not a tie, and differs from the Verdict) → "Split decision".
  - Rows: "Judge: {side}" and, for live Debates, "Audience: {side}, {swing} points" / "Audience: tied" /
    "Audience: no paired votes yet". Batch Debates have no Audience row.
- **Copy link** button at the top right of the Motion block (also in the Record).
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
  placeholder "{side} speaks next" with the live marker.
- `turnsHidden`: the floor shows the existing notice ("Cast your before-vote to read the Turns…"); the Verdict,
  Audience division and AI Audience Result are not rendered.

### Verdict, division, AI audience, record

- **Verdict** at the foot of the floor under the brass lozenge: h2 "Verdict", the winner as
  "{side}: {model}" (serif, side colour), the reasoning paragraphs (serif), "Judged by {judges}. AI-generated."
  Self-Judging badge as today.
- **Audience division** (live Debates only): h2 "Audience Result", the after-vote form (VotePanel, after phase
  only) when the reader can cast it, then the swing chart: one horizontal axis, For's swing drawn left of the
  centre and Against's to the right, length proportional to the points (max 100), each labelled outside the bar
  ("For +13", "Against −13"). The chart is `aria-hidden`; the existing sentence from `swingText()` sits under it
  as the text alternative. Voting-closes line as today.
- **AI Audience Result**: same chart and sentence (AI voters), with the existing voter list and notes.
- **Record of this Debate** (h2), two columns on desktop, stacked on the phone: a definition list (Format:
  "{name}: {phase names joined with commas}", Judge: "{labels}, picked by the platform" or "chosen by the
  starter", Started: date, Finished: date when complete, Kind: "Batch Debate" when batch), then "Copy link to
  this Debate" and, below it, the existing Report form behind a quiet disclosure whose summary is
  "Report this Debate" (flag icon, text style), with "A moderator reviews every report."

## Other pages

All pages share the band header (brand with the brass lozenge, nav, quota, sign in/out) and the footer.

- **Home** is the order paper: h1 "Debates", the tagline, then a numbered list (`<ol>`) of Motions in serif. Each
  entry: the Motion as a link, "{For model} for, {Against model} against", the outcome in words when complete
  ("Carried" / "Defeated" by the Verdict), the Batch badge, the date. A thin rule between entries; no cards.
- **Start a Debate**: h1, the Motion field large (serif), then the two benches side by side as the two Debater
  selects (For on cobalt-edged, Against on oxblood-edged fieldsets), the Judge and options below, the cost line,
  the submit button.
- **Account, moderation, blocked, legal, 404, 500**: the shared header and footer, paper background, serif h1,
  existing structure and copy; cards become plain sections separated by rules.

## Constraints

- ADR 0004: Lighthouse Performance ≥ 0.9, SEO 1, Accessibility 1 (mobile, slow 4G) on home, a Debate page and
  /new; axe passes on every page; WCAG 2.2 AA, keyboard-only use, reduced motion.
- ADR 0005: no third-party requests (fonts included).
- Every string a viewer sees comes from `src/i18n/en.ts`.
- Behaviour, API and data stay as they are; only `apps/web` changes. Existing e2e flows keep working; their
  selectors change only where this design renames visible text.
