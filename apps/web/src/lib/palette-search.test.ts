import { describe, expect, test } from 'vitest';
import {
  SEARCH_LIMIT,
  paletteFindRows,
  paletteSearchQueryOptions,
  paletteSearchTerm,
  searchPerformanceOrder,
  type PaletteSearchResult,
} from './palette-search';

const W1 = { id: 'w1', slug: 'testing', name: 'Testing' };
const W2 = { id: 'w2', slug: 'muk-cia', name: 'MüK Cia' };
const label = (n: string) => n.toLowerCase();

function result(over: Partial<PaletteSearchResult> = {}): PaletteSearchResult {
  return { persons: [], organizations: [], conversations: [], venues: [], performances: [], bolos: [], ...over };
}

describe('paletteSearchTerm', () => {
  test('menos de dos letras no busca', () => {
    expect(paletteSearchTerm('')).toBe('');
    expect(paletteSearchTerm(' a ')).toBe('');
  });
  test('quita los metacaracteres de PostgREST y junta espacios', () => {
    expect(paletteSearchTerm('  Sala  (Beckett), 50%_* ')).toBe('Sala Beckett 50');
    expect(paletteSearchTerm('"Ana"')).toBe('Ana');
  });
  test('conserva acentos, puntos y arrobas', () => {
    expect(paletteSearchTerm('anouk.villé@x')).toBe('anouk.villé@x');
  });
});

describe('paletteSearchQueryOptions', () => {
  test('no pregunta sin texto o sin espacios', () => {
    expect(paletteSearchQueryOptions('', ['w1']).enabled).toBe(false);
    expect(paletteSearchQueryOptions('sala', []).enabled).toBe(false);
    expect(paletteSearchQueryOptions('sala', ['w1']).enabled).toBe(true);
  });
});

