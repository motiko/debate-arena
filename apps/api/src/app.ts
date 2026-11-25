import { isSelfJudging, labelMotion, type Stance } from '@debate-arena/engine';
import { Hono } from 'hono';
import { exportMember } from './account/account';
import { getAuth } from './auth/auth';
import { memberResolver } from './auth/member';
import {
  addReport,
  getBlockDecision,
  hasReportsSince,
  memberReportsSince,
  moderationQueue,
  recordDecision,
  unlistForReports,
  type BlockGround,
  type ModerationDecision,
} from './db/moderation';
import { isModerator, parseDecision } from './moderation/moderators';
import { endedBatchId, verifySignature } from './webhooks/openrouter';
import { createEmailSender, type EmailEnv } from './notices/email';
import { noticeDecision, noticeReportReceived, type NoticeDeps } from './notices/notify';
import { keyedHash, parseReport, rateLimitNetwork, REPORT_UNLIST_THRESHOLD, REPORTS_PER_IP_PER_HOUR } from './moderation/reports';
import { DAILY_QUOTA_POINTS, quotaRemaining } from './db/quota';
import { hasUnlimitedQuota } from './auth/allowlists';
import { addCost, awaitingOf, getDebate, listCompletedDebates, saveLabels, unlabelledDebates, type DebateRecord, type LabelCursor } from './db/debates';
import { parseFeedQuery, popularTags, searchDebates } from './db/feed';
import { relayDraft, screenApiTurn, submitApiTurn } from './debates/api-turn';
import { notifyViewers } from './debates/consumer';
import { meteredClient } from './models/factory';
import { castAfter, castBefore, getVote, listVotes, type AudienceVote } from './db/votes';
import { audienceResult, checkVote, votingClosesAt, type VotePhase } from './votes/rules';
import { voterKey } from './votes/voter-key';
import { planDebate, startDebate } from './debates/start';
import { isBatchCapable, labellerFor, priceTable, screenerFor } from './models/catalog';
import { loadModels } from './models/live-catalog';

const FEED_PAGE_SIZE = 20;
/** How many Tags the feed offers to browse by. */
const POPULAR_TAGS = 50;
/** How many older Debates one backfill request labels. */
const LABELS_PER_REQUEST = 10;

/** What Viewers may see of a Debate: no Member id, Budget or cost. */
function publicView(d: DebateRecord) {
  return {
    id: d.id,
    kind: d.kind,
    status: d.status,
    motion: d.setup.motion.text,
    format: { id: d.setup.format.id, name: d.setup.format.name, phases: d.setup.format.phases, rubric: d.setup.format.rubric },
    debaters: d.setup.debaters,
    panel: d.setup.panel,
    selfJudging: d.selfJudging,
    aiVoters: d.aiVoters,
    // Disclosed like Self-Judging: an AI Voter that is the same model as a Debater (GLOSSARY: AI Voter).
    aiVotersShareDebaterModel: isSelfJudging(d.aiVoters, [d.setup.debaters.for, d.setup.debaters.against]),
    turns: d.turns,
    // The API slot the Debate waits for, and until when (null when it is not waiting).
    awaiting: awaitingOf(d),
    // Verdicts stored before the Judge gave Rubric Scores have none to list.
    verdict: d.verdict && { ...d.verdict, scores: d.verdict.scores ?? [] },
    // Results stored before AI Voters' votes were kept have none to list.
    aiAudience: d.aiAudience && { ...d.aiAudience, votes: d.aiAudience.votes ?? [] },
    createdAt: d.createdAt,
    completedAt: d.completedAt,
    // AI-assigned (GLOSSARY: Category, Tag).
    category: d.category,
    tags: d.tags,
  };
}

/**
 * A Debate as one Viewer sees it: with the Audience Result, their own vote, and its Turns hidden from a
 * signed-in Member who could still cast a before-vote but has not (signed-out Viewers can read freely; once
 * voting is closed or the Debate failed, everyone can).
 */
