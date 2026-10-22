import { describe, expect, it } from 'vitest';
import { DEFAULT_ORDER, parseOrden, sortByOrder, type OrderKey } from './conversation-order';

function key(id: string, over: Partial<OrderKey> = {}): OrderKey {
  return { id, unread: 0, due: null, dueAt: null, lastAt: null, title: id, nextActionAt: null, ...over };
}

const ids = (rows: OrderKey[]) => rows.map((r) => r.id);

describe('parseOrden', () => {
  it('lee los cuatro y cae en «lo que pide»', () => {
    expect(parseOrden('paso')).toBe('paso');
    expect(parseOrden('nombre')).toBe('nombre');
    expect(parseOrden('movimiento')).toBe('movimiento');
    expect(parseOrden(null)).toBe(DEFAULT_ORDER);
    expect(parseOrden('fecha')).toBe('pide');
  });
});

describe('lo que pide', () => {
  const rows = [
    key('vieja', { lastAt: '2026-10-01T10:00:00Z' }),
    key('seg-reciente', { due: 'follow_up', dueAt: '2026-10-21', lastAt: '2026-10-02T10:00:00Z' }),
    key('resp-vieja', { due: 'reply', dueAt: '2026-10-10T10:00:00Z', lastAt: '2026-10-10T10:00:00Z' }),
    key('nuevos', { unread: 2, lastAt: '2026-09-01T10:00:00Z' }),
    key('seg-vencido', { due: 'follow_up', dueAt: '2026-10-12', lastAt: '2026-10-03T10:00:00Z' }),
    key('resp-ayer', { due: 'reply', dueAt: '2026-10-20T10:00:00Z', lastAt: '2026-10-20T10:00:00Z' }),
    key('reciente', { lastAt: '2026-10-21T10:00:00Z' }),
    key('sin-nada'),
  ];
  it('no leídos; respuestas, la de ayer arriba; seguimientos, el más vencido primero; lo último', () => {
    expect(ids(sortByOrder(rows, 'pide'))).toEqual([
      'nuevos',
      'resp-ayer',
      'resp-vieja',
      'seg-vencido',
      'seg-reciente',
      'reciente',
      'vieja',
      'sin-nada',
    ]);
  });
  it('no toca la entrada', () => {
    const before = ids(rows);
    sortByOrder(rows, 'pide');
    expect(ids(rows)).toEqual(before);
  });
});

describe('los otros tres', () => {
  const rows = [
    key('b', { title: 'Sala Beckett', lastAt: '2026-10-05T10:00:00Z', nextActionAt: '2026-10-30' }),
    key('a', { title: 'àtic 22', lastAt: '2026-10-20T10:00:00Z' }),
    key('c', { title: 'Centre Cívic', lastAt: null, nextActionAt: '2026-10-24' }),
  ];
  it('movimiento: lo último primero, sin fecha al final', () => {
    expect(ids(sortByOrder(rows, 'movimiento'))).toEqual(['a', 'b', 'c']);
  });
  it('paso: el próximo paso más cercano primero, sin paso al final', () => {
    expect(ids(sortByOrder(rows, 'paso'))).toEqual(['c', 'b', 'a']);
  });
  it('nombre: sin distinguir acentos ni mayúsculas', () => {
    expect(ids(sortByOrder(rows, 'nombre'))).toEqual(['a', 'c', 'b']);
  });
});
