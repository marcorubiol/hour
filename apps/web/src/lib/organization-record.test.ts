import { describe, expect, test } from 'vitest';
import { isSolo, needsKind, orgBolos, orgContacts, orgMissing, type OrgConversationContact, type OrgStaff } from './organization-record';
import type { ConversationBolo } from './conversation-relation';

const TODAY = '2026-11-01';

function contact(over: Partial<OrgConversationContact> & { person_id: string; name?: string }): OrgConversationContact {
  const { name, ...rest } = over;
  return {
    role: null,
    since: null,
    until: null,
    is_primary: false,
    person: { slug: over.person_id, full_name: name ?? over.person_id, email: null, phone: null },
    ...rest,
  };
}

function bolo(over: Partial<ConversationBolo> & { bolo_id: string }): ConversationBolo {
  return {
    conversation_id: 'c1',
    project_id: 'p1',
    line_id: null,
    status: 'confirmed',
    venue_name: null,
    city: null,
    country: null,
    function_count: 1,
    first_performed_at: null,
    last_performed_at: null,
    performance_slug: null,
    ...over,
  };
}

describe('orgContacts', () => {
  test('una persona una vez, aunque sea contacto de dos conversaciones', () => {
    const out = orgContacts(
      [contact({ person_id: 'marta', role: 'Programadora', is_primary: true }), contact({ person_id: 'marta' })],
      [],
      TODAY,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ role: 'Programadora', primary: true, until: null });
  });

  test('quien sigue va delante, el principal primero; quien se fue, detrás y con su último día', () => {
    const out = orgContacts(
      [
        contact({ person_id: 'ines', name: 'Inés', until: '2024-06-30' }),
        contact({ person_id: 'jordi', name: 'Jordi' }),
        contact({ person_id: 'marta', name: 'Marta', is_primary: true }),
        contact({ person_id: 'anna', name: 'Anna', until: '2025-01-15' }),
      ],
      [],
      TODAY,
    );
    expect(out.map((c) => c.name)).toEqual(['Marta', 'Jordi', 'Anna', 'Inés']);
    expect(out.at(-1)!.until).toBe('2024-06-30');
  });

  test('sigue si sigue en alguna conversación; si no, cuenta el día más tardío', () => {
    const still = orgContacts(
      [contact({ person_id: 'x', until: '2024-01-01' }), contact({ person_id: 'x', role: 'Técnico' })],
      [],
      TODAY,
    );
    expect(still[0]).toMatchObject({ until: null, role: 'Técnico' });
    const gone = orgContacts(
      [contact({ person_id: 'x', until: '2024-01-01' }), contact({ person_id: 'x', until: '2025-03-01' })],
      [],
      TODAY,
    );
    expect(gone[0]!.until).toBe('2025-03-01');
  });

  test('un fin de hoy o futuro aún es vigente', () => {
    expect(orgContacts([contact({ person_id: 'x', until: TODAY })], [], TODAY)[0]!.until).toBeNull();
  });

  test('el dossier que dice que trabaja ahí la suma, con su cargo, y la mantiene vigente', () => {
    const staff: OrgStaff[] = [
      { person_id: 'pau', slug: 'pau', full_name: 'Pau', title: 'Director', email: null, phone: '600' },
      { person_id: 'ines', slug: 'ines', full_name: 'Inés', title: 'Gerente', email: null, phone: null },
    ];
    const out = orgContacts([contact({ person_id: 'ines', name: 'Inés', until: '2024-06-30' })], staff, TODAY);
    expect(out.find((c) => c.name === 'Pau')).toMatchObject({ role: 'Director', reach: '600', reachHref: 'tel:600' });
    expect(out.find((c) => c.name === 'Inés')).toMatchObject({ until: null, role: 'Gerente' });
  });

  test('el correo antes que el teléfono; una fila sin persona legible no cuenta', () => {
    const out = orgContacts(
      [
        { ...contact({ person_id: 'm' }), person: { slug: 'm', full_name: 'M', email: 'm@x.cat', phone: '1' } },
        { ...contact({ person_id: 'hidden' }), person: null },
      ],
      [],
      TODAY,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ reach: 'm@x.cat', reachHref: 'mailto:m@x.cat' });
  });
});