function debateView(d: DebateRecord, votes: AudienceVote[], memberId: string | null, now: Date) {
  const myVote = memberId ? (votes.find(v => v.memberId === memberId) ?? null) : null;
  const turnsHidden = memberId !== null && myVote === null && checkVote(d, null, 'before', now).ok;
  // A Batch Debate that is not complete (only its starter sees it) shows no Turns: it is published only when complete.
  const unpublished = d.kind === 'batch' && d.status !== 'complete';
  return {
    ...publicView(d),
    turns: turnsHidden || unpublished ? [] : d.turns,
    turnsHidden,
    myVote: myVote && { before: myVote.before, after: myVote.after },
    audienceResult: audienceResult(d, votes),
    // Never 'blocked' here: a Blocked Debate is answered with its statement of reasons instead.
    visibility: d.visibility as 'listed' | 'unlisted',
    // The starting Member is told when their Debate is Unlisted pending review.
    mine: memberId !== null && memberId === d.memberId,
  };
}

export type PublicDebate = ReturnType<typeof debateView>;

/** All a Viewer learns of a Blocked Debate: the statement of reasons (DSA Art. 17), never its content. */
export interface BlockedDebate {
  id: string;
  blocked: { decidedAt: string; ground: BlockGround; groundRef: string; explanation: string };
}

const BLOCKED = 'This Debate was blocked by a Moderator';

async function blockedDebate(db: D1Database, id: string): Promise<BlockedDebate> {
  const decision = await getBlockDecision(db, id);
  return {
    id,
    blocked: {
      decidedAt: decision?.decidedAt ?? '',
      ground: decision?.ground ?? 'terms',
      groundRef: decision?.groundRef ?? '',
      explanation: decision?.explanation ?? '',
    },
  };
}
/** A feed entry: no Turns, but when Audience voting closes (the web keeps the outcome hidden until then). */
export type DebateSummary = Omit<ReturnType<typeof publicView>, 'turns'> & { votingClosesAt: string | null };

function summary(d: DebateRecord): DebateSummary {
  const { turns: _turns, ...rest } = publicView(d);
  return { ...rest, votingClosesAt: votingClosesAt(d) };
}

// State-changing routes accept only JSON: a cross-site form or no-cors fetch cannot send it without a CORS
// preflight, so cookie-authenticated votes and Debates cannot be forged from another site.
const NOT_JSON = 'Send JSON with Content-Type: application/json';
const isJson = (contentType: string | undefined) => contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json';

const PHASES = ['before', 'after'] as const;
const STANCES = ['for', 'against', 'undecided'] as const;

/** A backfill request's cursor: null to start from the oldest, undefined when the body is not one. */
function parseLabelCursor(input: unknown): LabelCursor | null | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const { after } = input as Record<string, unknown>;
  if (after === undefined) return null;
  if (typeof after !== 'string') return undefined;
  const bar = after.indexOf('|');
  return bar > 0 ? { completedAt: after.slice(0, bar), id: after.slice(bar + 1) } : undefined;
}

function parseVote(input: unknown): { phase: VotePhase; stance: Stance } | null {
  if (typeof input !== 'object' || input === null) return null;
  const { phase, stance } = input as Record<string, unknown>;
  const p = PHASES.find(x => x === phase);
  const s = STANCES.find(x => x === stance);
  return p && s ? { phase: p, stance: s } : null;
}

/**
 * Sends DSA notices after the response, best-effort: a missing or failing email provider never fails the request.
 */
function afterResponse(c: { env: Env; executionCtx: { waitUntil(promise: Promise<unknown>): void } }, notice: (deps: NoticeDeps) => Promise<void>): void {
  const run = async () => {
    try {
      const env = c.env as Env & EmailEnv;
      await notice({ db: env.DB, sender: createEmailSender(env), siteUrl: env.BETTER_AUTH_URL, contact: env.EMAIL_FROM });
    } catch (error) {
      console.error('Could not send notices', error);
    }
  };
  c.executionCtx.waitUntil(run());
}

