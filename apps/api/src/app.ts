import { Hono } from 'hono';

export const app = new Hono<{ Bindings: Env }>().get('/health', c => c.json({ ok: true }));

export type AppType = typeof app;
