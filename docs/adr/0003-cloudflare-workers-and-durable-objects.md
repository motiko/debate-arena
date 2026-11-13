# Cloudflare Workers and Durable Objects as the platform runtime

The platform API and Debate engine run on Cloudflare Workers, with one Durable Object per live Debate holding its state and Viewer connections, and Cloudflare Queues and Cron for Turn jobs, OpenRouter batch polling and AI Voter fan-out. We chose it over Supabase and a self-managed server because it was far cheaper at every estimated scale (roughly $0 / $5–10 / $30–80 per month at small / medium / large, against $25 / $150–200 / ~$3k for Supabase) and has the most generous free plan with no project pausing; outgoing WebSocket messages are free, which suits pushing Turns and vote tallies to many Viewers.

## Consequences

- Lock-in is high: Durable Objects, Queues and Cron bindings have no drop-in equivalent elsewhere. To contain it, the Debate engine is plain TypeScript with no Cloudflare imports; Cloudflare-specific code lives only in a thin hosting layer.
- Durable Objects are billed for wall-clock time while awaiting, so LLM calls run in Workers or Queue consumers, never while a Durable Object waits.
- Data lives in D1 (SQLite), accessed only through our own repository layer with portable SQL, so a later move to Postgres is a migration rather than a rewrite.
- Authentication is not provided by the platform, so we self-host Better Auth in our Workers with Members stored in D1: no per-user fees and no extra vendor holding the user base, at the cost of keeping it patched ourselves.

## Considered Options

- **Supabase**: Postgres, Auth and Realtime included and low lock-in (open source, self-hostable), but realtime fan-out and per-user auth pricing grow to thousands of dollars per month at large scale.
- **Self-managed TypeScript server (e.g. Hetzner + Postgres)**: minimal lock-in and modest cost, but we would own security, patching, uptime and realtime scaling.
