import { describe, expect, test } from 'vitest';
import { listPageArgs, type ListPageQuery } from './conversation-list';

const BASE: ListPageQuery = {
  projectIds: [],
  workspaceIds: [],
  tag: null,
  q: null,
  filter: {},
  lineIds: [],
  orden: 'pide',
  limit: 50,
  offset: 0,
};

describe('listPageArgs', () => {
  test('the list with nothing else: what is not asked does not travel', () => {
    expect(listPageArgs(BASE)).toEqual({ p_list: true, p_order: 'pide', p_limit: 50, p_offset: 0 });
  });

  test('every filter maps to its parameter', () => {
    expect(
      listPageArgs({
        ...BASE,
        projectIds: ['p'],
        workspaceIds: ['w'],
        tag: 'press',
        q: 'salt',
        filter: { relacion: 'talking', linea: 'sin', temporada: true, turno: 'nuestro', temp: 'fria', envio: 'm', r: 'rebotes' },
        lineIds: ['l1'],
        orden: 'nombre',
        offset: 100,
        idsOnly: true,
      }),
    ).toEqual({
      p_project_ids: ['p'],
      p_workspace_ids: ['w'],
      p_tag: 'press',
      p_q: 'salt',
      p_list: true,
      p_order: 'nombre',
      p_limit: 50,
      p_offset: 100,
      p_relation: 'talking',
      p_line: 'sin',
      p_season: true,
      p_season_line_ids: ['l1'],
      p_turn: 'nuestro',
      p_temp: 'fria',
      p_mailout_id: 'm',
      p_mailout_pick: 'rebotes',
      p_ids_only: true,
    });
  });

  test('a mailout without a pick is everyone who got it; the pinned lines only go with the season', () => {
    const args = listPageArgs({ ...BASE, filter: { envio: 'm' }, lineIds: ['l1'] });
    expect(args).toMatchObject({ p_mailout_id: 'm', p_mailout_pick: 'todos' });
    expect(args).not.toHaveProperty('p_season_line_ids');
    expect(args).not.toHaveProperty('p_season');
  });
});
