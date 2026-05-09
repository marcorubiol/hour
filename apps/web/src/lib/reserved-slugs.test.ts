import { describe, expect, it } from 'vitest';
import { isKnownEntity, isReservedWorkspaceSlug } from './reserved-slugs';

describe('isReservedWorkspaceSlug', () => {
  it('matches reserved router slugs', () => {
    expect(isReservedWorkspaceSlug('h')).toBe(true);
    expect(isReservedWorkspaceSlug('api')).toBe(true);
    expect(isReservedWorkspaceSlug('login')).toBe(true);
  });

  it('matches Hour product vocabulary', () => {
    expect(isReservedWorkspaceSlug('gig')).toBe(true);
    expect(isReservedWorkspaceSlug('engagement')).toBe(true);
    expect(isReservedWorkspaceSlug('roadsheet')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isReservedWorkspaceSlug('LOGIN')).toBe(true);
    expect(isReservedWorkspaceSlug('Api')).toBe(true);
  });

  it('lets non-reserved slugs through', () => {
    expect(isReservedWorkspaceSlug('marco-rubiol')).toBe(false);
    expect(isReservedWorkspaceSlug('mamemi')).toBe(false);
    expect(isReservedWorkspaceSlug('electrico-28')).toBe(false);
  });
});

describe('isKnownEntity', () => {
  it('recognises the eight entity types', () => {
    for (const e of ['room', 'run', 'gig', 'engagement', 'person', 'venue', 'asset', 'invoice']) {
      expect(isKnownEntity(e)).toBe(true);
    }
  });

  it('rejects unknown segments', () => {
    expect(isKnownEntity('roadsheet')).toBe(false); // road sheet is a projection, not an entity
    expect(isKnownEntity('show')).toBe(false); // show is internal, gig is the public name
    expect(isKnownEntity('settings')).toBe(false);
  });
});
