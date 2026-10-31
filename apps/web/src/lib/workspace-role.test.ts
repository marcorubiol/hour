import { describe, expect, test } from 'vitest';
import {
  homeWorkspace,
  isGuestIn,
  settingsSectionsFor,
  spaceWriteWorkspaces,
  taskWorkspaces,
  withMyRole,
  writesSpaceIn,
  writesTasksIn,
  type WorkspaceRole,
} from './workspace-role';

const ws = (id: string, my_role?: WorkspaceRole | null) => ({ id, slug: id, my_role });

// The technician of one night: guest of the company's space, owner of the
// personal space signup made for them.
const COMPANY = ws('muk-cia', 'guest');
const OWN = ws('mine', 'owner');

describe('a guest of a bolo writes nothing of the space', () => {
  test('no task, no availability, no project, no feed', () => {
    expect(isGuestIn(COMPANY)).toBe(true);
    expect(writesTasksIn(COMPANY)).toBe(false);
    expect(writesSpaceIn(COMPANY)).toBe(false);
  });

  test('a viewer writes tasks but makes no project; a member does both', () => {
    expect(writesTasksIn(ws('a', 'viewer'))).toBe(true);
    expect(writesSpaceIn(ws('a', 'viewer'))).toBe(false);
    expect(writesTasksIn(ws('a', 'member'))).toBe(true);
    expect(writesSpaceIn(ws('a', 'member'))).toBe(true);
  });

  test('only an explicit role narrows: unknown reads as able', () => {
    expect(isGuestIn(ws('a'))).toBe(false);
    expect(writesTasksIn(ws('a'))).toBe(true);
    expect(writesSpaceIn(ws('a', null))).toBe(true);
    expect(isGuestIn(null)).toBe(false);
  });
});

describe('a door points at a space that takes it, never at the first one', () => {
  test('the company first in the list: the task goes to their own space', () => {
    expect(taskWorkspaces([COMPANY, OWN]).map((w) => w.id)).toEqual(['mine']);
    expect(spaceWriteWorkspaces([COMPANY, OWN]).map((w) => w.id)).toEqual(['mine']);
  });

  test('only the company on screen: no door at all', () => {
    expect(taskWorkspaces([COMPANY])).toEqual([]);
    expect(spaceWriteWorkspaces([COMPANY])).toEqual([]);
  });

  test('settings without a space in the URL: their own, else the first', () => {
    expect(homeWorkspace([COMPANY, OWN])?.id).toBe('mine');
    expect(homeWorkspace([COMPANY])?.id).toBe('muk-cia');
    expect(homeWorkspace([])).toBeUndefined();
  });
});

describe('settings in a space they are a guest of', () => {
  const ALL = ['profile', 'workspaces', 'privacy', 'lenses'] as const;
  test('only the profile', () => {
    expect(settingsSectionsFor(COMPANY, ALL, ['profile'])).toEqual(['profile']);
  });
  test('anyone else, every section', () => {
    expect(settingsSectionsFor(OWN, ALL, ['profile'])).toEqual([...ALL]);
    expect(settingsSectionsFor(undefined, ALL, ['profile'])).toEqual([...ALL]);
  });
});

describe('withMyRole: the caller\'s own membership rows on each workspace', () => {
  test('a role where there is a row, null where there is none', () => {
    const items = withMyRole(
      [{ id: 'muk-cia' }, { id: 'mine' }, { id: 'other' }],
      [
        { workspace_id: 'muk-cia', workspace_role: 'guest' },
        { workspace_id: 'mine', workspace_role: 'owner' },
      ],
    );
    expect(items.map((w) => w.my_role)).toEqual(['guest', 'owner', null]);
  });

  test('the package and «lo mío / todo» ride along; absent reads as null (ADR-151)', () => {
    const items = withMyRole(
      [{ id: 'muk-cia' }, { id: 'mine' }],
      [
        { workspace_id: 'muk-cia', workspace_role: 'member', preset: 'equip', view_scope: 'all' },
        { workspace_id: 'mine', workspace_role: 'owner' },
      ],
    );
    expect(items.map((w) => [w.my_preset, w.view_scope])).toEqual([
      ['equip', 'all'],
      [null, null],
    ]);
  });
});
