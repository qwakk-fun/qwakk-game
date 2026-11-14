/**
 * Duck Pass on a real PostgreSQL (skipped when the local test database is not
 * running): migration 008, the HTTP routes with a fake chain, the `qorex`
 * login and the proof row, the account view, one wallet per account and one
 * account per wallet, unlink, and account deletion taking it all.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeEmail, type AccountView, type CharacterView, type SignedIn } from '@qwakk/shared/accounts';
import type { DuckPassChallenge } from '@qwakk/shared/duck-pass';
import { DevMailSink } from '../../src/meta/accounts/mail.ts';
import { clearRevoked } from '../../src/meta/accounts/revoked.ts';
import type { ChainFetch } from '../../src/meta/duckPass/chain.ts';
import { createMetaHandler } from '../../src/meta/http.ts';
import { MetaService } from '../../src/meta/service.ts';
import { proofTx, TEST_ADDRESS } from '../../../../packages/shared/test/duckPassFixture.ts';
import { dbReachable, freshDatabase } from './testDb.ts';

const reachable = await dbReachable();
const SECRET = 'duckpass-test-secret-duckpass-test-1234';

let ipN = 0;
const ip = (): string => `10.40.${Math.floor(++ipN / 250)}.${ipN % 250}`;

describe.skipIf(!reachable)('Duck Pass (PostgreSQL)', () => {
  let db: { url: string; drop: () => Promise<void> };
  let meta: MetaService;
  let sink: DevMailSink;
  let sql: Sql;
  let http: Server;
  let base = '';
  /** What the fake chain answers for every hash. */
  let onChain: unknown = null;

  beforeAll(async () => {
    db = await freshDatabase('duckpass');
    sink = new DevMailSink({ quiet: true });
    const chainFetch = (async (url: string) => {
      const hash = url.split('/').pop()!;
      if (!onChain) return { ok: false, status: 404, json: async () => ({ code: 5 }) };
      const tx = structuredClone(onChain) as { tx_response: { txhash: string } };
      tx.tx_response.txhash = hash;
      return { ok: true, status: 200, json: async () => tx };
    }) as unknown as ChainFetch;
    meta = new MetaService({ env: { DATABASE_URL: db.url, SESSION_SECRET: SECRET }, mailer: sink, chainFetch });
    await meta.start();
    sql = meta.sql!;
    http = createServer(createMetaHandler(meta));
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    http?.close();
    await meta?.stop();
    await db?.drop();
    clearRevoked();
  });

  const A = () => meta.accounts;
  const bearer = (t: string) => `Bearer ${t}`;
  const post = (path: string, body: unknown, token: string) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: bearer(token) }, body: JSON.stringify(body) });

  async function signUp(email: string): Promise<{ s: SignedIn; duck: CharacterView }> {
    await A().requestCode({ email }, ip());
    const code = sink.lastTo(normalizeEmail(email)!)!.code!;
    const v = await A().verify({ email, code }, ip());
    const s = (await A().signup({ signupToken: (v.body as { signupToken: string }).signupToken, consent: true }, ip())).body as SignedIn;
    const d = await A().createCharacter(bearer(s.accountToken), { name: `Pass${ipN}`, look: 0 }, ip());
    return { s, duck: (d.body as { character: CharacterView }).character };
  }

  async function link(token: string, duckId: string, address = TEST_ADDRESS): Promise<Response> {
    const c = await post('/api/account/qorex/challenge', { address, duckId }, token);
    expect(c.status).toBe(200);
    const ch = (await c.json()) as DuckPassChallenge;
    expect(ch.memo).toMatch(/^qwakk-duck-pass:v1:s1:\d+:[A-Za-z0-9_-]{16}$/);
    onChain = proofTx({ memo: ch.memo });
    return post('/api/account/qorex/verify', { txHash: 'AB'.repeat(32) }, token);
  }

  it('links a wallet over HTTP and shows it on the account', async () => {
    const { s, duck } = await signUp('pass.one@example.com');
    onChain = null;
    const r = await link(s.accountToken, duck.id);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { status: string; duckPass: { address: string; txHash: string; season: string } };
    expect(body).toMatchObject({ status: 'linked', duckPass: { address: TEST_ADDRESS, txHash: 'AB'.repeat(32), season: 's1' } });
    const [login] = await sql<{ subject: string }[]>`select subject from account_logins where method = 'qorex'`;
    expect(login?.subject).toBe(TEST_ADDRESS);
    const acc = (await A().account(bearer(s.accountToken), ip())).body as { account: AccountView };
    expect(acc.account.duckPass).toMatchObject({ address: TEST_ADDRESS, season: 's1' });
    // A second link for the same account is refused before any fee.
    const again = await post('/api/account/qorex/challenge', { address: TEST_ADDRESS, duckId: duck.id }, s.accountToken);
    expect(await again.json()).toEqual({ error: 'qorex_linked' });
  });

  it('keeps one account per wallet, and unlink frees it', async () => {
    const first = (await sql<{ account_id: string }[]>`select account_id from account_logins where method = 'qorex'`)[0]!.account_id;
    const { s, duck } = await signUp('pass.two@example.com');
    const c = await post('/api/account/qorex/challenge', { address: TEST_ADDRESS, duckId: duck.id }, s.accountToken);
    expect(await c.json()).toEqual({ error: 'qorex_taken' });
    // The first account unlinks (its session from the first test is gone from scope, so straight through the store).
    await meta.accounts.duckPass.unlink(sql, first);
    expect((await sql<{ n: number }[]>`select count(*)::int as n from duck_passes`)[0]?.n).toBe(0);
    expect((await link(s.accountToken, duck.id)).status).toBe(200);
  });

  it('refuses a proof without the hybrid layer and stores nothing', async () => {
    const { s, duck } = await signUp('pass.three@example.com');
    const c = (await (await post('/api/account/qorex/challenge', { address: `qor1${'z'.repeat(38)}`, duckId: duck.id }, s.accountToken)).json()) as DuckPassChallenge;
    onChain = proofTx({ memo: c.memo, from: `qor1${'z'.repeat(38)}`, ext: false });
    const r = await post('/api/account/qorex/verify', { txHash: 'CD'.repeat(32) }, s.accountToken);
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ error: 'qorex_no_hybrid' });
    expect((await sql<{ n: number }[]>`select count(*)::int as n from duck_passes where tx_hash = ${'CD'.repeat(32)}`)[0]?.n).toBe(0);
  });

  it('needs an account session', async () => {
    const r = await fetch(`${base}/api/account/qorex/challenge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: TEST_ADDRESS }) });
    expect(r.status).toBe(401);
  });

  it('goes with the account on delete', async () => {
    const [row] = await sql<{ account_id: string }[]>`select account_id from duck_passes`;
    await sql`delete from accounts where id = ${row!.account_id}`;
    expect((await sql<{ n: number }[]>`select count(*)::int as n from duck_passes`)[0]?.n).toBe(0);
    expect((await sql<{ n: number }[]>`select count(*)::int as n from account_logins where method = 'qorex'`)[0]?.n).toBe(0);
  });
});
