/**
 * The hub's pure parts: invite book (limits, one open invite per duck,
 * expiry, the same target again only after a while), the interest classes
 * with their hysteresis, the chat word filter, and team linking against the
 * party registry (leader first, full teams, markers).
 */
import { describe, expect, it } from 'vitest';
import { PARTY } from '@qwakk/shared';
import { HUB } from '@qwakk/shared/hub';
import { InviteBook, Limiter } from '../src/hub/invites.ts';
import { hubClass } from '../src/hub/interest.ts';
import { blockedWord, filterHubChat } from '../src/hub/chatFilter.ts';
import { HubTeams } from '../src/hub/teams.ts';
import { PartyRegistry, type PartyHandle } from '../src/party/registry.ts';

describe('hub invites', () => {
  it('limits a sender, keeps one open invite per invited duck, expires', () => {
    const book = new InviteBook();
    expect(book.invite('a', 'a', 0)).toBe('self');
    expect(book.invite('a', 'b', 0)).toBe('ok');
    expect(book.invite('a', 'b', 100)).toBe('again');
    expect(book.invite('c', 'b', 100)).toBe('busy');
    expect(book.invite('a', 'c', 200)).toBe('ok');
    expect(book.invite('a', 'd', 300)).toBe('ok');
    expect(book.invite('a', 'e', 400)).toBe('limited');
    expect(book.invite('a', 'e', 400 + HUB.invite.refillMs)).toBe('ok');
    // b answers in time; d's invite runs out.
    expect(book.answer('b', 'a', 1000)).toMatchObject({ from: 'a', to: 'b' });
    expect(book.answer('b', 'a', 1000)).toBeNull();
    expect(book.answer('c', 'z', 1000)).toBeNull();
    const gone = book.expire(300 + HUB.invite.ttlMs + 1);
    expect(gone.map((i) => i.to).sort()).toEqual(['c', 'd']);
    expect(book.answer('e', 'a', 400 + HUB.invite.refillMs + HUB.invite.ttlMs + 1)).toBeNull();
    book.forget('a');
    expect(book.size).toBe(0);
  });

  it('a limiter refills over time and forgets', () => {
    const l = new Limiter(2, 1000);
    expect([l.allow('x', 0), l.allow('x', 0), l.allow('x', 0)]).toEqual([true, true, false]);
    expect(l.allow('x', 1000)).toBe(true);
    expect(l.allow('y', 0)).toBe(true);
  });
});

describe('hub interest', () => {
  it('near, far and nothing with hysteresis', () => {
    expect(hubClass(0, HUB.near - 1)).toBe(2);
    expect(hubClass(0, HUB.near + 1)).toBe(1);
    expect(hubClass(2, HUB.nearOut - 1)).toBe(2);
    expect(hubClass(2, HUB.nearOut + 1)).toBe(1);
    expect(hubClass(0, HUB.far + 1)).toBe(0);
    expect(hubClass(1, HUB.farOut - 1)).toBe(1);
    expect(hubClass(1, HUB.farOut + 1)).toBe(0);
  });
});

describe('hub chat filter', () => {
  it('masks words the name list blocks, keeps the rest', () => {
    expect(filterHubChat('Selam ördekler, nasılsınız? 🦆')).toBe('Selam ördekler, nasılsınız? 🦆');
    expect(filterHubChat('what the fuck')).toBe('what the ****');
    expect(filterHubChat('sh1t happens')).toBe('**** happens');
    expect(blockedWord('Klasik')).toBe(false);
    expect(filterHubChat('  ')).toBeNull();
    expect(filterHubChat({ text: 'x' })).toBeNull();
  });
});

describe('hub teams', () => {
  function party(reg: PartyRegistry, code: string, members: string[]): PartyHandle {
    const h: PartyHandle = { id: code, memberIds: () => members, kick: () => undefined, changed: () => undefined };
    for (const m of members) reg.attach(m, h);
    return h;
  }

  it('an inviter with a party: the code goes to the invited duck; a full party or a teammate is refused', () => {
    const reg = new PartyRegistry();
    party(reg, 'ABCDEF', ['p1', 'p2']);
    const t = new HubTeams(reg);
    expect(t.plan('p1', 'p3', 's3')).toEqual({ kind: 'send', code: 'ABCDEF', to: ['s3'] });
    expect(t.plan('p1', 'p2', 's2')).toEqual({ kind: 'teammates' });
    party(reg, 'FULLXX', ['q1', 'q2', 'q3', 'q4'].slice(0, PARTY.maxSize));
    expect(t.plan('q1', 'q9', 's9')).toEqual({ kind: 'full' });
  });

  it('a new party: the leader first, the invited ducks once the leader is in; markers for teams of two or more', () => {
    const reg = new PartyRegistry();
    const t = new HubTeams(reg);
    expect(t.plan('L', 'M', 'sm')).toBeNull();
    t.opened('NEWONE', 'L', [{ sessionId: 'sm', playerId: 'M' }], 0);
    expect(t.plan('L', 'N', 'sn')).toEqual({ kind: 'send', code: 'NEWONE', to: [] });
    expect(t.poll(100).ready).toEqual([]);
    const members = ['L'];
    party(reg, 'NEWONE', members);
    expect(t.markerOf('L')).toBe(0);
    const { ready } = t.poll(200);
    expect(ready).toEqual([{ code: 'NEWONE', leaderId: 'L', to: ['sm', 'sn'] }]);
    members.push('M');
    reg.attach('M', { id: 'NEWONE', memberIds: () => members, kick: () => undefined, changed: () => undefined });
    expect(t.markerOf('L')).toBeGreaterThan(0);
    expect(t.markerOf('M')).toBe(t.markerOf('L'));
  });

  it('a link that never completes fails after its time', () => {
    const t = new HubTeams(new PartyRegistry());
    t.opened('LOSTXX', 'L', [{ sessionId: 's1', playerId: 'P1' }], 0);
    expect(t.poll(HUB.partyLinkMs + 1).failed).toEqual([{ leaderId: 'L', to: ['s1'] }]);
  });
});
