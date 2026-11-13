// Lighthouse gate: serves the built app (scripts/serve.mjs), seeds a finished Debate, and runs Lighthouse CI on
// the key pages: home, a Debate page and the start page. Exits with Lighthouse CI's status.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const webDir = fileURLToPath(new URL('..', import.meta.url));
const base = 'http://localhost:4321';

function run(command, args) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: webDir, stdio: 'inherit' });
    child.on('exit', code => resolve(code ?? 1));
  });
}

const server = spawn('node', ['scripts/serve.mjs'], { cwd: webDir, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  server.stdout.on('data', chunk => {
    process.stdout.write(chunk);
    if (String(chunk).includes('serve.mjs: servers ready')) resolve();
  });
  server.on('exit', code => reject(new Error(`server exited (${code})`)));
});

let code = 1;
try {
  const started = await fetch(`${base}/api/debates`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-member': `lhci-${Date.now()}` },
    body: JSON.stringify({ motion: 'This house believes remote work beats office work', debaters: { for: 'fake-a/one', against: 'fake-b/one' }, aiVoters: true }),
  });
  if (started.status !== 201) throw new Error(`seeding failed: ${started.status} ${await started.text()}`);
  const { id } = await started.json();
  for (let i = 0; i < 60; i++) {
    const { status } = await (await fetch(`${base}/api/debates/${id}`)).json();
    if (status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const urls = [`${base}/`, `${base}/debates/${id}`, `${base}/new`].flatMap(url => [`--url=${url}`]);
  code = await run('pnpm', ['exec', 'lhci', 'collect', ...urls]);
  if (code === 0) code = await run('pnpm', ['exec', 'lhci', 'assert']);
  await run('pnpm', ['exec', 'lhci', 'upload']);
} finally {
  server.kill('SIGTERM');
}
process.exit(code);
