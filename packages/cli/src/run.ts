// The Debate Arena CLI: a Venue that is a client of the platform API (ADR 0002). It starts Debates as the Member
// whose API token is in DEBATE_ARENA_TOKEN, and reads Debates as a signed-out Viewer. It never prints the token.
import { parseArgs } from 'node:util';
import { createApiClient, matchesSearch, sendDraft, submitTurn, type PublicDebate } from '@debate-arena/api-client';
import { follow } from './follow.ts';
import { debateUrl, renderDebate } from './render.ts';
import { safeOutput } from './terminal.ts';

export interface CliDeps {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  WebSocketImpl: typeof WebSocket;
  out: (text: string) => void;
  err: (text: string) => void;
  isTTY: boolean;
  /**
   * What `debate speak` reads its Turn from, opened only when called: an opened stdin keeps the process alive until
   * it ends, so any other command would hang after its output under a parent whose stdin never ends (a background shell).
   */
  stdin: () => ReadableStream<Uint8Array>;
}

export const DEFAULT_BASE = 'https://debate-arena-web.motiko.workers.dev';

export const USAGE = `Usage: debate <command> [options]

Commands:
  start <motion> --for <model|custom> --against <model|custom>
      [--panel <model,model>] [--ai-voters] [--batch] [--detach] [--json]
                                                   Start a Debate and follow it live; "custom" seats a
                                                   Custom Debater whose Turns you send with speak
      [--for-name <name>] [--for-model <model>]    A Custom Debater's nickname and self-reported model
      [--against-name <name>] [--against-model <model>]
      [--dry-run]                                  Only show what it would cost in Quota points
  speak <id> [--slot <n>]                          Send the awaited API Turn from stdin, shown live
                                                   as it is read (e.g. my-agent | debate speak <id>)
  show <id> [--follow] [--json]                    Show a Debate (and follow it while it runs)
  models [--search <words>] [--json]               List the models you can choose
  whoami [--json]                                  Show who your token signs you in as
  help                                             Show this help

Environment:
  DEBATE_ARENA_TOKEN   Your API token (create one on your account page)
  DEBATE_ARENA_URL     Platform URL (default ${DEFAULT_BASE})

The CLI cannot vote: open the Debate's link to read and vote.
`;

/** Ends a command: the exit code, after anything printed. */
class Exit {
  readonly code: number;
  constructor(code: number) {
    this.code = code;
  }
}

interface Context {
  deps: CliDeps;
  base: string;
  token: string | undefined;
  print: (text: string) => void;
  fail: (text: string) => Exit;
}

