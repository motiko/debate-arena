import { isSelfJudging, type Stance } from '@debate-arena/engine';
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
} from './db/moderation';
import { isModerator, parseDecision } from './moderation/moderators';
import { keyedHash, parseReport, rateLimitNetwork, REPORT_UNLIST_THRESHOLD, REPORTS_PER_IP_PER_HOUR } from './moderation/reports';
import { quotaRemaining } from './db/quota';
import { getDebate, listCompletedDebates, type DebateRecord } from './db/debates';
import { castAfter, castBefore, getVote, listVotes, type AudienceVote } from './db/votes';
import { audienceResult, checkVote, type VotePhase } from './votes/rules';
import { voterKey } from './votes/voter-key';
import { startDebate } from './debates/start';
import { createModels } from './models/factory';

const FEED_PAGE_SIZE = 20;

/** What Viewers may see of a Debate: no Member id, Budget or cost. */
function publicView(d: DebateRecord) {
  return {
    id: d.id,
    kind: d.kind,
    status: d.status,
    motion: d.setup.motion.text,
    format: { id: d.setup.format.id, name: d.setup.format.name, phases: d.setup.format.phases },
    debaters: d.setup.debaters,
    panel: d.setup.panel,
    selfJudging: d.selfJudging,
    aiVoters: d.aiVoters,
    // Disclosed like Self-Judging: an AI Voter that is the same model as a Debater (GLOSSARY: AI Voter).
    aiVotersShareDebaterModel: isSelfJudging(d.aiVoters, [d.setup.debaters.for, d.setup.debaters.against]),
    turns: d.turns,
    verdict: d.verdict,
    aiAudience: d.aiAudience,
    createdAt: d.createdAt,
    completedAt: d.completedAt,
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
export type DebateSummary = Omit<ReturnType<typeof publicView>, 'turns'>;

function summary(d: DebateRecord): DebateSummary {
  const { turns: _turns, ...rest } = publicView(d);
  return rest;
}

// State-changing routes accept only JSON: a cross-site form or no-cors fetch cannot send it without a CORS
// preflight, so cookie-authenticated votes and Debates cannot be forged from another site.
const NOT_JSON = 'Send JSON with Content-Type: application/json';
const isJson = (contentType: string | undefined) => contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json';

const PHASES = ['before', 'after'] as const;
const STANCES = ['for', 'against', 'undecided'] as const;

function parseVote(input: unknown): { phase: VotePhase; stance: Stance } | null {
  if (typeof input !== 'object' || input === null) return null;
  const { phase, stance } = input as Record<string, unknown>;
  const p = PHASES.find(x => x === phase);
  const s = STANCES.find(x => x === stance);
  return p && s ? { phase: p, stance: s } : null;
}

/** The signed-in Moderator, or why the request is refused (401 signed out, 403 not a Moderator). */
async function requireModerator(env: Env, request: Request): Promise<{ memberId: string } | { status: 401 | 403; error: string }> {
  const memberId = await memberResolver(env)(request);
  if (!memberId) return { status: 401, error: 'Sign in to moderate' };
  if (!(await isModerator(env, memberId))) return { status: 403, error: 'Only Moderators can do this' };
  return { memberId };
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
        quotaRemaining: await quotaRemaining(c.env.DB, id, new Date()),
        isModerator: await isModerator(c.env, id),
      });
    }
    // Local development only (DEV_AUTH "true"): a dev Member from `x-dev-member`, named by their id.
    const devMember = await memberResolver(c.env)(c.req.raw);
    if (!devMember) return c.json({ error: 'Not signed in' }, 401);
    return c.json({
      id: devMember,
      name: devMember,
      image: null,
      quotaRemaining: await quotaRemaining(c.env.DB, devMember, new Date()),
      isModerator: await isModerator(c.env, devMember),
    });
  })
  .get('/me/export', async c => {
    const session = await getAuth(c.env).api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Not signed in' }, 401);
    const data = await exportMember(c.env.DB, session.user.id);
    if (!data) return c.json({ error: 'Not signed in' }, 401);
    return c.json(data);
  })
  .get('/models', c => {
    const { catalog } = createModels(c.env);
    return c.json({ models: catalog.entries.map(e => ({ id: e.id, label: e.label, roles: e.roles, batch: e.batchPrice !== undefined })) });
  })
  .post('/debates', async c => {
    if (!isJson(c.req.header('content-type'))) return c.json({ error: NOT_JSON }, 415);
    const memberId = await memberResolver(c.env)(c.req.raw);
    if (!memberId) return c.json({ error: 'Sign in to start a Debate' }, 401);
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'Request body must be JSON' }, 400);
    }
    const { catalog } = createModels(c.env);
    const result = await startDebate(
      {
        db: c.env.DB,
        catalog,
        enqueue: async job => {
          await c.env.STEP_QUEUE.send(job);
        },
        now: () => new Date(),
        newId: () => crypto.randomUUID(),
      },
      memberId,
      input,
    );
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ id: result.id, panel: result.panel, selfJudging: result.selfJudging }, 201);
  })
  .get('/debates', async c => {
    const before = c.req.query('before');
    const debates = await listCompletedDebates(c.env.DB, FEED_PAGE_SIZE, before);
    return c.json({ debates: debates.map(summary) });
  })
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
    return c.json({ ok: true }, 201);
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
    const applied = await recordDecision(c.env.DB, {
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
    });
    if (!applied) return c.json({ error: 'This Debate is already blocked' }, 409);
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
