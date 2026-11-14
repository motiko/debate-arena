import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiPreviewConfig, down, parseJsonc, previewNames, previewUrl, webPreviewConfig } from './preview.mjs';

const apiBase = parseJsonc(`{
  "name": "debate-arena-api",
  // a comment
  "main": "src/index.ts",
  "compatibility_date": "2026-11-13",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [{ "binding": "DB", "database_name": "debate-arena", "database_id": "local-debate-arena", "migrations_dir": "migrations" }],
  "queues": {
    "producers": [{ "binding": "STEP_QUEUE", "queue": "debate-steps" }],
    "consumers": [{ "queue": "debate-steps", "max_batch_size": 1, "max_batch_timeout": 0, "max_retries": 3, "dead_letter_queue": "debate-steps-dlq" }]
  },
  "durable_objects": { "bindings": [{ "name": "DEBATE_ROOM", "class_name": "DebateRoom" }] },
  "exports": { "DebateRoom": { "type": "durable-object", "storage": "sqlite" } },
  "vars": { "MODEL_PROVIDER": "fake", "DEV_AUTH": "false", "BETTER_AUTH_URL": "http://localhost:8787", "MODERATOR_GITHUB_IDS": "", "EMAIL_PROVIDER": "none", "EMAIL_FROM": "" },
  "env": { "production": { "vars": { "MODEL_PROVIDER": "openrouter" } } }
}`);

test('preview names follow the PR number', () => {
  assert.deepEqual(previewNames(42), {
    api: 'debate-arena-api-pr-42',
    web: 'debate-arena-web-pr-42',
    db: 'debate-arena-pr-42',
    queue: 'debate-steps-pr-42',
    dlq: 'debate-steps-pr-42-dlq',
  });
  assert.equal(previewUrl(42, 'acme'), 'https://debate-arena-web-pr-42.acme.workers.dev');
});

test('the API preview config has its own D1, queues and fake models', () => {
  const config = apiPreviewConfig(apiBase, 42, 'db-uuid-42', 'https://debate-arena-web-pr-42.acme.workers.dev');
  assert.equal(config.name, 'debate-arena-api-pr-42');
  assert.deepEqual(config.d1_databases, [{ binding: 'DB', database_name: 'debate-arena-pr-42', database_id: 'db-uuid-42', migrations_dir: 'migrations' }]);
  assert.deepEqual(config.queues.producers, [{ binding: 'STEP_QUEUE', queue: 'debate-steps-pr-42' }]);
  assert.equal(config.queues.consumers[0].queue, 'debate-steps-pr-42');
  assert.equal(config.queues.consumers[0].dead_letter_queue, 'debate-steps-pr-42-dlq');
  assert.deepEqual(config.vars, {
    MODEL_PROVIDER: 'fake',
    DEV_AUTH: 'true',
    BETTER_AUTH_URL: 'https://debate-arena-web-pr-42.acme.workers.dev',
    MODERATOR_GITHUB_IDS: '',
    EMAIL_PROVIDER: 'none',
    EMAIL_FROM: '',
  });
  assert.equal(config.env, undefined);
  assert.deepEqual(config.exports, apiBase.exports);
  assert.equal(config.main, 'src/index.ts');
});

test('the web preview config points at the PR API', () => {
  const built = { name: 'debate-arena-web', main: 'entry.mjs', services: [{ binding: 'API', service: 'debate-arena-api' }], assets: { directory: '../client', binding: 'ASSETS' } };
  const config = webPreviewConfig(built, 42);
  assert.equal(config.name, 'debate-arena-web-pr-42');
  assert.deepEqual(config.services, [{ binding: 'API', service: 'debate-arena-api-pr-42' }]);
  assert.equal(config.main, 'entry.mjs');
  assert.equal(built.name, 'debate-arena-web');
});

test('down deletes everything in order and treats not-found as done', async () => {
  const commands = [];
  const run = async (args) => {
    commands.push(args.join(' '));
    return { code: 1, stdout: '', stderr: 'This Worker does not exist on your account. [code: 10007]' };
  };
  await down(42, run);
  assert.deepEqual(commands, [
    'delete --name debate-arena-web-pr-42 --force',
    'delete --name debate-arena-api-pr-42 --force',
    'queues delete debate-steps-pr-42',
    'queues delete debate-steps-pr-42-dlq',
    'd1 delete debate-arena-pr-42 --skip-confirmation',
  ]);
});

test('down is safe to repeat: wrangler’s "Couldn’t find" for a deleted D1 counts as done', async () => {
  const run = async args =>
    args[0] === 'd1'
      ? { code: 1, stdout: '', stderr: "✘ [ERROR] Couldn't find a D1 DB with the name or binding 'debate-arena-pr-42' in your wrangler.toml file." }
      : { code: 1, stdout: '', stderr: 'Queue "debate-steps-pr-42" does not exist. [code: 11000]' };
  await down(42, run);
});

test('down fails on a real error', async () => {
  const run = async () => ({ code: 1, stdout: '', stderr: 'Authentication error [code: 10000]' });
  await assert.rejects(down(42, run), /Authentication error/);
});
