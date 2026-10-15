/**
 * Runs the game server (port 2567) and the Vite client (port 5173) together.
 * `npm run dev -- --host` also exposes the client on the LAN for phones.
 * Ctrl+C stops both.
 */
import { spawn, type ChildProcess } from 'node:child_process';

const host = process.argv.includes('--host');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const children: ChildProcess[] = [
  spawn(npm, ['run', 'dev', '-w', '@qwakk/server'], { stdio: 'inherit' }),
  spawn(npm, ['run', host ? 'dev:lan' : 'dev', '-w', '@qwakk/client'], { stdio: 'inherit' }),
];

let stopping = false;
function stop(code = 0): void {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGINT');
  setTimeout(() => process.exit(code), 500);
}
for (const c of children) c.on('exit', (code) => stop(code ?? 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
