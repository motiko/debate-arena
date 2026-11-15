import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

/** Runs the real entry point under Node, as `pnpm debate` does. */
function runMain(args: string[], options: { closeStdout?: boolean } = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(resolve => {
    const child = spawn(process.execPath, [MAIN, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    if (options.closeStdout) child.stdout.destroy();
    else child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('Node runs the entry point directly (type stripping)', async () => {
  const { code, stdout } = await runMain(['help']);
  expect(code).toBe(0);
  expect(stdout).toContain('Usage: debate');
});

test('a reader that stops early (| head) ends the CLI quietly', async () => {
  const { code, stderr } = await runMain(['help'], { closeStdout: true });
  expect(stderr).not.toContain('EPIPE');
  expect(code).toBe(0);
});
