import { describe, expect, test } from 'vitest';
import {
  canInvite,
  defaultPreset,
  endOfDayInTz,
  goingPersonIds,
  goingWithoutAccess,
  lastAccessDayISO,
  type BoloAccess,
} from './bolo-access';

function access(over: Partial<BoloAccess> = {}): BoloAccess {
  return {
    bolo_id: 'b',
    ends_at: null,
    can_invite: { minim: true, equip: true },
    can_extend: true,
    members: [],
    invitations: [],
    readers: [],
    ...over,
  };
}

const going = [
  { person_id: 'laia', name: 'Laia' },
  { person_id: 'pau', name: 'Pau' },
  { person_id: 'clara', name: 'Clara' },
];

describe('goingWithoutAccess', () => {
  test('quien va y no lee el tablón, sin invitación pendiente', () => {
    const a = access({
      readers: ['laia'],
      invitations: [{ id: 'i', email: 'p@x.test', preset: 'equip', person_id: 'pau', invited_by: null, expires_at: '' }],
    });
    expect(goingWithoutAccess(going, a).map((p) => p.person_id)).toEqual(['clara']);
  });

  test('una membresía de bolo viva cuenta como lectura; una caducada, no', () => {
    const member = (person_id: string, live: boolean) => ({
      membership_id: person_id,
      user_id: person_id,
      person_id,
      name: person_id,
      preset: 'equip',
      ends_at: null,
      expires_with_bolo: true,
      live,
      can_manage: true,
    });
    const a = access({ members: [member('laia', true), member('pau', false)] });
    expect(goingWithoutAccess(going, a).map((p) => p.person_id)).toEqual(['pau', 'clara']);
  });

  test('sin poder invitar, o sin readers, no se propone nada', () => {
    expect(goingWithoutAccess(going, access({ can_invite: { minim: false, equip: false } }))).toEqual([]);
    expect(goingWithoutAccess(going, access({ readers: undefined }))).toEqual([]);
    expect(goingWithoutAccess(going, null)).toEqual([]);
  });

  test('no repite a nadie', () => {
    expect(goingWithoutAccess([...going, going[0]!], access()).map((p) => p.person_id)).toEqual(['laia', 'pau', 'clara']);
  });
});

describe('goingPersonIds', () => {
  test('reparto más «voy» menos «no voy»', () => {
    expect(
      goingPersonIds(['laia', 'pau'], [
        { person_id: 'clara', state: 'going' },
        { person_id: 'pau', state: 'not_going' },
      ]),
    ).toEqual(['laia', 'clara']);
  });
});

describe('paquete y permisos', () => {
  test('Equip si se puede dar; si no, Mínim', () => {
    expect(defaultPreset(access())).toBe('equip');
    expect(defaultPreset(access({ can_invite: { minim: true, equip: false } }))).toBe('minim');
    expect(canInvite(access({ can_invite: { minim: false, equip: false } }))).toBe(false);
  });
});

describe('fechas de acceso', () => {
  test('el último día es el anterior al instante en que acaba, en la zona', () => {
    // 2027-04-13 00:00 en Madrid (CEST) = 2027-04-12T22:00Z: último día, el 12.
    expect(lastAccessDayISO('2027-04-12T22:00:00Z', 'Europe/Madrid')).toBe('2027-04-12');
  });

  test('ampliar hasta un día: acaba al empezar el siguiente en la zona', () => {
    expect(endOfDayInTz('2027-04-12', 'Europe/Madrid')).toBe('2027-04-12T22:00:00.000Z');
    expect(endOfDayInTz('2027-01-31', 'Europe/Madrid')).toBe('2027-01-31T23:00:00.000Z');
    expect(endOfDayInTz('2027-02-30', 'Europe/Madrid')).toBeNull();
    expect(endOfDayInTz('nope', 'Europe/Madrid')).toBeNull();
  });

  test('ida y vuelta', () => {
    const end = endOfDayInTz('2027-10-31', 'Europe/Madrid')!;
    expect(lastAccessDayISO(end, 'Europe/Madrid')).toBe('2027-10-31');
  });
});