describe('paletteFindRows', () => {
  const base = { teamPersonIds: new Set<string>(), workspaces: [W1], spaceLabel: label, dayLabel: (iso: string) => `d${iso}` };

  test('sin respuesta, nada', () => {
    expect(paletteFindRows(undefined, base)).toEqual({
      contacts: [],
      organizations: [],
      conversations: [],
      venues: [],
      performances: [],
      bolos: [],
    });
  });

  test('un espacio con contactos y sin equipo encuentra a sus contactos', () => {
    const rows = paletteFindRows(
      result({
        persons: [
          { workspace_id: 'w1', person_id: 'p1', slug: 'ana-pi', full_name: 'Ana Pi', organization_name: 'Sala Beckett' },
          { workspace_id: 'w1', person_id: 'p2', slug: 'bo', full_name: 'Bo', organization_name: null },
        ],
      }),
      base,
    );
    expect(rows.contacts).toEqual([
      { kind: 'contact', token: 'f:person:w1:p1', name: 'Ana Pi', path: 'Sala Beckett', href: '/h/testing/person/ana-pi/' },
      { kind: 'contact', token: 'f:person:w1:p2', name: 'Bo', path: '', href: '/h/testing/person/bo/' },
    ]);
  });

  test('quien ya está en el equipo no se repite como contacto', () => {
    const rows = paletteFindRows(
      result({ persons: [{ workspace_id: 'w1', person_id: 'p1', slug: 'a', full_name: 'A', organization_name: null }] }),
      { ...base, teamPersonIds: new Set(['p1']) },
    );
    expect(rows.contacts).toEqual([]);
  });

  test('una organización abre su ficha, y sus conversaciones siguen en su grupo', () => {
    const rows = paletteFindRows(
      result({
        organizations: [
          { workspace_id: 'w1', id: 'o1', slug: 'sala-beckett', name: 'Sala Beckett', conversation_ids: ['c1'] },
          { workspace_id: 'w1', id: 'o2', slug: 'sala-russafa', name: 'Sala Russafa', conversation_ids: ['c2', 'c3'] },
          { workspace_id: 'w1', id: 'o3', slug: 'sala-co', name: 'Sala & Co', conversation_ids: [] },
        ],
        conversations: [
          { workspace_id: 'w1', id: 'c1', title: 'Sala Beckett', project_name: 'Sirena' },
          { workspace_id: 'w1', id: 'c2', title: 'Sala Russafa', project_name: null },
        ],
      }),
      base,
    );
    expect(rows.organizations.map((r) => r.href)).toEqual([
      '/h/testing/organization/sala-beckett',
      '/h/testing/organization/sala-russafa',
      '/h/testing/organization/sala-co',
    ]);
    expect(rows.conversations.map((r) => r.href)).toEqual(['/h/testing/conversation/c1', '/h/testing/conversation/c2']);
  });

  test('una conversación sin título no se lista; con proyecto, lo lleva', () => {
    const rows = paletteFindRows(
      result({
        conversations: [
          { workspace_id: 'w1', id: 'c1', title: '', project_name: null },
          { workspace_id: 'w1', id: 'c2', title: 'Teatre', project_name: 'Sirena' },
        ],
      }),
      base,
    );
    expect(rows.conversations.map((r) => [r.name, r.path])).toEqual([['Teatre', 'Sirena']]);
  });

  test('con varios espacios, el camino dice cuál; sin el espacio, no hay fila', () => {
    const rows = paletteFindRows(
      result({
        persons: [
          { workspace_id: 'w2', person_id: 'p1', slug: 'a', full_name: 'A', organization_name: null },
          { workspace_id: 'w9', person_id: 'p2', slug: 'b', full_name: 'B', organization_name: null },
        ],
      }),
      { ...base, workspaces: [W1, W2] },
    );
    expect(rows.contacts.map((r) => [r.name, r.path, r.href])).toEqual([['A', 'mük cia', '/h/muk-cia/person/a/']]);
  });

  test('una sala abre su ficha, por slug o, sin él, por id', () => {
    const rows = paletteFindRows(
      result({
        venues: [
          { workspace_id: 'w1', id: 'v1', slug: 'auditori', name: 'Auditori', city: 'Girona' },
          { workspace_id: 'w1', id: 'v2', slug: null, name: 'Nau', city: null },
        ],
      }),
      base,
    );
    expect(rows.venues).toEqual([
      { kind: 'venue', token: 'f:venue:v1', name: 'Auditori', path: 'Girona', href: '/h/testing/venue/auditori' },
      { kind: 'venue', token: 'f:venue:v2', name: 'Nau', path: '', href: '/h/testing/venue/v2' },
    ]);
  });

  test('una función abre su ficha, con su día y su proyecto; sin slug no hay a dónde ir', () => {
    const perf = { workspace_id: 'w1', status: 'confirmed', city: 'Girona', project_name: 'Obra' };
    const rows = paletteFindRows(
      result({
        performances: [
          { ...perf, id: 'p1', slug: 'girona-1', performed_at: '2026-11-14', venue_name: 'Auditori' },
          { ...perf, id: 'p2', slug: null, performed_at: '2026-11-15', venue_name: null },
        ],
      }),
      base,
    );
    expect(rows.performances).toEqual([
      {
        kind: 'performance',
        token: 'f:perf:p1',
        name: 'Auditori',
        path: 'd2026-11-14 · Obra',
        href: '/h/testing/performance/girona-1',
      },
    ]);
  });

  test('un bolo no tiene página: abre su vistazo', () => {
    const rows = paletteFindRows(
      result({ bolos: [{ workspace_id: 'w1', id: 'b1', project_id: 'pr1', venue_name: null, city: 'Lleida', project_name: 'Obra' }] }),
      base,
    );
    expect(rows.bolos).toEqual([
      { kind: 'bolo', token: 'f:bolo:b1', name: 'Lleida', path: 'Obra', href: '', peek: { kind: 'bolo', projectId: 'pr1', id: 'b1' } },
    ]);
  });

  test('una respuesta guardada de antes de salas y funciones no rompe', () => {
    const old = { persons: [], organizations: [], conversations: [] } as unknown as PaletteSearchResult;
    expect(paletteFindRows(old, base).performances).toEqual([]);
  });
});

describe('searchPerformanceOrder', () => {
  test('las que vienen primero, la más cercana; después las pasadas, la última; una vez cada una', () => {
    const r = (id: string, performed_at: string) => ({ id, performed_at });
    const out = searchPerformanceOrder(
      [r('past-old', '2026-01-01'), r('soon', '2026-11-02'), r('later', '2026-12-01'), r('past-new', '2026-10-01'), r('soon', '2026-11-02')],
      '2026-11-01',
    );
    expect(out.map((x) => x.id)).toEqual(['soon', 'later', 'past-new', 'past-old']);
  });

  test(`como mucho ${SEARCH_LIMIT}`, () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, performed_at: `2026-12-${String(i + 1).padStart(2, '0')}` }));
    expect(searchPerformanceOrder(rows, '2026-11-01')).toHaveLength(SEARCH_LIMIT);
  });
});
