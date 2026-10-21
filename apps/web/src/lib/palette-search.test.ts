import { describe, expect, test } from 'vitest';
import { paletteFindRows, paletteSearchQueryOptions, paletteSearchTerm, type PaletteSearchResult } from './palette-search';

const W1 = { id: 'w1', slug: 'testing', name: 'Testing' };
const W2 = { id: 'w2', slug: 'muk-cia', name: 'MüK Cia' };
const label = (n: string) => n.toLowerCase();

function result(over: Partial<PaletteSearchResult> = {}): PaletteSearchResult {
  return { persons: [], organizations: [], conversations: [], ...over };
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
  const base = { teamPersonIds: new Set<string>(), workspaces: [W1], spaceLabel: label };

  test('sin respuesta, nada', () => {
    expect(paletteFindRows(undefined, base)).toEqual({ contacts: [], organizations: [], conversations: [] });
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

  test('una organización con una conversación la abre, y esa no se repite', () => {
    const rows = paletteFindRows(
      result({
        organizations: [
          { workspace_id: 'w1', id: 'o1', name: 'Sala Beckett', conversation_ids: ['c1'] },
          { workspace_id: 'w1', id: 'o2', name: 'Sala Russafa', conversation_ids: ['c2', 'c3'] },
          { workspace_id: 'w1', id: 'o3', name: 'Sala & Co', conversation_ids: [] },
        ],
        conversations: [
          { workspace_id: 'w1', id: 'c1', title: 'Sala Beckett', project_name: 'Sirena' },
          { workspace_id: 'w1', id: 'c2', title: 'Sala Russafa', project_name: null },
        ],
      }),
      base,
    );
    expect(rows.organizations.map((r) => r.href)).toEqual([
      '/h/testing/conversation/c1',
      '/h/conversations?q=Sala%20Russafa',
      '/h/conversations?q=Sala%20%26%20Co',
    ]);
    expect(rows.conversations).toEqual([
      { kind: 'conversation', token: 'f:conv:c2', name: 'Sala Russafa', path: '', href: '/h/testing/conversation/c2' },
    ]);
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
});
