import { Hono } from 'hono';
import { devMemberResolver } from './auth/member';
import { getDebate, listCompletedDebates, type DebateRecord } from './db/debates';
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
    aiVoters: d.aiVoters.length > 0,
    turns: d.turns,
    verdict: d.verdict,
    aiAudience: d.aiAudience,
    createdAt: d.createdAt,
    completedAt: d.completedAt,
  };
}

export type PublicDebate = ReturnType<typeof publicView>;
export type DebateSummary = Omit<PublicDebate, 'turns'>;

function summary(d: DebateRecord): DebateSummary {
  const { turns: _turns, ...rest } = publicView(d);
  return rest;
}

export const app = new Hono<{ Bindings: Env }>()
  .get('/health', c => c.json({ ok: true }))
  .get('/models', c => {
    const { catalog } = createModels(c.env);
    return c.json({ models: catalog.entries.map(e => ({ id: e.id, label: e.label, roles: e.roles })) });
  })
  .post('/debates', async c => {
    const memberId = await devMemberResolver(c.env)(c.req.raw);
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
    return c.json(publicView(debate));
  })
  .get('/debates/:id/live', async c => {
    const id = c.req.param('id');
    if (!(await getDebate(c.env.DB, id))) return c.json({ error: 'Debate not found' }, 404);
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return c.json({ error: 'Expected a WebSocket upgrade' }, 426);
    return c.env.DEBATE_ROOM.getByName(id).fetch(c.req.raw);
  });

export type AppType = typeof app;
