import { describe, expect, it } from 'vitest';
import { organizationNames } from './organizations';

describe('organizationNames', () => {
  const items = [
    { id: '1', workspace_id: 'a', name: 'Teatro Pradillo' },
    { id: '2', workspace_id: 'b', name: 'Sala Beckett' },
    { id: '3', workspace_id: 'b', name: 'Teatro Pradillo' },
  ];
  it('all spaces when none is given, unique and sorted', () => {
    expect(organizationNames(items)).toEqual(['Sala Beckett', 'Teatro Pradillo']);
  });
  it('only the given spaces', () => {
    expect(organizationNames(items, ['a'])).toEqual(['Teatro Pradillo']);
  });
});
