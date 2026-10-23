/** Real room chat: desktop T/Enter/Esc, literal text, idle controls and mobile taps. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { Client } from '@colyseus/sdk';
import { BR } from '@qwakk/shared';
import { IslandState, MatchPhase } from '@qwakk/shared/net';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? '/private/tmp/qwakk-chat-shots';
mkdirSync(out, { recursive: true });
const serverPort = Number(process.env.E2E_SERVER_PORT ?? 2567);
const webPort = Number(process.env.E2E_WEB_PORT ?? 5173);
function start(args: string[], cwd: string, env: Record<string, string> = {}): ChildProcess {
  return spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
}
function ready(proc: ChildProcess, needle: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Startup timeout: ${needle}`)), 30000);
    const read = (data: Buffer) => {
      if (data.toString().includes(needle)) { clearTimeout(timer); resolve(); }
    };
    proc.stdout?.on('data', read);
    proc.stderr?.on('data', read);
    proc.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Process exited: ${code}`)); });
  });
}
const server = start(['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], root, { PORT: String(serverPort), QWAKK_BOTS: '0', QWAKK_BR_COUNTDOWN: '3', QWAKK_BR_MIN_HUMANS: '2' });
const web = start([`${root}/node_modules/vite/bin/vite.js`, 'preview', '--outDir', process.env.E2E_DIST ?? 'dist-test', '--port', String(webPort), '--strictPort'], `${root}/apps/client`);
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER === 'chromium' ? undefined : 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
const errors: string[] = [];
async function join(page: Page, name: string): Promise<void> {
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://localhost:${webPort}/game/?mode=dm&server=ws://localhost:${serverPort}&name=${name}&character=mallard&lang=tr`);
  await page.waitForFunction(() => (window as any).__qwakk?.snapshot().me, null, { timeout: 60000 });
  await page.locator('#overlay').click({ position: { x: 10, y: 10 } });
}
const snap = (page: Page) => page.evaluate(() => (window as any).__qwakk.snapshot());
try {
  await Promise.all([ready(server, 'server listening'), ready(web, String(webPort))]);
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const peerContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const a = await desktop.newPage();
  const b = await peerContext.newPage();
  await join(b, 'ChatB');
  await join(a, 'ChatA');
  await a.waitForFunction(() => document.pointerLockElement !== null);
  await a.locator('#overlay').waitFor({ state: 'hidden' });
  await a.keyboard.down('w');
  await a.keyboard.press('t');
  assert.equal(await a.locator('.chat-compose').isVisible(), true);
  assert.equal(await a.locator('.chat-compose input').inputValue(), '');
  assert.equal(await a.locator('#overlay').isVisible(), false);
  await a.keyboard.up('w');
  await a.waitForTimeout(500);
  const before = await snap(a);
  const literal = 'Selam ördekler! <img src=x onerror=alert(1)> 🦆';
  await a.locator('.chat-compose input').fill(literal);
  await a.keyboard.press('Space');
  for (const key of ['r', 'i', 'm', 'v', 'h', '1', '2', '4', '5']) await a.keyboard.press(key);
  await a.waitForTimeout(500);
  const after = await snap(a);
  assert.ok(Math.hypot(after.me.x - before.me.x, after.me.z - before.me.z) < 0.15, 'typing must stop movement');
  assert.equal(after.server.weapon, before.server.weapon, 'typing must not switch weapons');
  assert.equal(after.server.mag0, before.server.mag0, 'typing must not fire');
  assert.equal(await a.locator('.br-invscreen').isVisible(), false);
  await a.locator('.chat-compose input').fill(literal);
  await a.keyboard.press('Enter');
  await b.waitForFunction(() => document.querySelector('.chat-message')?.textContent?.includes('Selam ördekler!'));
  assert.ok((await b.locator('.chat-message').innerText()).includes(`ChatA: ${literal}`));
  assert.equal(await b.locator('.chat-message img').count(), 0, 'messages must render as text');
  await a.waitForFunction(() => document.pointerLockElement !== null);
  await a.locator('.chat-compose').waitFor({ state: 'hidden' });
  await a.keyboard.press('t');
  await a.locator('.chat-compose input').fill('gönderilmesin');
  await a.keyboard.press('Escape');
  assert.equal(await a.locator('.chat-compose').isVisible(), false);
  assert.equal(await b.locator('.chat-message').count(), 1);
  const chatBox = await a.locator('.chat-toggle').boundingBox();
  const hpBox = await a.locator('.ghud-hp').boundingBox();
  assert.ok(chatBox && hpBox && chatBox.y + chatBox.height < hpBox.y, 'chat must sit above health');
  await a.keyboard.press('t');
  await a.locator('.chat-compose').waitFor({ state: 'visible' });
  await a.screenshot({ path: `${out}/desktop-chat-open.png`, animations: 'disabled' });
  await a.keyboard.press('Escape');
  await a.screenshot({ path: `${out}/desktop-chat.png`, animations: 'disabled' });

  const mobile = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const phone = await mobile.newPage();
  // A touch tap activates the real mobile controls.
  phone.on('pageerror', (error) => errors.push(error.message));
  await phone.goto(`http://localhost:${webPort}/game/?mode=dm&server=ws://localhost:${serverPort}&name=ChatPhone&lang=tr`);
  await phone.waitForFunction(() => (window as any).__qwakk?.snapshot().me, null, { timeout: 60000 });
  await phone.locator('#overlay').tap({ position: { x: 10, y: 10 } });
  await phone.locator('.chat-toggle').tap();
  assert.equal(await phone.locator('.chat-compose').isVisible(), true);
  await phone.locator('.chat-compose input').fill('Telefondan selam!');
  await phone.screenshot({ path: `${out}/mobile-chat-open.png`, animations: 'disabled' });
  await phone.locator('.chat-compose button[type=submit]').tap();
  await b.waitForFunction(() => document.querySelector('.chat-log')?.textContent?.includes('Telefondan selam!'));
  await phone.screenshot({ path: `${out}/mobile-chat.png`, animations: 'disabled' });
  await phone.locator('.chat-toggle').tap();
  await phone.getByRole('button', { name: 'Sohbeti kapat', exact: true }).tap();
  assert.equal(await phone.locator('.chat-compose').isVisible(), false);
  await mobile.close();
  await desktop.close();
  await peerContext.close();
  // Finish a quiet BR round while the composer is open. No navigation or loot is needed.
  const resultPeer = await new Client(`ws://localhost:${serverPort}`).joinOrCreate(BR.roomName, { name: 'ResultPeer' }, IslandState);
  resultPeer.onMessage('*', () => {});
  let peerLeft = false;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const resultPage = await context.newPage();
    resultPage.on('pageerror', (error) => errors.push(error.message));
    await resultPage.goto(`http://localhost:${webPort}/game/?mode=br&server=ws://localhost:${serverPort}&autopilot=br&name=ResultChat&lang=tr`);
    await resultPage.waitForFunction((phase) => (window as any).__qwakk?.snapshot().phase === phase, MatchPhase.Playing, { timeout: 60000 });
    await resultPage.locator('.chat-toggle').click();
    await resultPage.locator('.chat-compose').waitFor({ state: 'visible' });
    await resultPeer.leave(true);
    peerLeft = true;
    await resultPage.waitForFunction(() => (window as any).__qwakk?.snapshot().br?.resultShown, null, { timeout: 20000 });
    assert.equal(await resultPage.locator('.chat-compose').isVisible(), false, 'results must close chat');
    assert.equal(await resultPage.evaluate(() => document.pointerLockElement !== null), false, 'results must leave the mouse free');
    await resultPage.screenshot({ path: `${out}/br-result.png`, animations: 'disabled' });
    await context.close();
  } finally {
    if (!peerLeft) await resultPeer.leave(true).catch(() => {});
  }
  assert.deepEqual(errors, []);
  console.log('Chat E2E OK: desktop keys, literal text, idle controls, mobile send/close and BR results');
} catch (error) {
  for (const [i, context] of browser.contexts().entries()) {
    for (const [j, page] of context.pages().entries()) await page.screenshot({ path: `${out}/failure-${i}-${j}.png` }).catch(() => {});
  }
  console.error('Page errors:', errors);
  throw error;
} finally {
  await browser.close();
  for (const proc of [server, web]) if (proc.exitCode === null) proc.kill('SIGINT');
}