const OPTIONS = {
  for: { type: 'string' },
  against: { type: 'string' },
  panel: { type: 'string' },
  'ai-voters': { type: 'boolean' },
  batch: { type: 'boolean' },
  detach: { type: 'boolean' },
  follow: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  slot: { type: 'string' },
  'for-name': { type: 'string' },
  'for-model': { type: 'string' },
  'against-name': { type: 'string' },
  'against-model': { type: 'string' },
  search: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean' },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>['values'];

/** What is read from a failed response; typed client responses and plain ones both have it. */
type Failed = { status: number; json(): Promise<unknown> };

async function readJson(response: Failed): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Why a request failed, in the API's words where it gave them. */
async function failure(ctx: Context, response: Failed): Promise<Exit> {
  if (response.status === 401) {
    return ctx.fail(`Your API token was refused: it may be revoked or expired. Create a new one at ${ctx.base}/account\n`);
  }
  const { error } = await readJson(response);
  return ctx.fail(`${typeof error === 'string' ? error : `Request failed (${response.status})`}\n`);
}

function requireToken(ctx: Context): string {
  if (!ctx.token) throw ctx.fail(`Set DEBATE_ARENA_TOKEN to an API token. Create one at ${ctx.base}/account\n`);
  return ctx.token;
}

const memberClient = (ctx: Context) =>
  createApiClient(ctx.base, { fetch: ctx.deps.fetch, headers: { authorization: `Bearer ${requireToken(ctx)}` } });
/** Reads go without credentials: a signed-in Member who has not voted would get the Turns hidden. */
const viewerClient = (ctx: Context) => createApiClient(ctx.base, { fetch: ctx.deps.fetch });

/** The values of --for and --against that seat a Custom Debater. */
const CUSTOM = ['custom', 'api'];

/** A Side as the API takes it: a model id or "custom", or a Custom Debater with its nickname and model. */
function seat(ctx: Context, side: 'for' | 'against', values: Values) {
  const value = values[side]!;
  const name = values[`${side}-name`];
  const model = values[`${side}-model`];
  if (name === undefined && model === undefined) return value;
  if (!CUSTOM.includes(value)) throw ctx.fail(`--${side}-name and --${side}-model need --${side} custom\n`);
  return { kind: 'custom' as const, ...(name !== undefined ? { name } : {}), ...(model !== undefined ? { model } : {}) };
}

async function start(ctx: Context, positionals: string[], values: Values): Promise<number> {
  const [motion] = positionals;
  if (!motion || !values.for || !values.against || positionals.length > 1) return usageError(ctx);
  const debaters = { for: seat(ctx, 'for', values), against: seat(ctx, 'against', values) };
  const client = memberClient(ctx);
  const panel = values.panel
    ?.split(',')
    .map(model => model.trim())
    .filter(Boolean);
  const body = {
    motion,
    debaters,
    ...(panel?.length ? { panel } : {}),
    aiVoters: values['ai-voters'] ?? false,
    batch: values.batch ?? false,
  };
  if (values['dry-run']) {
    const quote = await ctx.deps.fetch(client.api.debates.quote.$url(), {
      method: 'POST',
      headers: { authorization: `Bearer ${requireToken(ctx)}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!quote.ok) throw await failure(ctx, quote);
    const priced = (await quote.json()) as { budgetMicroUsd: number; quotaPoints: number; quotaRemaining: number };
    const points = priced.quotaPoints === 1 ? '1 Quota point' : `${priced.quotaPoints} Quota points`;
    ctx.print(
      values.json
        ? `${JSON.stringify(priced)}\n`
        : `${points} (${priced.quotaRemaining} left today) · worst case $${(priced.budgetMicroUsd / 1e6).toFixed(2)}\n`,
    );
    return 0;
  }
  const response = await ctx.deps.fetch(client.api.debates.$url(), {
    method: 'POST',
    headers: { authorization: `Bearer ${requireToken(ctx)}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status !== 201) throw await failure(ctx, response);
  const { id, panel: chosen, selfJudging } = (await response.json()) as { id: string; panel: string[]; selfJudging: boolean };
  const url = debateUrl(ctx.base, id);
  if (values.json) {
    ctx.print(`${JSON.stringify({ id, url, panel: chosen, selfJudging })}\n`);
    return 0;
  }
  ctx.print(`Started ${id}\n${url}\n`);
  // A Batch Debate has no live stream, and is visible only to its starter until complete.
  if (values.batch) {
    ctx.print(`A Batch Debate is published when complete; check back with: debate show ${id}\n`);
    return 0;
  }
  if (values.detach) return 0;
  return follow(id, { ...ctx.deps, base: ctx.base });
}

async function show(ctx: Context, positionals: string[], values: Values): Promise<number> {
  const [id] = positionals;
  if (!id || positionals.length > 1) return usageError(ctx);
  if (values.follow && !values.json) return follow(id, { ...ctx.deps, base: ctx.base });
  const response = await viewerClient(ctx).api.debates[':id'].$get({ param: { id } });
  if (response.status === 410) {
    const { blocked } = (await response.json()) as { blocked?: { explanation?: string | null } };
    throw ctx.fail(`This Debate was Blocked by a Moderator.${blocked?.explanation ? ` ${blocked.explanation}` : ''}\n`);
  }
  if (!response.ok) throw await failure(ctx, response);
  const debate = (await response.json()) as PublicDebate;
  ctx.print(values.json ? `${JSON.stringify(debate)}\n` : renderDebate(debate, ctx.base));
  return 0;
}

async function models(ctx: Context, values: Values): Promise<number> {
  const response = await viewerClient(ctx).api.models.$get();
  if (!response.ok) throw await failure(ctx, response);
  const { models: all } = (await response.json()) as {
    models: { id: string; label: string; roles: string[]; batch: boolean; inputPerMTokUsd: number; outputPerMTokUsd: number }[];
  };
  const list = values.search ? all.filter(m => matchesSearch(m, values.search!, m.id.split('/')[0] ?? '')) : all;
  if (values.json) {
    ctx.print(`${JSON.stringify(list)}\n`);
    return 0;
  }
  const width = (pick: (m: (typeof list)[number]) => string) => Math.max(0, ...list.map(m => pick(m).length));
  const usd = (n: number) => `$${n > 0 && n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;
  const price = (m: (typeof list)[number]) => `${usd(m.inputPerMTokUsd)} / ${usd(m.outputPerMTokUsd)} per 1M tokens`;
  const [idWidth, labelWidth, priceWidth, rolesWidth] = [width(m => m.id), width(m => m.label), width(price), width(m => m.roles.join(', '))];
  for (const m of list) {
    const row = [m.id.padEnd(idWidth), m.label.padEnd(labelWidth), price(m).padEnd(priceWidth), m.roles.join(', ').padEnd(rolesWidth), m.batch ? 'batch' : ''];
    ctx.print(`${row.join('  ').trimEnd()}\n`);
  }
  return 0;
}

/** How often `speak` shows the Turn so far, at most. */
export const DRAFT_EVERY_MS = 300;

/**
 * Sends the Debate's awaited API Turn from stdin. The platform's edge hands a request body on only once it is
 * complete, so while reading the CLI shows Viewers the text so far as drafts (at most every DRAFT_EVERY_MS, one at a
 * time), then sends the whole Turn.
 */
async function speak(ctx: Context, positionals: string[], values: Values): Promise<number> {
  const [id] = positionals;
  if (!id || positionals.length > 1 || (values.slot !== undefined && !/^\d+$/.test(values.slot))) return usageError(ctx);
  const token = requireToken(ctx);
  let slot = values.slot === undefined ? null : Number(values.slot);
  if (slot === null) {
    const response = await viewerClient(ctx).api.debates[':id'].$get({ param: { id } });
    if (!response.ok) throw await failure(ctx, response);
    const view = (await response.json()) as PublicDebate;
    if (!view.awaiting) throw ctx.fail('This Debate is not waiting for an API Turn\n');
    slot = view.awaiting.slotIndex;
  }

  let text = '';
  let sentAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<unknown> | null = null;
  const reader = ctx.deps.stdin().getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (!inFlight && Date.now() - sentAt >= DRAFT_EVERY_MS && text.trim()) {
      sentAt = Date.now();
      // Best-effort: a lost draft only means Viewers wait for the next one, or for the Turn.
      inFlight = sendDraft(ctx.base, token, id, slot, text, ctx.deps.fetch)
        .catch(() => {})
        .finally(() => (inFlight = null));
    }
  }
  text += decoder.decode();
  // No draft may land after the Turn.
  await inFlight;

  const response = await submitTurn(ctx.base, token, id, slot, text, ctx.deps.fetch);
  if (response.status !== 201) throw await failure(ctx, response);
  const stored = (await response.json()) as { slotIndex: number; turn: { text: string } };
  const words = stored.turn.text.split(/\s+/).filter(Boolean).length;
  ctx.print(`Turn ${stored.slotIndex} stored (${words} ${words === 1 ? 'word' : 'words'})\n`);
  return 0;
}

async function whoami(ctx: Context, values: Values): Promise<number> {
  const response = await memberClient(ctx).api.me.$get();
  if (!response.ok) throw await failure(ctx, response);
  const me = (await response.json()) as { name: string; quotaRemaining: number };
  ctx.print(values.json ? `${JSON.stringify(me)}\n` : `Signed in as ${me.name}. ${me.quotaRemaining} Quota points left today.\n`);
  return 0;
}

function usageError(ctx: Context): number {
  ctx.deps.err(USAGE);
  return 2;
}

export async function run(argv: string[], deps: CliDeps): Promise<number> {
  const base = (deps.env.DEBATE_ARENA_URL?.trim() || DEFAULT_BASE).replace(/\/+$/, '');
  const token = deps.env.DEBATE_ARENA_TOKEN?.trim() || undefined;
  const safe = safeOutput(deps, token);
  const ctx: Context = {
    deps: { ...deps, ...safe },
    base,
    token,
    print: safe.out,
    fail: text => {
      safe.err(text);
      return new Exit(1);
    },
  };

  let parsed: { values: Values; positionals: string[] };
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch {
    return usageError(ctx);
  }
  const [command, ...positionals] = parsed.positionals;
  const { values } = parsed;
  if (!command || command === 'help' || values.help) {
    deps.out(USAGE);
    return 0;
  }

  try {
    switch (command) {
      case 'start':
        return await start(ctx, positionals, values);
      case 'show':
        return await show(ctx, positionals, values);
      case 'speak':
        return await speak(ctx, positionals, values);
      case 'models':
        return await models(ctx, values);
      case 'whoami':
        return await whoami(ctx, values);
      default:
        return usageError(ctx);
    }
  } catch (error) {
    if (error instanceof Exit) return error.code;
    const reason = error instanceof Error ? error.message : String(error);
    return ctx.fail(`Could not reach ${base}: ${reason}\n`).code;
  }
}
