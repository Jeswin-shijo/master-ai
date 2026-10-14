/**
 * A public demo served from this machine:
 *   - the database on Supabase (master-ai-backend/.env.demo → DATABASE_URL, the Session pooler URI);
 *   - the API and worker here, beside `pnpm dev`: port 3100 and their own Temporal queue;
 *   - a Cloudflare quick tunnel to the API;
 *   - the web app on Vercel, built against the tunnel's address.
 *
 *   pnpm demo:setup   once: extensions, the app's database role, migrations, Supabase's own API locked out
 *   pnpm demo         build, open the tunnel, deploy the web app, run the API and worker (Ctrl-C stops)
 *
 * Needs `pnpm infra:up` (Temporal and NATS), `brew install cloudflared` and `npx vercel login`.
 * The AI is whatever master-ai-backend/.env sets (a Gemini key works); when it is out of quota
 * or unreachable, the built-in rules answer (LLM_RULES_WHEN_UNAVAILABLE).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { hostingConfig } from '../../master-ai-web/src/hosting.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BACKEND = join(ROOT, 'master-ai-backend');
const ENV_FILE = join(BACKEND, '.env.demo');
// The folder Vercel deploys. Its name is the project's, and it sits outside the git repository: inside it, Vercel
// reads the latest commit and blocks the deploy when the commit's author isn't the Vercel account's email.
const STAGE = join(tmpdir(), 'onehuman-demo');
// The Vercel project link (.vercel/project.json), kept between runs.
const LINK = join(ROOT, '.superpowers/demo/onehuman-demo/.vercel');
const PORT = 3100;
const QUEUE = 'onehuman-demo';
const VERCEL = 'vercel@61.1.0';

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function readDemoEnv(): Record<string, string> {
  if (!existsSync(ENV_FILE)) fail(`No ${ENV_FILE}. Create it with DATABASE_URL=<Supabase → Connect → Session pooler URI>.`);
  const env = parseEnv(readFileSync(ENV_FILE, 'utf8')) as Record<string, string>;
  if (!env.DATABASE_URL?.startsWith('postgres')) fail('DATABASE_URL in .env.demo must be the Supabase Session pooler URI.');
  if (env.DATABASE_URL.includes('[YOUR-PASSWORD]')) fail('Replace [YOUR-PASSWORD] in DATABASE_URL with your database password.');
  // Secrets made once and kept beside the URI, never printed.
  const add: Record<string, string> = {};
  if (!env.APP_DB_PASSWORD) add.APP_DB_PASSWORD = randomBytes(24).toString('hex');
  if (!env.JWT_SECRET) add.JWT_SECRET = randomBytes(48).toString('hex');
  if (Object.keys(add).length) {
    appendFileSync(ENV_FILE, `\n# Made by pnpm demo:setup\n${Object.entries(add).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
    Object.assign(env, add);
  }
  return env;
}

/** The owner's URI (Session pooler, for setup and migrations) and the app role's (Transaction pooler, for the API and worker). */
function databaseUrls(env: Record<string, string>) {
  const owner = new URL(env.DATABASE_URL!);
  const ref = decodeURIComponent(owner.username).split('.')[1];
  if (!ref) fail('DATABASE_URL should be the Session pooler URI, whose user is postgres.<project-ref>.');
  owner.searchParams.set('sslmode', 'no-verify');
  const app = new URL(owner.toString());
  app.username = `onehuman_app.${ref}`;
  app.password = env.APP_DB_PASSWORD!;
  app.port = '6543'; // transaction pooler: many short connections; tenant settings are per transaction
  return { owner: owner.toString(), app: app.toString() };
}

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; quiet?: boolean; timeoutMs?: number } = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd ?? ROOT, env: opts.env ?? process.env, encoding: 'utf8', stdio: opts.quiet ? 'pipe' : 'inherit', timeout: opts.timeoutMs });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') fail(`${cmd} ${args.join(' ')} took longer than ${Math.round(opts.timeoutMs! / 60_000)} min`);
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} failed${opts.quiet ? `:\n${r.stdout}\n${r.stderr}` : ''}`);
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

async function setup() {
  const env = readDemoEnv();
  const urls = databaseUrls(env);
  const db = new pg.Client({ connectionString: urls.owner });
  await db.connect();
  console.log('✓ Connected to Supabase as the owner');
  // Extensions in public, where the app role's search_path finds their types and operators.
  await db.query('create extension if not exists vector with schema public');
  await db.query('create extension if not exists citext with schema public');
  // The app's role: not the owner and no BYPASSRLS, so row-level security applies to every query.
  const password = env.APP_DB_PASSWORD!.replace(/[^0-9a-f]/g, '');
  await db.query(`do $$ begin
    if not exists (select from pg_roles where rolname = 'onehuman_app') then
      create role onehuman_app login nosuperuser nocreatedb nocreaterole nobypassrls;
    end if; end $$`);
  await db.query(`alter role onehuman_app with login password '${password}'`);
  await db.query('grant connect on database postgres to onehuman_app');
  console.log('✓ Extensions and the app role ready');
  await db.end();

  run('pnpm', ['--filter', '@onehuman/backend', 'db:migrate'], { env: { ...process.env, DATABASE_URL: urls.owner } });
  console.log('✓ Migrations applied');

  // Supabase also serves the public schema to its own API roles. This app never uses that API, and
  // `users` holds password hashes, so its roles get nothing.
  const lock = new pg.Client({ connectionString: urls.owner });
  await lock.connect();
  for (const sql of [
    'revoke all on all tables in schema public from anon, authenticated',
    'revoke all on all sequences in schema public from anon, authenticated',
    'revoke all on all functions in schema public from anon, authenticated',
    'alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated',
    'alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated',
    'alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated',
  ]) {
    await lock.query(sql);
  }
  await lock.end();
  console.log("✓ Supabase's own API roles locked out of the app's tables");

  const app = new pg.Client({ connectionString: urls.app });
  await app.connect();
  const who = await app.query<{ user: string; tenants: string }>('select current_user as user, (select count(*) from tenants)::text as tenants');
  await app.end();
  console.log(`✓ The app connects as ${who.rows[0]!.user}; row-level security hides tenants without a tenant set (${who.rows[0]!.tenants} visible)`);
  console.log('\nSetup done. Start the demo with: pnpm demo');
}

function reachable(port: number): Promise<boolean> {
  return new Promise((ok) => {
    const s = createConnection({ port, host: '127.0.0.1' }, () => (s.destroy(), ok(true)));
    s.on('error', () => ok(false));
  });
}

function tunnel(children: ChildProcess[]): Promise<string> {
  return new Promise((ok, no) => {
    const cf = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(cf);
    let seen = '';
    const read = (chunk: Buffer) => {
      seen += chunk.toString();
      const m = seen.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) ok(m[0]);
    };
    cf.stdout.on('data', read);
    cf.stderr.on('data', read);
    cf.on('exit', (code) => no(new Error(`cloudflared exited (${code}):\n${seen.slice(-500)}`)));
    setTimeout(() => no(new Error('cloudflared gave no address within 60 s')), 60_000);
  });
}

async function start() {
  const env = readDemoEnv();
  const urls = databaseUrls(env);
  if (!(await reachable(7233)) || !(await reachable(4222))) fail('Temporal or NATS is not running. Start them with `pnpm infra:up`.');
  if (await reachable(PORT)) fail(`Port ${PORT} is busy: is a demo already running?`);
  if (spawnSync('cloudflared', ['--version']).status !== 0) fail('cloudflared is missing: brew install cloudflared');
  if (spawnSync('npx', ['--yes', VERCEL, 'whoami'], { encoding: 'utf8' }).status !== 0) fail(`Not logged in to Vercel: run npx ${VERCEL} login`);

  const children: ChildProcess[] = [];
  const stop = () => {
    for (const c of children) c.kill('SIGTERM');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.log('Building the backend…');
  run('pnpm', ['turbo', 'run', 'build', '--filter=@onehuman/backend...'], { quiet: true });
  const apiUrl = await tunnel(children).catch((err: Error) => fail(err.message));
  console.log(`✓ Tunnel: ${apiUrl} → localhost:${PORT}`);

  console.log('Building and deploying the web app…');
  run('pnpm', ['--filter', '@onehuman/web', 'build'], { env: { ...process.env, VITE_API_URL: apiUrl }, quiet: true });
  rmSync(STAGE, { recursive: true, force: true });
  cpSync(join(ROOT, 'master-ai-web/dist'), STAGE, { recursive: true });
  if (existsSync(LINK)) cpSync(LINK, join(STAGE, '.vercel'), { recursive: true });
  // One page app: every path (/cases/…, /r/<tenant>/<form>, /invite/…) serves index.html, with the
  // security headers and caching in master-ai-web/src/hosting.ts.
  writeFileSync(join(STAGE, 'vercel.json'), JSON.stringify(hostingConfig(apiUrl), null, 2));
  const out = run('npx', ['--yes', VERCEL, 'deploy', STAGE, '--prod', '--yes'], { quiet: true, timeoutMs: 8 * 60_000 });
  mkdirSync(LINK, { recursive: true });
  cpSync(join(STAGE, '.vercel'), LINK, { recursive: true });
  if (/Blocked|doesn.t have permission/i.test(out)) fail(`Vercel blocked the deploy:\n${out.slice(-600)}`);
  const urlsSeen = [...new Set(out.match(/https:\/\/[a-z0-9-]+\.vercel\.app/g) ?? [])];
  if (!urlsSeen.length) fail(`Vercel gave no address:\n${out.slice(-800)}`);
  const webUrl = urlsSeen.sort((a, b) => a.length - b.length)[0]!; // the project's alias is the shortest
  console.log(`✓ Web app: ${webUrl}`);

  const backendEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    DATABASE_URL: urls.owner,
    APP_DATABASE_URL: urls.app,
    JWT_SECRET: env.JWT_SECRET,
    TEMPORAL_TASK_QUEUE: QUEUE,
    CORS_ORIGINS: urlsSeen.join(','),
    WEB_URL: webUrl,
    PUBLIC_URL: apiUrl,
    TRUST_PROXY: '1',
    LLM_RULES_WHEN_UNAVAILABLE: 'true',
    LLM_MAX_RPM: process.env.LLM_MAX_RPM ?? '12',
  };
  for (const [name, file] of [
    ['api', 'dist/main.js'],
    ['worker', 'dist/worker.js'],
  ] as const) {
    const child = spawn('node', ['--enable-source-maps', file], { cwd: BACKEND, env: backendEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d: Buffer) => process.stdout.write(`[${name}] ${d}`));
    child.stderr.on('data', (d: Buffer) => process.stderr.write(`[${name}] ${d}`));
    child.on('exit', (code) => {
      console.error(`[${name}] exited (${code}); stopping the demo`);
      stop();
    });
    children.push(child);
  }
  for (let i = 0; i < 60 && !(await fetch(`${apiUrl}/health`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 2000));
  const health = await fetch(`${apiUrl}/health`).then((r) => r.json(), () => null);
  if (!health) fail('The API did not answer through the tunnel.');
  console.log(`\n✓ Demo ready: ${webUrl}\n  API ${apiUrl} · AI ${health.llm} (${health.provider}) · built-in rules when the AI is unavailable\n  Ctrl-C stops it. A new run gets a new tunnel address and redeploys the web app.\n`);
}

const command = process.argv[2];
if (command === 'setup') await setup();
else if (command === 'start') await start();
else fail('Usage: node infra/demo/demo.mts setup|start');
