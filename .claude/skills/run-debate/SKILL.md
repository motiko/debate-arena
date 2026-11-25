---
name: run-debate
description: Run a full Debate Arena debate from the CLI. Start it, hand the user the watch link at once, and have subagents on different Claude models argue each Custom Debater Side live, then have a local panel of judge and voter subagents (on other models) give their own verdict. By default both Sides are Custom Debaters played by Claude subagents. Before starting it asks for topics and heat, offers a short list of motions to pick from, and asks which judges and how many voters; pass `auto` to skip every question and run straight through on defaults. Use whenever the user asks to run, start, launch, hold or stage a debate (or "custom debate", "debate X vs Y", "have Claude debate ..."), even when they don't name the CLI, the skill, or Custom Debaters.
argument-hint: "[auto] [motion or wishes, e.g. 'hot, about AI']"
---

# Run a debate

Goal: a live debate the user can watch from the first moment, with every Custom Debater Turn submitted fast. Two things matter most to the user:

1. **The watch link comes first, where the user actually sees it.** Text written between tool calls in the middle of a turn may never reach the user, so it doesn't count. The link counts as delivered only when it is the first line of a message that ends your turn (see step 4).
2. **Turns go in as soon as they are awaited.** Each Custom Side is argued by its own background subagent (the `debate-speaker` skill) that waits for its Turn and submits immediately. You don't relay speeches, and you don't ask the user to approve each speech. Their request to run the debate is the approval.

