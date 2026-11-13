import { isSelfJudging, type Stance } from '@debate-arena/engine';
import { Hono } from 'hono';
import { exportMember } from './account/account';
import { getAuth } from './auth/auth';
import { memberResolver } from './auth/member';
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
 * signed-in Member who has not cast a before-vote yet (signed-out Viewers can read freely).
 */
function debateView(d: DebateRecord, votes: AudienceVote[], memberId: string | null) {
  const myVote = memberId ? (votes.find(v => v.memberId === memberId) ?? null) : null;
  const turnsHidden = memberId !== null && myVote === null;
  return {
    ...publicView(d),
    turns: turnsHidden ? [] : d.turns,
    turnsHidden,
    myVote: myVote && { before: myVote.before, after: myVote.after },
    audienceResult: audienceResult(d, votes),
  };
}

export type PublicDebate = ReturnType<typeof debateView>;
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

export const app = new Hono<{ Bindings: Env }>()
  .basePath('/api')
  .get('/health', c => c.json({ ok: true }))
  .on(['GET', 'POST'], '/auth/*', c => getAuth(c.env).handler(c.req.raw))
  .get('/me', async c => {
    const session = await getAuth(c.env).api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Not signed in' }, 401);
    const { id, name, image } = session.user;
    return c.json({ id, name, image: image ?? null, quotaRemaining: await quotaRemaining(c.env.DB, id, new Date()) });
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
    return c.json({ models: catalog.entries.map(e => ({ id: e.id, label: e.label, roles: e.roles })) });
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
    const memberId = await memberResolver(c.env)(c.req.raw);
    return c.json(debateView(debate, await listVotes(c.env.DB, debate.id), memberId));
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
  .get('/debates/:id/live', async c => {
    const id = c.req.param('id');
    if (!(await getDebate(c.env.DB, id))) return c.json({ error: 'Debate not found' }, 404);
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return c.json({ error: 'Expected a WebSocket upgrade' }, 426);
    return c.env.DEBATE_ROOM.getByName(id).fetch(c.req.raw);
  });

export type AppType = typeof app;
