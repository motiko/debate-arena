#!/usr/bin/env node
// Entry point: Node 24 runs this TypeScript directly (type stripping), so there is no build step.
import { run } from './run.ts';

const code = await run(process.argv.slice(2), {
  env: process.env,
  fetch: globalThis.fetch,
  WebSocketImpl: globalThis.WebSocket,
  out: text => process.stdout.write(text),
  err: text => process.stderr.write(text),
  isTTY: process.stdout.isTTY === true,
});
process.exitCode = code;