Work from the debate-arena repo root (the checkout holding `packages/cli`). The CLI is `node packages/cli/src/main.ts` (same as `pnpm debate`, without pnpm's banner line, which breaks `--json` output).

The repo defines an agent for each role in `.claude/agents/`, each running its skill: `motion-generator` (generate-motion), `debater` (debate-speaker), `judge` (debate-judge) and `voter` (debate-voter). Spawn them by `subagent_type`. If a type isn't available (agents defined after the session started load only on restart), use `general-purpose` with the same prompt plus "Read and follow <repo root>/.claude/skills/<skill>/SKILL.md".

## 1. Settle the setup

### Interactive or auto

- **Interactive (default):** the user shapes the debate in at most two rounds of questions (below), then everything runs on its own.
- **Auto:** when the arguments contain `auto` (or the user says "just run it", "don't ask", or the request comes from a loop or schedule with nobody to answer), ask nothing: generate one motion and use it, saying which one you picked, and use the default panel (two judges, four voters). This is for unattended runs, so a question there would stall the whole debate.

Either way, anything the user already said wins: never ask about something the request already settles. A motion given in the request skips both rounds' motion questions; "with 8 voters" skips the voters question. If every question is already answered, ask none.

### Round 1: what to debate, and who decides

One AskUserQuestion call with the questions still open (up to four), so the user answers everything on one screen:

1. **Topics** (multiSelect): options such as `Tech & AI`, `Politics & economy`, `War & religion`, `This week's news` (news sets the generator's source to `news`). The user can type any other topic, or "any", under Other.
2. **Heat:** `Mild` (a fun or practical trade-off), `Spicy (Recommended)` (a live public disagreement), `Hot` (splits societies on values, identity or security). Put the short meaning in each option's description: "heat" is how divided people are, not how offensive the motion is.
3. **Judges** (the local panel of step 7): `Fable + Haiku (Recommended)`, the two models no speaker uses, so nobody judges their own speeches; `One judge (Fable)`; `All four models`, which says in its description that Opus and Sonnet then also judge their own speeches. Other takes any list of `opus`, `sonnet`, `haiku`, `fable`.
4. **Voters** (local audience): `4 (Recommended)`, `2`, `8`, `None`. Other takes any number from 0 to 12 (each voter is a subagent, so more costs more and adds little).

### Round 2: pick the motion

Spawn the `motion-generator` agent (foreground) with `count: 4` and the topics, heat and source from round 1 (plus any type or region the user gave). Then one AskUserQuestion, single select, one option per motion:
- **label:** a 2–4 word name for the motion (e.g. "Congestion pricing");
- **description:** the motion text itself, exactly as it will be started;
- **preview:** the motion, the For and Against best-case lines, and the `Background:` line if there is one.

The user can type their own motion under Other, or ask for different ones: then generate four more, avoiding the ones already shown, and ask again. Use the motion verbatim. If it came with a `Background:` line, keep it for the speakers (step 5).

### The rest of the setup (never asked; follow the request when it says)

- **Sides:** both `custom` by default. If the user names a model for a Side (e.g. "against deepseek/deepseek-r1-0528"), seat that model there instead. Use `node packages/cli/src/main.ts models --search <words>` to resolve a vague name to an exact id.
- **Models:** each subagent runs on a different Claude model, set with the Agent tool's `model`. By default the For speaker runs on `opus` and the Against speaker on `sonnet`; the local judges (step 7) run by default on the models no speaker uses (`fable`, `haiku`), so no model judges its own speeches. Follow any model choice the user names. The current ids: `opus` = `claude-opus-5-5`, `sonnet` = `claude-sonnet-5-5`, `haiku` = `claude-haiku-5-5`, `fable` = `claude-fable-5-1`.
- **Custom Debater identity:** give each custom Side its own creative nickname, unless the user names them. Invent a fresh, distinct, characterful pair for every debate, ideally playing on the motion: for a homework motion, e.g. `The Recess Liberator` vs `Captain Times-Table`; for an exams motion, `Portfolio Pilgrim` vs `The Invigilator`. Don't use generic names like "Claude (For)", and don't reuse a pair. Keep them friendly, never mocking a real person, and within the platform's rules: ≤40 characters; letters, digits, spaces and `.,_'-()/:+#&!?@` only (no emoji). Pass each speaker its nickname so it can stay in character, lightly. Give it a self-reported model that names the model its subagent really runs on: the full id of the `model` you set on that Agent call (your own model id if you set none). The platform shows it to Viewers and doesn't verify it, so it must be true.
- **Optional:** `--panel <model,model>` and `--ai-voters <n>` (how many AI Voters, 0–100) only when asked.

## 2. Token

The CLI needs `DEBATE_ARENA_TOKEN`, stored in the macOS Keychain under service `debate-arena-token`. Read it inline in the same command and never echo it:
`DEBATE_ARENA_TOKEN="$(security find-generic-password -s debate-arena-token -w)" node packages/cli/src/main.ts …`
If the lookup fails, ask the user to store a token (created at `<platform>/account`) with `security add-generic-password -a "$USER" -s debate-arena-token -w` in their own terminal. Never ask them to paste it into the chat.

## 3. Price check only when it can cost Quota

If any Side or panel model is a platform AI model (not custom), run the same `start` with `--dry-run --json` first. If it costs more than 0 Quota points, tell the user the cost and ask before starting. A custom-vs-custom debate is never priced; start it straight away.

## 4. Start, then give the link immediately

```bash
DEBATE_ARENA_TOKEN="$(security find-generic-password -s debate-arena-token -w)" node packages/cli/src/main.ts start "<motion>" \
  --for custom --for-name "Claude (For)" --for-model <model-id> \
  --against custom --against-name "Claude (Against)" --against-model <model-id> \
  --detach --json
```

It prints `{"id","url",...}`. Then, with no other work in between:

1. In your next response, spawn the speakers (step 5) and the end watcher (step 6). All of them run in the background.
2. **End the turn** with a message whose first line is the link, exactly like this:
   ```
   Watch live: <url>
   ```
   followed by one line on the motion and who argues each Side. Don't put anything before the link line, and don't do any more work in that turn. The speakers keep debating in the background, and you're woken when they finish.

## 5. Spawn one speaker per custom Side

Use the Agent tool with `subagent_type: debater`, `run_in_background: true`, one call per custom Side with that Side's `model`, both in the same response. Keep the Sides independent: each speaker sees only the public transcript, never the other's plans, which makes it a real debate. Prompt template:

```
You are the <FOR|AGAINST> Side's Custom Debater in a live Debate Arena debate, appearing as "<nickname>".
Debate id: <id>
Watch link: <url>
Motion: "<motion>"
You argue <for|against> the motion.
Repo root (run all commands here): <absolute repo root>
Speech directory (write speech files here with the Write tool): <absolute temp dir, e.g. $CLAUDE_JOB_DIR/tmp expanded, never inside the repo>
Skill: <absolute repo root>/.claude/skills/debate-speaker/SKILL.md; its scripts are in that directory's scripts/ folder.
Start now: settle your case, then wait for your first Turn. Submit each Turn the moment it is ready. Stop when the debate ends and report the slots you submitted.
```

For a news motion, add the same `Background: …` line to both speakers' prompts, so they argue from the same facts even when the story is newer than their model's knowledge. Add any style or persona the user asked for (e.g. "argue like a 1920s barrister") to that Side's prompt only.

## 6. Watch for the end and report

After spawning, start a background Bash watcher (timeout 600000 ms) that ends with the debate:
`node .claude/skills/debate-speaker/scripts/wait-turn.mjs <id> end` (re-run it if it prints `{"waiting":true}`).

Repeat the watch link in every message you send about the debate until it ends: the user may have scrolled past the first one, so never write a status line without it. While the speakers work, don't poll, and don't post progress unless something fails. When the watcher or the speakers report `done` with status `complete`, go to step 7. Don't send a message in between.

## 7. Local judges and voters

The platform has no seat for an outside judge or voter: its verdict comes from its own judging panel, and only humans vote on the page. So this panel's result is reported in chat only, next to the platform's verdict.

1. Save the transcript to a file outside the repo: `node .claude/skills/run-debate/scripts/transcript.mjs <id> > <temp dir>/transcript-<id>.md`. It leaves out the platform verdict and the debaters' names and models, so nothing anchors the panel.
2. In one response, spawn the panel with the Agent tool, each in the background on its own `model`. The prompt names the transcript file (and, for a voter, the motion and its persona); the agents' skills cover the rest.
   - **The judges chosen in step 1** (`subagent_type: judge`), one per model; by default two, on the models no speaker used (`fable` and `haiku`). Each returns the winner, a 1–10 score per Side on each of the platform's four criteria (argument strength, rebuttal quality, evidence, clarity) and its reasons.
   - **The number of voters chosen in step 1** (`subagent_type: voter`; by default four), with models in turn `opus`, `sonnet`, `haiku`, `fable`, then round again, each with its own short persona. A persona is a listening style, never a stake in the motion: say what kind of argument lands with the voter, not who they are in relation to the topic. A stakeholder (a patient, a teacher, a taxpayer) votes their interest, and then the count shows the cast you picked, not the speeches. Take styles in this order, the same for any motion, starting again from the first after the eighth:
     1. distrusts statistics without a source;
     2. wants concrete examples;
     3. impatient with rhetoric;
     4. asks what happens in practice;
     5. weighs who bears the cost;
     6. rewards the Side that answers the other directly;
     7. cautious about big changes without evidence;
     8. thinks in the long run.
     Each voter returns its leaning before reading, the Side it backs after, and why.
   - With no judges or no voters chosen, skip that part, and leave it out of the summary.
3. When the whole panel has reported, summarise for the user in a few lines, with `Watch live: <url>` as the first line:
   - the platform's winner and its judge's reasoning in one or two sentences, from `verdict`;
   - the local judges' winners with the model behind each, and their criterion scores next to the platform Judge's Rubric Scores (from `verdict.scores`) as a small table, one column per judge with the platform first and each cell `For–Against`; say so if any judge picked a winner its own scores don't favour. Then the local vote as final count plus swing (e.g. For 3, Against 1; two voters moved to For, none to Against), noting where the local panel disagrees with the platform. A voter who ends where it started was not moved, so the swing, not the count, says who persuaded the audience;
   - any Turn that was cut at the word limit or failed;
   - the link again, so they can read the debate and vote (only humans can vote; the CLI cannot).

If the debate fails (status `failed`, e.g. a missed deadline), say so plainly with the reason, and say what you'd change before trying again.