describe('orgBolos', () => {
  test('los que vienen, el más cercano primero; después los pasados, el último primero; sin fecha al final', () => {
    const out = orgBolos(
      [
        bolo({ bolo_id: 'old', first_performed_at: '2024-02-01T20:00:00Z' }),
        bolo({ bolo_id: 'far', first_performed_at: '2027-05-01T20:00:00Z' }),
        bolo({ bolo_id: 'none' }),
        bolo({ bolo_id: 'near', first_performed_at: '2026-12-01T20:00:00Z' }),
        bolo({ bolo_id: 'recent', first_performed_at: '2025-11-22T20:00:00Z' }),
      ],
      TODAY,
    );
    expect(out.map((b) => b.bolo_id)).toEqual(['near', 'far', 'recent', 'old', 'none']);
  });

  test('una gira en curso cuenta como lo que viene; un cancelado no sale', () => {
    const out = orgBolos(
      [
        bolo({ bolo_id: 'tour', first_performed_at: '2026-10-20T20:00:00Z', last_performed_at: '2026-11-10T20:00:00Z' }),
        bolo({ bolo_id: 'gone', status: 'cancelled', first_performed_at: '2026-12-01T20:00:00Z' }),
      ],
      TODAY,
    );
    expect(out.map((b) => b.bolo_id)).toEqual(['tour']);
  });
});

describe('orgMissing', () => {
  const live = [bolo({ bolo_id: 'b' })];

  test('pide los fiscales si paga un bolo vivo y quien mira puede escribirlos', () => {
    expect(orgMissing({ conversations: [], bolos: live, fiscal: { has: false, canEdit: true }, today: TODAY })).toEqual([
      { kind: 'fiscal' },
    ]);
  });

  test('no los pide sin bolo, con fiscales, sin permiso o mientras no se sabe', () => {
    const base = { conversations: [], today: TODAY };
    expect(orgMissing({ ...base, bolos: [], fiscal: { has: false, canEdit: true } })).toEqual([]);
    expect(orgMissing({ ...base, bolos: [bolo({ bolo_id: 'x', status: 'cancelled' })], fiscal: { has: false, canEdit: true } })).toEqual([]);
    expect(orgMissing({ ...base, bolos: live, fiscal: { has: true, canEdit: true } })).toEqual([]);
    expect(orgMissing({ ...base, bolos: live, fiscal: { has: false, canEdit: false } })).toEqual([]);
    expect(orgMissing({ ...base, bolos: live, fiscal: null })).toEqual([]);
  });

  test('después los pasos vencidos, el más antiguo primero, y tres como mucho', () => {
    const conversations = ['2026-10-30', '2026-10-01', '2026-10-15', '2026-11-20'].map((d, i) => ({
      id: `c${i}`,
      relation: 'talking',
      next_action_at: d,
    }));
    const out = orgMissing({ conversations, bolos: live, fiscal: { has: false, canEdit: true }, today: TODAY });
    expect(out).toEqual([
      { kind: 'fiscal' },
      { kind: 'step_due', conversationId: 'c1', day: '2026-10-01' },
      { kind: 'step_due', conversationId: 'c2', day: '2026-10-15' },
    ]);
  });
});

describe('pedir el tipo (115)', () => {
  test('se pide sin tipo o con «otra», nunca a una «por libre»', () => {
    expect(needsKind({ kind: null, solo: false })).toBe(true);
    expect(needsKind({ kind: 'other', solo: false })).toBe(true);
    expect(needsKind({ kind: 'theatre', solo: false })).toBe(false);
    expect(needsKind({ kind: null, solo: true })).toBe(false);
    expect(needsKind(null)).toBe(false);
  });
  test('«por libre»: el tipo dicho, o una sola persona que se llama como ella', () => {
    expect(isSolo({ name: 'Marta Vidal', kind: 'other' }, [{ full_name: ' marta vidal ' }])).toBe(true);
    expect(isSolo({ name: 'Marta Vidal Produccions', kind: 'other' }, [{ full_name: 'Marta Vidal' }])).toBe(false);
    expect(isSolo({ name: 'Marta Vidal', kind: 'other' }, [{ full_name: 'Marta Vidal' }, { full_name: 'Pau' }])).toBe(false);
    expect(isSolo({ name: 'La Nau', kind: 'solo' }, [])).toBe(true);
  });
});
