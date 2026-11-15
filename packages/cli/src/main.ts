#!/usr/bin/env node
// Entry point: Node 24 runs this TypeScript directly (type stripping), so there is no build step.
import { Readable } from 'node:stream';
import { run } from './run.ts';

// A reader that stops early (`debate start … | head`) closes the pipe: stop quietly, as Unix tools do.
process.stdout.on('error', error => {
  if ((error as NodeJS.ErrnoException).code === 'EPIPE') process.exit(0);
  throw error;
});

const code = await run(process.argv.slice(2), {
  env: process.env,
  fetch: globalThis.fetch,
  WebSocketImpl: globalThis.WebSocket,
  out: text => process.stdout.write(text),
  err: text => process.stderr.write(text),
  isTTY: process.stdout.isTTY === true,
  stdin: Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
});
process.exitCode = code;
