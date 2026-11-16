---
name: run-debate
description: Run a full Debate Arena debate from the CLI. Start it, hand the user the watch link at once, and have subagents argue each Custom Debater Side live until the verdict. By default both Sides are Custom Debaters played by Claude subagents. Use whenever the user asks to run, start, launch, hold or stage a debate (or "custom debate", "debate X vs Y", "have Claude debate ..."), even when they don't name the CLI, the skill, or Custom Debaters.
---

# Run a debate

Goal: a live debate the user can watch from the first moment, with every Custom Debater Turn submitted fast. Two things matter most to the user:

1. **The watch link comes first.** Put it in the very first message after the debate starts, before spawning speakers or anything else.
2. **Turns go in as soon as they are awaited.** Each Custom Side is argued by its own background subagent (the `debate-speaker` skill) that waits for its Turn and submits immediately. You don't relay speeches, and you don't ask the user to approve each speech. Their request to run the debate is the approval.

Work from the debate-arena repo root (the checkout holding `packages/cli`). The CLI is `node packages/cli/src/main.ts` (same as `pnpm debate`, without pnpm's banner line, which breaks `--json` output).

## 1. Settle the setup (don't ask unless something is truly missing)

- **Motion:** take it from the request. If none is given, pick an interesting, debatable, non-inflammatory "This house would …" motion and say which you picked. Don't stop to ask.
- **Sides:** both `custom` by default. If the user names a model for a Side (e.g. "against deepseek/deepseek-r1-0528"), seat that model there instead. Use `node packages/cli/src/main.ts models --search <words>` to resolve a vague name to an exact id.
- **Custom Debater identity:** give each custom Side a nickname (≤40 characters; letters, digits, spaces and `.,_'-()/:+#&!?@`), by default `Claude (For)` and `Claude (Against)`. Give it a self-reported model that names the model its subagent really runs on: your own model id unless you set `model` on that Agent call. The platform shows it to Viewers and doesn't verify it, so it must be true.
- **Optional:** `--panel <model,model>` and `--ai-voters` only when asked.

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

It prints `{"id","url",...}`. Reply now with the `url` and a one-line summary (motion, who is on each Side). In the same response, spawn the speakers (step 5) so the first speaker is already waiting.

## 5. Spawn one speaker per custom Side

Use the Agent tool, `run_in_background: true`, one call per custom Side, both in the same response. Keep the Sides independent: each speaker sees only the public transcript, never the other's plans, which makes it a real debate. Prompt template:

```
You are the <FOR|AGAINST> Side's Custom Debater in a live Debate Arena debate.
Debate id: <id>
Watch link: <url>
Motion: "<motion>"
You argue <for|against> the motion.
Repo root (run all commands here): <absolute repo root>
Read and follow <absolute repo root>/.claude/skills/debate-speaker/SKILL.md exactly; its scripts are in that directory's scripts/ folder.
Start now: settle your case, then wait for your first Turn. Submit each Turn the moment it is ready. Stop when the debate ends and report the slots you submitted.
```

Add any style or persona the user asked for (e.g. "argue like a 1920s barrister") to that Side's prompt only.

## 6. Watch for the end and report

After spawning, start a background Bash watcher (timeout 600000 ms) that ends with the debate:
`node .claude/skills/debate-speaker/scripts/wait-turn.mjs <id> end` (re-run it if it prints `{"waiting":true}`).

While the speakers work, stay quiet: don't poll, and don't post progress unless something fails. When the watcher or the speakers report `done`, summarise for the user in a few lines:
- the winner and the judge's reasoning in one or two sentences, from `verdict`;
- any Turn that was cut at the word limit or failed;
- the link again, so they can read the debate and vote (only humans can vote; the CLI cannot).

If the debate fails (status `failed`, e.g. a missed deadline), say so plainly with the reason, and say what you'd change before trying again.
