import { handle } from '@astrojs/cloudflare/handler';
import { routeRequest } from './route';

export default {
  fetch: (request, env, ctx) => routeRequest(request, env, r => handle(r, env, ctx)),
} satisfies ExportedHandler<Env>;
