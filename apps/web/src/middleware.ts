import { env } from 'cloudflare:workers';
import { defineMiddleware } from 'astro:middleware';
import { getMe, serverApi } from './lib/server-api';

/** Every page talks to the API as the Viewer, and knows whether a Member is signed in (for the header). */
export const onRequest = defineMiddleware(async (context, next) => {
  const api = serverApi(context.request, env.API);
  context.locals.api = api;
  context.locals.me = await getMe(api);
  return next();
});