/** Quota points left today; a Member with unlimited Quota always has the full day's points. */
async function memberQuotaRemaining(env: Env, memberId: string): Promise<number> {
  if (await hasUnlimitedQuota(env, memberId)) return DAILY_QUOTA_POINTS;
  return quotaRemaining(env.DB, memberId, new Date());
}

/** The signed-in Moderator, or why the request is refused (401 signed out, 403 not a Moderator). */
async function requireModerator(env: Env, request: Request): Promise<{ memberId: string } | { status: 401 | 403; error: string }> {
  const memberId = await memberResolver(env)(request);
  if (!memberId) return { status: 401, error: 'Sign in to moderate' };
  if (!(await isModerator(env, memberId))) return { status: 403, error: 'Only Moderators can do this' };
  return { memberId };
}

const TEXT_ONLY = 'Send the Turn as text with Content-Type: text/plain';
const isText = (contentType: string | undefined) => contentType?.split(';')[0]?.trim().toLowerCase() === 'text/plain';

/**
 * The Debate and slot an API Turn (or its draft) is for, checked: text body, an API token of the Member who started
 * the Debate (never a session cookie: a cross-site form can send text/plain), an existing Debate that is not Blocked.
 */
async function apiTurnTarget(
  env: Env,
  request: Request,
  id: string,
  slotParam: string,
): Promise<{ debate: DebateRecord; slot: number } | { status: 400 | 401 | 403 | 404 | 410 | 415; error: string }> {
  if (!isText(request.headers.get('content-type') ?? undefined)) return { status: 415, error: TEXT_ONLY };
  const memberId = await memberResolver(env, { tokensOnly: true })(request);
  if (!memberId) return { status: 401, error: 'Send your API token as Authorization: Bearer <token>' };
  if (!/^\d{1,3}$/.test(slotParam)) return { status: 400, error: 'The slot must be a Turn number' };
  const debate = await getDebate(env.DB, id);
  if (!debate) return { status: 404, error: 'Debate not found' };
  if (debate.visibility === 'blocked') return { status: 410, error: BLOCKED };
  if (debate.memberId !== memberId) return { status: 403, error: 'Only the Member who started this Debate submits its API Turns' };
  return { debate, slot: Number(slotParam) };
}

