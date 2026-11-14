import { env } from 'cloudflare:workers';
import { defineMiddleware } from 'astro:middleware';
import { loadViewer, serverApi } from './lib/server-api';

/** Every page talks to the API as the Viewer, and knows whether a Member is signed in (for the header). */
export const onRequest = defineMiddleware(async (context, next) => {
  const api = serverApi(context.request, env.API);
  const { me, setCookies } = await loadViewer(api);
  context.locals.api = api;
  context.locals.me = me;
  const response = await next();
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
  return response;
});
