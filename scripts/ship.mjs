// Ships a small change: checks the committed work locally, then pushes it to main, which deploys production (ADR 0006).
// `pnpm ship` runs the checks and pushes; the pre-push hook (.githooks/pre-push, installed by `pnpm install`) runs the
// same checks for any other push to main, so a push to main is always a tested one. Big changes go through a pull
// request instead, where CI also runs Lighthouse.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAIN = 'refs/heads/main';
const DELETED = /^0+$/;

/** The commits a push sends to main, from the lines git gives the pre-push hook: "<local ref> <sha> <remote ref> <sha>". */
export function pushesToMain(stdin) {
  return stdin
    .split('\n')
    .map(line => line.trim().split(/\s+/))
    .filter(([, localSha, remoteRef]) => remoteRef === MAIN && localSha && !DELETED.test(localSha))
    .map(([, localSha]) => localSha);
}

/** The checks a push to main must pass: the same as CI's, but Lighthouse, which runs on pull requests and weekly. */
export const CHECKS = [
  ['pnpm', ['check']],
  ['pnpm', ['--filter', '@debate-arena/web', 'build']],
  ['pnpm', ['--filter', '@debate-arena/web', 'e2e']],
];

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function fail(message) {
  console.error(`ship: ${message}`);
  process.exit(1);
}

/** Runs the checks on the working tree, which must be exactly the commit being pushed. */
function check(sha) {
  if (git('status', '--porcelain', '--untracked-files=no') !== '') fail('commit or set aside your changes first: the checks must run on what is pushed.');
  if (git('rev-parse', 'HEAD') !== sha) fail(`check out ${sha.slice(0, 7)} to push it to main: the checks run on the working tree.`);
  for (const [command, args] of CHECKS) {
    console.log(`ship: ${command} ${args.join(' ')}`);
    if (spawnSync(command, args, { stdio: 'inherit' }).status !== 0) fail(`${command} ${args.join(' ')} failed; nothing was pushed.`);
  }
}

function ship() {
  git('fetch', '--quiet', 'origin', 'main');
  const sha = git('rev-parse', 'HEAD');
  if (spawnSync('git', ['merge-base', '--is-ancestor', 'origin/main', sha]).status !== 0) fail('rebase onto origin/main first: main only moves forward.');
  check(sha);
  // The hook sees this commit was just checked and lets it through.
  const pushed = spawnSync('git', ['push', 'origin', 'HEAD:main'], { stdio: 'inherit', env: { ...process.env, SHIP_VERIFIED: sha } });
  if (pushed.status !== 0) fail('the push failed.');
  console.log(`ship: ${sha.slice(0, 7)} is on main; production deploys in about a minute (Actions → Deploy production).`);
}

function hook() {
  for (const sha of pushesToMain(readFileSync(0, 'utf8'))) if (process.env.SHIP_VERIFIED !== sha) check(sha);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'hook') hook();
  else ship();
}
