// Isolated per-PR previews (ADR 0006): each PR gets its own API and web Workers, its own EU D1 database and its own
// queues, running fake models with dev sign-in on throwaway data, and all of it is deleted when the PR closes.
//
//   node scripts/preview.mjs up <pr>     create or update the preview; prints its URL
//   node scripts/preview.mjs down <pr>   delete it (safe to repeat)
//
// Needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and WORKERS_SUBDOMAIN (the account's *.workers.dev subdomain).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const apiDir = `${root}apps/api`;
const webDir = `${root}apps/web`;

/** wrangler.jsonc allows comments; ours sit on their own lines. */
export function parseJsonc(text) {
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
}

export function previewNames(pr) {
  return {
    api: `debate-arena-api-pr-${pr}`,
    web: `debate-arena-web-pr-${pr}`,
    db: `debate-arena-pr-${pr}`,
    queue: `debate-steps-pr-${pr}`,
    dlq: `debate-steps-pr-${pr}-dlq`,
  };
}

export function previewUrl(pr, subdomain) {
  return `https://${previewNames(pr).web}.${subdomain}.workers.dev`;
}

/** The API's preview config: the base config (no environments) with the PR's own resources and fake models. */
export function apiPreviewConfig(base, pr, databaseId, webUrl) {
  const names = previewNames(pr);
  const { env: _env, ...config } = base;
  const [db] = base.d1_databases;
  const [consumer] = base.queues.consumers;
  return {
    ...config,
    name: names.api,
    d1_databases: [{ binding: db.binding, database_name: names.db, database_id: databaseId, migrations_dir: db.migrations_dir }],
    queues: {
      producers: base.queues.producers.map(p => ({ ...p, queue: names.queue })),
      consumers: [{ ...consumer, queue: names.queue, dead_letter_queue: names.dlq }],
    },
    // Throwaway data and fake models: dev sign-in lets reviewers act as any Member without GitHub.
    vars: { ...base.vars, MODEL_PROVIDER: 'fake', DEV_AUTH: 'true', BETTER_AUTH_URL: webUrl, EMAIL_PROVIDER: 'none', EMAIL_FROM: '' },
  };
}

/** The web's built config (dist/server/wrangler.json), renamed and pointed at the PR's API Worker. */
export function webPreviewConfig(built, pr) {
  const names = previewNames(pr);
  return { ...built, name: names.web, services: (built.services ?? []).map(s => (s.binding === 'API' ? { ...s, service: names.api } : s)) };
}

/** Runs wrangler (or another command) and returns its exit code and output; never throws on a non-zero exit. */
function runner(cwd) {
  return (args, { command = 'pnpm', prefix = ['exec', 'wrangler'], env = {} } = {}) =>
    new Promise(resolve => {
      const child = spawn(command, [...prefix, ...args], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => {
        stdout += chunk;
        process.stdout.write(chunk);
      });
      child.stderr.on('data', chunk => {
        stderr += chunk;
        process.stderr.write(chunk);
      });
      child.on('exit', code => resolve({ code: code ?? 1, stdout, stderr }));
    });
}

async function must(run, args, options) {
  const result = await run(args, options);
  if (result.code !== 0) throw new Error(`${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  return result;
}

const NOT_FOUND = /not found|does not exist|could not find|10007|7404|10090/i;
const EXISTS = /already exists|already taken|11009/i;

export async function up(pr, run = runner(apiDir), runWeb = runner(webDir), subdomain = process.env.WORKERS_SUBDOMAIN) {
  if (!subdomain) throw new Error('Set WORKERS_SUBDOMAIN to the account’s workers.dev subdomain');
  const names = previewNames(pr);
  const url = previewUrl(pr, subdomain);

  const findDb = async () => {
    const { stdout } = await must(run, ['d1', 'list', '--json']);
    return JSON.parse(stdout.slice(stdout.indexOf('['))).find(d => d.name === names.db);
  };
  let db = await findDb();
  if (!db) {
    await must(run, ['d1', 'create', names.db, '--jurisdiction=eu']);
    db = await findDb();
  }
  for (const queue of [names.queue, names.dlq]) {
    const created = await run(['queues', 'create', queue]);
    if (created.code !== 0 && !EXISTS.test(created.stderr + created.stdout)) throw new Error(`queues create ${queue} failed:\n${created.stderr}`);
  }

  const base = parseJsonc(readFileSync(`${apiDir}/wrangler.jsonc`, 'utf8'));
  writeFileSync(`${apiDir}/wrangler.preview.json`, JSON.stringify(apiPreviewConfig(base, pr, db.uuid, url), null, 2));
  await must(run, ['d1', 'migrations', 'apply', 'DB', '--remote', '-c', 'wrangler.preview.json']);
  await must(run, ['deploy', '-c', 'wrangler.preview.json']);

  // The web build writes dist/server/wrangler.json, which `wrangler deploy` uses; patch it for this PR.
  await must(runWeb, ['build'], { prefix: ['run'] });
  const builtPath = `${webDir}/dist/server/wrangler.json`;
  writeFileSync(builtPath, JSON.stringify(webPreviewConfig(JSON.parse(readFileSync(builtPath, 'utf8')), pr)));
  await must(runWeb, ['deploy']);
  console.log(`PREVIEW_URL=${url}`);
  return url;
}

/** Deletes the preview: Workers first (the API consumes the queue), then the queues, then the database. */
export async function down(pr, run = runner(apiDir)) {
  const names = previewNames(pr);
  for (const args of [
    ['delete', '--name', names.web, '--force'],
    ['delete', '--name', names.api, '--force'],
    ['queues', 'delete', names.queue, '--force'],
    ['queues', 'delete', names.dlq, '--force'],
    ['d1', 'delete', names.db, '--skip-confirmation'],
  ]) {
    const result = await run(args);
    if (result.code !== 0 && !NOT_FOUND.test(result.stderr + result.stdout)) {
      throw new Error(`${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, pr] = process.argv.slice(2);
  if (!['up', 'down'].includes(command) || !/^\d+$/.test(pr ?? '')) {
    console.error('Usage: node scripts/preview.mjs up|down <pr number>');
    process.exit(2);
  }
  await (command === 'up' ? up(Number(pr)) : down(Number(pr)));
}
