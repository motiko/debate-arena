// Serves the built web app (astro preview, port 4321) in front of the API dev server (port 8787, fake models,
// DEV_AUTH on), for end-to-end and Lighthouse runs. Prints "ready" once /api answers through the web origin;
// stops both on exit. Run `astro build` first.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const webDir = fileURLToPath(new URL('..', import.meta.url));
const registry = fileURLToPath(new URL('../../../.wrangler/dev-registry', import.meta.url));
const env = { ...process.env, CLOUDFLARE_DEV_REGISTRY_PATH: registry, WRANGLER_REGISTRY_PATH: registry };

// Each server runs in its own process group so it can be stopped with all its children. Output is piped
// through this process (not inherited), so whoever started us is not kept waiting on the servers' output.
const serve = args => {
  const child = spawn('pnpm', args, { cwd: webDir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  return child;
};
const children = [
  // The web reaches the API through the dev registry, so its port only has to be free.
  serve(['--filter', '@debate-arena/api', 'dev', '--port', '8799']),
  // --ignore-lock keeps Astro in the foreground even when it detects an AI agent.
  serve(['exec', 'astro', 'preview', '--port', '4321', '--ignore-lock']),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => stop(0));
for (const child of children) child.on('exit', code => stopping || (console.error(`server exited (${code})`), stop(1)));

const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
  try {
    const response = await fetch('http://localhost:4321/api/health');
    if (response.ok) {
      console.log('serve.mjs: servers ready');
      break;
    }
  } catch {
    // Not up yet.
  }
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (Date.now() >= deadline) {
  console.error('servers did not become ready in 120 s');
  stop(1);
}
// Stay alive until signalled.
setInterval(() => {}, 1 << 30);
