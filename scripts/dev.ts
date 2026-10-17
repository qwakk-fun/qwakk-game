/** One local stack: database, watched admin build, game server and client. */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createDevAdmin } from './dev-admin.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const vite = `${root}/node_modules/vite/bin/vite.js`;
const host = process.argv.includes('--host');
const noOpen = !process.argv.includes('--open') || process.argv.includes('--no-open');
const children = new Set<ChildProcess>();
const abort = new AbortController();
let stopping = false;
let closeBrowser = async (): Promise<void> => {};

// Separate process groups include Node's watch child, not just its wrapper.
function signal(child: ChildProcess, sig: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(sig);
    else process.kill(-child.pid, sig);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

async function stop(code = 0): Promise<void> {
  if (stopping) return;
  stopping = true;
  abort.abort();
  console.log('\n[dev] Stopping game, client, admin watcher and preview browser...');
  for (const child of children) signal(child, 'SIGTERM');
  const force = setTimeout(() => {
    for (const child of children) signal(child, 'SIGKILL');
  }, 4000);
  await Promise.allSettled([
    ...[...children].map((child) => new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once('exit', () => resolve());
    })),
    closeBrowser(),
  ]);
  clearTimeout(force);
  // A watcher may exit before its own child; do not leave descendants behind.
  for (const child of children) signal(child, 'SIGKILL');
  console.log('[dev] Development processes stopped.');
  process.exit(code);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
process.on('SIGHUP', () => void stop());

function start(command: string, args: string[], env: NodeJS.ProcessEnv, cwd = root): ChildProcess {
  const child = spawn(command, args, { cwd, env, stdio: 'inherit', detached: process.platform !== 'win32' });
  children.add(child);
  child.on('error', (err) => { children.delete(child); console.error(`[dev] ${err.message}`); void stop(1); });
  return child;
}

async function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const child = start(command, args, env);
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      children.delete(child);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? 'a signal'}`));
    });
  });
}

async function checkPorts(): Promise<void> {
  const reservations = [];
  try {
    for (const port of [2567, 5173]) {
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once('error', () => reject(new Error(`Port ${port} is in use. Stop the other Qwakk dev terminal with Ctrl+C, then run npm run dev again.`)));
        server.listen(port, resolve);
      });
      reservations.push(server);
    }
  } finally {
    await Promise.all(reservations.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  }
}

async function ready(url: string): Promise<void> {
  for (let i = 0; i < 120 && !stopping; i++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(1000)]) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch { /* server is starting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Not ready: ${url}`);
}

async function main(): Promise<void> {
  // Local server settings only. Do not load secrets into Vite's environment.
  let local: NodeJS.ProcessEnv = {};
  try { local = parseEnv(readFileSync(`${root}/.env`, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Could not read the local .env file'); }
  const serverBaseEnv = { ...local, ...process.env };
  if (serverBaseEnv.NODE_ENV === 'production') throw new Error('npm run dev is local only. Use npm start in production.');
  await checkPorts();
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'development' };
  // Vite and its build watcher never receive server credentials.
  for (const key of ['ADMIN_PASSWORD_HASH', 'ADMIN_TOTP_SECRET', 'SESSION_SECRET', 'TURNSTILE_SECRET', 'DATABASE_URL']) delete env[key];
  // Normal dev uses the existing server environment and manual admin login.
  // A temporary authenticated Chrome preview is available only with --open.
  const admin = noOpen ? null : await createDevAdmin(root);
  if (admin) closeBrowser = admin.close;
  if (!serverBaseEnv.DATABASE_URL) await run('docker', ['compose', 'up', '-d', 'postgres'], env);
  if (stopping) return;
  await run(process.execPath, [vite, 'build', '--config', 'apps/admin/vite.config.ts'], env);
  if (stopping) return;
  const serverEnv: NodeJS.ProcessEnv = { ...serverBaseEnv, ...admin?.env, QWAKK_ADMIN_DIR: `${root}/apps/admin/dist`, NODE_ENV: 'development', PORT: '2567', TRUST_PROXY: '0',
    SESSION_SECRET: serverBaseEnv.SESSION_SECRET || 'qwakk-dev-only-session-secret-never-use-in-production',
    DATABASE_URL: serverBaseEnv.DATABASE_URL || 'postgres://qwakk_game:qwakk_game_local@localhost:5439/qwakk_game',
  };
  const services = [
    start(process.execPath, ['--watch', '--disable-warning=ExperimentalWarning', 'src/index.ts'], serverEnv, `${root}/apps/server`),
    start(process.execPath, [vite, ...(host ? ['--host'] : [])], env, `${root}/apps/client`),
    start(process.execPath, [vite, 'build', '--config', 'apps/admin/vite.config.ts', '--watch'], env),
  ];
  for (const child of services) child.once('exit', (code) => { if (!stopping) void stop(code || 1); });
  await Promise.all([ready('http://localhost:2567/health'), ready('http://localhost:5173/game/')]);
  if (stopping) return;
  console.log('\n[dev] Game: http://localhost:5173/game/');
  console.log('[dev] Admin: http://localhost:2567/admin (password + TOTP, configured via server environment)');
  if (!admin && (!serverEnv.ADMIN_PASSWORD_HASH || !serverEnv.ADMIN_TOTP_SECRET)) {
    console.log('[dev] Admin login is off until ADMIN_PASSWORD_HASH and ADMIN_TOTP_SECRET are set (npm run admin:setup).');
  }
  console.log('[dev] Ctrl+C stops all development processes. PostgreSQL data is kept.');
  if (admin) {
    try { await admin.open(); }
    catch (error) { console.error(`[dev] Browser preview: ${error instanceof Error ? error.message : String(error)}. Install Google Chrome, then restart npm run dev.`); }
  }
}

main().catch((error: unknown) => {
  if (stopping) return;
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  void stop(1);
});
