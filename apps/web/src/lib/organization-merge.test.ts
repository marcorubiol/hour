import { describe, expect, test } from 'vitest';
import {
  orgByName,
  orgClashes,
  orgCountParts,
  orgMergeRefusal,
  orgShouldFlip,
  undoOpen,
  type ClashRow,
} from './organization-merge';

const row = (over: Partial<ClashRow>): ClashRow => ({
  id: 'c',
  organization_id: 'k',
  project_id: 'p1',
  private_to: null,
  project: { name: 'Obra' },
  ...over,
});

describe('clashes', () => {
  test('one of each in the same project, with the same privacy', () => {
    const rows = [
      row({ id: 'k1', organization_id: 'k', project_id: 'p1', project: { name: 'Bichos' } }),
      row({ id: 'd1', organization_id: 'd', project_id: 'p1', project: { name: 'Bichos' } }),
      row({ id: 'd2', organization_id: 'd', project_id: 'p2', project: { name: 'Aire' } }),
      // Private of someone on one side, shared on the other: two indexes, no clash.
      row({ id: 'k3', organization_id: 'k', project_id: 'p3', private_to: 'u1' }),
      row({ id: 'd3', organization_id: 'd', project_id: 'p3' }),
      // Private of the same person on both: a clash.
      row({ id: 'k4', organization_id: 'k', project_id: 'p4', private_to: 'u1', project: { name: 'Aire 2' } }),
      row({ id: 'd4', organization_id: 'd', project_id: 'p4', private_to: 'u1', project: { name: 'Aire 2' } }),
    ];
    expect(orgClashes(rows, 'k', 'd')).toEqual([
      { project_id: 'p4', project_name: 'Aire 2', keep_conversation_id: 'k4', drop_conversation_id: 'd4' },
      { project_id: 'p1', project_name: 'Bichos', keep_conversation_id: 'k1', drop_conversation_id: 'd1' },
    ]);
  });

  test('none when they share no project', () => {
    expect(orgClashes([row({ organization_id: 'k' }), row({ organization_id: 'd', project_id: 'p9' })], 'k', 'd')).toEqual(
      [],
    );
  });
});

describe('preview words', () => {
  test('counts that are not zero, in their order', () => {
    expect(orgCountParts({ conversations: 2, bolos: 0, contacts: 3, invoices: 1, venues: 0 })).toEqual([
      { key: 'conversations', n: 2 },
      { key: 'contacts', n: 3 },
      { key: 'invoices', n: 1 },
    ]);
  });

  test('the older one stays by default', () => {
    const side = (created_at: string) => ({ name: 'x', slug: 'x', kind: null, email: null, city: null, created_at });
    expect(orgShouldFlip({ keep: side('2026-10-05T00:00:00Z'), drop: side('2026-09-01T00:00:00Z') })).toBe(true);
    expect(orgShouldFlip({ keep: side('2026-09-01T00:00:00Z'), drop: side('2026-10-05T00:00:00Z') })).toBe(false);
  });

  test('undo is open for 30 days', () => {
    const now = new Date('2026-11-30T00:00:00Z');
    expect(undoOpen('2026-11-01T01:00:00Z', now)).toBe(true);
    expect(undoOpen('2026-10-30T00:00:00Z', now)).toBe(false);
  });
});

describe('picking by name', () => {
  const items = [
    { id: 'a', workspace_id: 'w', name: 'Teatre Principal' },
    { id: 'b', workspace_id: 'w', name: 'Teatre Principal SL' },
    { id: 'c', workspace_id: 'other', name: 'Sala Beckett' },
  ];
  test('the space, any case, never itself', () => {
    expect(orgByName(items, 'w', '  teatre principal sl ', 'a')?.id).toBe('b');
    expect(orgByName(items, 'w', 'Teatre Principal', 'a')).toBeNull();
    expect(orgByName(items, 'w', 'Sala Beckett', 'a')).toBeNull();
    expect(orgByName(items, 'w', '', 'a')).toBeNull();
  });
});

describe('refusals', () => {
  test('by the message of each RAISE', () => {
    expect(orgMergeRefusal('an organization cannot be merged with itself')).toBe('same_organization');
    expect(orgMergeRefusal('both organizations have a conversation in the same project')).toBe('project_clash');
    expect(orgMergeRefusal('merge already undone')).toBe('already_undone');
    expect(orgMergeRefusal('merge is older than 30 days')).toBe('undo_expired');
    expect(orgMergeRefusal('undo the later merge first')).toBe('later_merge');
    expect(orgMergeRefusal(null)).toBe('invalid_input');
  });
});
