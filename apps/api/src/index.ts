import { app } from './app';
import { consumer } from './debates/consumer';
import type { StepJob } from './debates/start';

export default { fetch: app.fetch, queue: consumer } satisfies ExportedHandler<Env, StepJob>;
