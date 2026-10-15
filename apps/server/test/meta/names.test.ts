import { describe, expect, it } from 'vitest';
import { checkName, nameParts } from '../../src/meta/names.ts';

describe('nickname rules', () => {
  it('accepts 3 to 16 letters, digits and underscores', () => {
    for (const n of ['abc', 'Duck_42', 'QuackAttack', 'a234567890123456', 'Mallard_9000']) expect(checkName(n)).toEqual({ ok: true, name: n });
  });

  it('rejects bad formats', () => {
    for (const n of ['ab', 'a2345678901234567', 'has space', 'emoji🦆', 'dash-name', 'dot.name', '', 'ördek', 42, null, undefined]) {
      expect(checkName(n)).toEqual({ ok: false, reason: 'format' });
    }
  });

  it('trims surrounding whitespace', () => {
    expect(checkName('  Duck  ')).toEqual({ ok: true, name: 'Duck' });
  });

  it('blocks English and Turkish slurs and insults with leetspeak and repeats', () => {
    for (const n of ['fuck', 'FuuuckYou', 'f_u_c_k', 'sh1t_duck', 'B1TCH', 'fvck', 'orospu', '0r0spu_c0cugu', 'Yarrrak', 'siktir_git', 'SikKafa', 'AmK', 'BigAss', 'big_a55', 'n1gg3r', 'gerizekali', 'pezevenk42']) {
      expect(checkName(n), n).toEqual({ ok: false, reason: 'blocked' });
    }
  });

  it('blocks variant spellings: digits as letters or dropped, missing vowels, Turkish stems', () => {
    for (const n of ['f4ck_you', 'fck_you', 'FCK', 'phuk', 'Phuck_it', 'niga', 'n1gga', 'sikimi', 'Sikdir', 's1kerim', 'am1na', 'AM1NAKOY', 'orspu', 'Big_Sik', 'piCkurusu']) {
      expect(checkName(n), n).toEqual({ ok: false, reason: 'blocked' });
    }
  });

  it('does not block harmless words that hide short ones', () => {
    for (const n of ['Classic', 'grape_duck', 'Nazim', 'Therapist', 'Scunthorpe', 'Cocktail', 'GotYou', 'Assassin', 'peacock', 'Basik', 'Amina', 'Amina_1', 'Picasso', 'Essex',
      'Klasik', 'Isik', 'Asik', 'Kasik', 'Musik', 'Sikh', 'Sikkim', 'Sikayet', 'HeadShot', 'Manga', 'Tonga', 'Naga', 'Nigel', 'Negative', 'Enigma', 'Focus', 'Fickle', 'Phantom', 'Picnic', 'Epic_Duck', 'Gorospa']) {
      expect(checkName(n), n).toEqual({ ok: true, name: n });
    }
  });

  it('reserves staff and brand names', () => {
    for (const n of ['Admin', 'QwakkOfficial', 'qw4kk', 'Moderator1', 'mod', 'SYSTEM']) expect(checkName(n), n).toEqual({ ok: false, reason: 'reserved' });
    expect(checkName('Modern')).toEqual({ ok: true, name: 'Modern' });
  });

  it('splits names into parts on underscores and CamelCase', () => {
    expect(nameParts('BigDuck_7')).toEqual(['big', 'duck', '7']);
    expect(nameParts('ABC')).toEqual(['abc']);
  });
});