export const app = new Hono<{ Bindings: Env }>()
  .basePath('/api')
  .get('/health', c => c.json({ ok: true }))
  .on(['GET', 'POST'], '/auth/*', c => getAuth(c.env).handler(c.req.raw))
  .get('/me', async c => {
    // returnHeaders: once a session is past its update age, Better Auth extends it and sets a fresh cookie.
    // Passing that cookie on is what keeps active Members signed in (the web app reads the session only here).
    const { response: session, headers: authHeaders } = await getAuth(c.env).api.getSession({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    if (session) {
      for (const cookie of authHeaders.getSetCookie()) c.header('set-cookie', cookie, { append: true });
      const { id, name, image } = session.user;
      return c.json({
        id,
        name,
        image: image ?? null,
        quotaRemaining: await memberQuotaRemaining(c.env, id),
        isModerator: await isModerator(c.env, id),
      });
    }
    // An API token (the CLI), or locally (DEV_AUTH "true") a dev Member from `x-dev-member`, named by their id.
    const memberId = await memberResolver(c.env, { tokens: true })(c.req.raw);
    if (!memberId) return c.json({ error: 'Not signed in' }, 401);
    const user = await c.env.DB.prepare('SELECT name, image FROM "user" WHERE id = ?')
      .bind(memberId)
      .first<{ name: string; image: string | null }>();
    return c.json({
      id: memberId,
      name: user?.name ?? memberId,
      image: user?.image ?? null,
      quotaRemaining: await memberQuotaRemaining(c.env, memberId),
      isModerator: await isModerator(c.env, memberId),
    });
  })
  .get('/me/export', async c => {
    const session = await getAuth(c.env).api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Not signed in' }, 401);
    const data = await exportMember(c.env.DB, session.user.id);
    if (!data) return c.json({ error: 'Not signed in' }, 401);
    return c.json(data);
  })
  .get('/models', async c => {
    const { catalog } = await loadModels(c.env);
    return c.json({
      models: catalog.entries.map(e => ({
        id: e.id,
        label: e.label,
        roles: e.roles,
        // Hand-picked: the short list the feed offers to filter by.
        curated: e.curated === true,
        // Batch-capable: may take part in a Slow Debate.
        batch: isBatchCapable(catalog, e.id),
        inputPerMTokUsd: e.price.inputPerMTokUsd,
        outputPerMTokUsd: e.price.outputPerMTokUsd,
        contextLength: e.contextLength ?? null,
      })),
    });
  })
  .post('/debates', async c => {
    if (!isJson(c.req.header('content-type'))) return c.json({ error: NOT_JSON }, 415);
    const memberId = await memberResolver(c.env, { tokens: true })(c.req.raw);
    if (!memberId) return c.json({ error: 'Sign in to start a Debate' }, 401);
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'Request body must be JSON' }, 400);
    }
    const { catalog } = await loadModels(c.env);
    const result = await startDebate(
      {
        db: c.env.DB,
        catalog,
        enqueue: async job => {
          await c.env.STEP_QUEUE.send(job);
        },
        now: () => new Date(),
        newId: () => crypto.randomUUID(),
        unlimitedQuota: await hasUnlimitedQuota(c.env, memberId),
      },
      memberId,
      input,
    );
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ id: result.id, panel: result.panel, selfJudging: result.selfJudging }, 201);
  })
  .post('/debates/quote', async c => {
    if (!isJson(c.req.header('content-type'))) return c.json({ error: NOT_JSON }, 415);
    const memberId = await memberResolver(c.env, { tokens: true })(c.req.raw);
    if (!memberId) return c.json({ error: 'Sign in to start a Debate' }, 401);
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'Request body must be JSON' }, 400);
    }
    const { catalog } = await loadModels(c.env);
    const plan = planDebate({ catalog, unlimitedQuota: await hasUnlimitedQuota(c.env, memberId) }, input);
    if (!plan.ok) return c.json({ error: plan.error }, plan.status);
    return c.json({
      budgetMicroUsd: plan.budgetMicroUsd,
      quotaPoints: plan.quotaPoints,
      quotaRemaining: await memberQuotaRemaining(c.env, memberId),
      slowAvailable: plan.slowAvailable,
      panel: plan.setup.panel,
      selfJudging: plan.selfJudging,
      aiVotersMicroUsd: plan.aiVotersMicroUsd,
    });
  })
  .post('/debates/:id/turns/:slot', async c => {
    const found = await apiTurnTarget(c.env, c.req.raw, c.req.param('id'), c.req.param('slot'));
    if ('error' in found) return c.json({ error: found.error }, found.status);
    const { debate, slot } = found;
    const result = await submitApiTurn(
      { db: c.env.DB, notify: (id, event) => notifyViewers(c.env, id, event), enqueue: async job => void (await c.env.STEP_QUEUE.send(job)) },
      debate,
      slot,
      c.req.raw.body,
    );
    if (result.status !== 201) return c.json({ error: result.error }, result.status);
    // Screened after the answer, charged to the Debate's Budget at its frozen prices; a screen that fails Flags.
    c.executionCtx.waitUntil(
      screenApiTurn(
        async () => {
          const { client, catalog } = await loadModels(c.env);
          const frozen = Object.fromEntries(Object.entries(debate.models ?? {}).map(([id, m]) => [id, m.price]));
          const metered = meteredClient(client, { ...priceTable(catalog), ...frozen }, cost => addCost(c.env.DB, debate.id, cost));
          return { client: metered, screener: screenerFor(catalog) };
        },
        c.env.DB,
        debate.id,
        result.turn.text,
      ),
    );
    return c.json({ slotIndex: result.slotIndex, turn: result.turn }, 201);
  })
  .put('/debates/:id/turns/:slot/draft', async c => {
    const found = await apiTurnTarget(c.env, c.req.raw, c.req.param('id'), c.req.param('slot'));
    if ('error' in found) return c.json({ error: found.error }, found.status);
    const result = await relayDraft({ notify: (id, event) => notifyViewers(c.env, id, event) }, found.debate, found.slot, c.req.raw.body);
    if (result.status !== 204) return c.json({ error: result.error }, result.status);
    return c.body(null, 204);
  })
  .get('/debates', async c => {
    const before = c.req.query('before');
    // The date cursor of the first feed, kept for links and clients that page by it.
    if (before) {
      const debates = await listCompletedDebates(c.env.DB, FEED_PAGE_SIZE, before);
      return c.json({ debates: debates.map(summary), query: { page: 1 }, page: 1, pageCount: 1, total: debates.length });
    }
    const query = parseFeedQuery(c.req.query(), c.req.queries('tag'));
    const { debates, total } = await searchDebates(c.env.DB, query, FEED_PAGE_SIZE);
    // `query` is what was applied (anything unusable dropped), for showing the filters in force.
    return c.json({ debates: debates.map(summary), query, page: query.page, pageCount: Math.max(1, Math.ceil(total / FEED_PAGE_SIZE)), total });
  })
  .get('/tags', async c => c.json({ tags: await popularTags(c.env.DB, POPULAR_TAGS) }))
  .get('/debates/:id', async c => {
    const debate = await getDebate(c.env.DB, c.req.param('id'));
    if (!debate) return c.json({ error: 'Debate not found' }, 404);
    if (debate.visibility === 'blocked') return c.json(await blockedDebate(c.env.DB, debate.id), 410);
    const memberId = await memberResolver(c.env)(c.req.raw);
    // A Batch Debate is published only when complete; until then (or if it failed) only its starting Member sees it.
    if (debate.kind === 'batch' && debate.status !== 'complete' && memberId !== debate.memberId) {
      return c.json({ error: 'Debate not found' }, 404);
    }
    return c.json(debateView(debate, await listVotes(c.env.DB, debate.id), memberId, new Date()));
  })
  .post('/debates/:id/votes', async c => {
    if (!isJson(c.req.header('content-type'))) return c.json({ error: NOT_JSON }, 415);
    const memberId = await memberResolver(c.env)(c.req.raw);
    if (!memberId) return c.json({ error: 'Sign in to vote' }, 401);
    let parsed: ReturnType<typeof parseVote>;
    try {
      parsed = parseVote(await c.req.json());
    } catch {
      parsed = null;
    }
    if (!parsed) {
      return c.json({ error: 'Send { "phase": "before" | "after", "stance": "for" | "against" | "undecided" }' }, 400);
    }
    const debate = await getDebate(c.env.DB, c.req.param('id'));
    if (!debate) return c.json({ error: 'Debate not found' }, 404);
    if (debate.visibility === 'blocked') return c.json({ error: BLOCKED }, 410);

    const now = new Date();
    const check = checkVote(debate, await getVote(c.env.DB, debate.id, memberId), parsed.phase, now);
    if (!check.ok) return c.json({ error: check.error }, check.status);

    const at = now.toISOString();
    const written =
      parsed.phase === 'before'
        ? await castBefore(c.env.DB, debate.id, memberId, parsed.stance, at, await voterKey(c.env, memberId, debate.id))
        : await castAfter(c.env.DB, debate.id, memberId, parsed.stance, at);
    if (!written) {
      return c.json({ error: `You already voted ${parsed.phase} this Debate` }, 409);
    }
    const vote = (await getVote(c.env.DB, debate.id, memberId))!;
    return c.json({ vote: { before: vote.before, after: vote.after } }, 201);
  })
  .post('/debates/:id/reports', async c => {
    if (!isJson(c.req.header('content-type'))) return c.json({ error: NOT_JSON }, 415);
    let parsed: ReturnType<typeof parseReport>;
    try {
      parsed = parseReport(await c.req.json());
    } catch {
      parsed = 'Request body must be JSON';
    }
    if (typeof parsed === 'string') return c.json({ error: parsed }, 400);
    const debate = await getDebate(c.env.DB, c.req.param('id'));
    if (!debate) return c.json({ error: 'Debate not found' }, 404);
    if (debate.visibility === 'blocked') return c.json({ error: BLOCKED }, 410);

    const now = new Date();
    const ip = c.req.header('cf-connecting-ip');
    const ipHash = ip ? await keyedHash(c.env.BETTER_AUTH_SECRET, `report-ip:${rateLimitNetwork(ip)}`) : null;

    const memberId = await memberResolver(c.env)(c.req.raw);
    const outcome = await addReport(
      c.env.DB,
      {
      id: crypto.randomUUID(),
      debateId: debate.id,
      reporterMemberId: memberId,
      // A Member is known by their account; contact details are asked only from Viewers who are signed out.
      reporterName: memberId ? null : parsed.name,
      reporterEmail: memberId ? null : parsed.email,
      reason: parsed.reason,
      explanation: parsed.explanation,
      ipHash,
      createdAt: now.toISOString(),
      },
      REPORTS_PER_IP_PER_HOUR,
      new Date(now.getTime() - 3600_000).toISOString(),
    );
    if (outcome === 'duplicate') return c.json({ error: 'You already reported this Debate' }, 409);
    if (outcome === 'limited') return c.json({ error: 'Too many Reports from your network. Please try again later.' }, 429);
    if (memberId && (await memberReportsSince(c.env.DB, debate.id, debate.reviewedAt)) >= REPORT_UNLIST_THRESHOLD) {
      await unlistForReports(c.env.DB, debate.id);
    }
    // DSA Art. 16(4): confirm receipt to the reporter: at the email they gave, or a Member's account email.
    const givenEmail = memberId ? null : parsed.email;
    afterResponse(c, async deps => {
      const account = memberId
        ? await deps.db.prepare('SELECT email FROM "user" WHERE id = ?').bind(memberId).first<{ email: string }>()
        : null;
      const email = givenEmail ?? account?.email;
      if (email) await noticeReportReceived(deps, debate.id, email);
    });
    return c.json({ ok: true }, 201);
  })
  // Labels Debates screened before labelling existed (or whose labelling failed), a few per request so it stays
  // within one Worker invocation. Paid by the platform: these Debates' Budgets are settled.
  .post('/moderation/labels', async c => {
    if (!isJson(c.req.header('content-type'))) return c.json({ error: NOT_JSON }, 415);
    const denied = await requireModerator(c.env, c.req.raw);
    if ('status' in denied) return c.json({ error: denied.error }, denied.status);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = null;
    }
    const after = parseLabelCursor(body);
    if (after === undefined) return c.json({ error: 'Send {} or { "after": "<next from the last answer>" }' }, 400);
    const { debates, total } = await unlabelledDebates(c.env.DB, LABELS_PER_REQUEST, after ?? undefined);
    const { client, catalog } = await loadModels(c.env);
    const labeller = labellerFor(catalog);
    let labelled = 0;
    for (const debate of debates) {
      const labels = await labelMotion(debate.motion, labeller, client);
      if (!labels) continue;
      await saveLabels(c.env.DB, debate.id, labels);
      labelled += 1;
    }
    // The next round starts after the last Debate tried, labelled or not; `next` is null when none are left.
    const remaining = total - debates.length;
    const last = debates.at(-1);
    return c.json({ labelled, failed: debates.length - labelled, remaining, next: remaining > 0 && last ? `${last.completedAt}|${last.id}` : null });
  })
  .get('/moderation/queue', async c => {
    const denied = await requireModerator(c.env, c.req.raw);
    if ('status' in denied) return c.json({ error: denied.error }, denied.status);
    return c.json({ items: await moderationQueue(c.env.DB) });
  })
  .post('/moderation/debates/:id/decision', async c => {
    if (!isJson(c.req.header('content-type'))) return c.json({ error: NOT_JSON }, 415);
    const moderator = await requireModerator(c.env, c.req.raw);
    if ('status' in moderator) return c.json({ error: moderator.error }, moderator.status);
    let parsed: ReturnType<typeof parseDecision>;
    try {
      parsed = parseDecision(await c.req.json());
    } catch {
      parsed = 'Request body must be JSON';
    }
    if (typeof parsed === 'string') return c.json({ error: parsed }, 400);
    const debate = await getDebate(c.env.DB, c.req.param('id'));
    if (!debate) return c.json({ error: 'Debate not found' }, 404);
    // What brought it to review since the last decision: the AI Flag counts only until a Moderator first reviewed it.
    const source =
      debate.flagged && debate.reviewedAt === null
        ? 'ai_flag'
        : (await hasReportsSince(c.env.DB, debate.id, debate.reviewedAt))
          ? 'reports'
          : 'moderator';
    const decision = {
      id: crypto.randomUUID(),
      debateId: debate.id,
      action: parsed.action,
      source,
      // The AI screen only detects; the decision is always a Moderator's.
      automatedDetection: source === 'ai_flag',
      ground: parsed.action === 'block' ? parsed.ground : null,
      groundRef: parsed.action === 'block' ? parsed.groundRef : null,
      explanation: parsed.explanation,
      moderatorId: moderator.memberId,
      decidedAt: new Date().toISOString(),
    } satisfies ModerationDecision;
    const applied = await recordDecision(c.env.DB, decision);
    if (!applied) return c.json({ error: 'This Debate is already blocked' }, 409);
    afterResponse(c, deps => noticeDecision(deps, debate, decision, debate.reviewedAt));
    if (parsed.action === 'block') {
      // Viewers already watching must stop seeing it. Best-effort: new requests are refused with 410 anyway.
      try {
        await c.env.DEBATE_ROOM.getByName(debate.id).closeForBlock();
      } catch (error) {
        console.warn(`Could not close live Viewers of Blocked Debate ${debate.id}`, error);
      }
    }
    return c.json({ visibility: parsed.action === 'block' ? 'blocked' : 'listed' }, 201);
  })
  .post('/webhooks/openrouter', async c => {
    // Off unless the workspace's signing secret is set: then a forged call cannot even tell the route exists.
    const secret = c.env.OPENROUTER_WEBHOOK_SECRET;
    if (!secret) return c.json({ error: 'Not found' }, 404);
    const rawBody = await c.req.text();
    const signature = c.req.header('x-openrouter-signature') ?? '';
    if (!(await verifySignature(secret, signature, rawBody, Math.floor(Date.now() / 1000)))) {
      return c.json({ error: 'Invalid signature' }, 401);
    }
    const batchId = endedBatchId(rawBody);
    if (batchId) {
      const call = await c.env.DB.prepare('SELECT debate_id FROM batch_calls WHERE batch_id = ? LIMIT 1').bind(batchId).first<{ debate_id: string }>();
      // The Debate's step runs now and reads the batch's result; its pending poll later finds nothing to do.
      if (call) await c.env.STEP_QUEUE.send({ debateId: call.debate_id });
    }
    return c.json({ ok: true });
  })
  .get('/debates/:id/live', async c => {
    const id = c.req.param('id');
    const debate = await getDebate(c.env.DB, id);
    // Batch Debates have no live stream.
    if (!debate || debate.kind === 'batch') return c.json({ error: 'Debate not found' }, 404);
    if (debate.visibility === 'blocked') return c.json({ error: BLOCKED }, 410);
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return c.json({ error: 'Expected a WebSocket upgrade' }, 426);
    return c.env.DEBATE_ROOM.getByName(id).fetch(c.req.raw);
  });

export type AppType = typeof app;
