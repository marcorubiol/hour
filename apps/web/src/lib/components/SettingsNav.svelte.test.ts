/**
 * Ajustes en siete secciones (ADR-156), Facetas en tres páginas (136): «Visibilidad y privacidad» y «Oficio»
 * son una sola, `space`, y los enlaces viejos caen en ella.
 */
import { describe, expect, it } from 'vitest';
import { SECTIONS, offeredSections, sectionFrom, settingsCrumbs } from './SettingsNav.svelte';

describe('sectionFrom', () => {
  it('the folded ids land on the space section', () => {
    expect(sectionFrom('privacy')).toBe('space');
    expect(sectionFrom('languages')).toBe('space');
    expect(sectionFrom('space')).toBe('space');
  });

  it('an unknown id, or one the space does not offer, lands on Profile', () => {
    expect(sectionFrom('billing')).toBe('profile');
    expect(sectionFrom(null)).toBe('profile');
    expect(sectionFrom('privacy', SECTIONS.filter((s) => s.id === 'profile'))).toBe('profile');
  });

  it('privacy and trade are one section', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual([
      'profile', 'workspaces', 'space', 'lenses', 'tags', 'facets', 'facet-packages', 'facet-people', 'mail',
    ]);
  });

  it('facets is three pages, each with its address and Facets as its crumb (136)', () => {
    expect(sectionFrom('facet-packages')).toBe('facet-packages');
    expect(sectionFrom('facet-people')).toBe('facet-people');
    const label = (key: string) => key;
    expect(settingsCrumbs('facet-people', label)).toEqual([{ label: 'settings.title' }, { label: 'settings.nav_facets' }]);
    // The menu has no groups, so a top section's crumb is only «Ajustes».
    expect(settingsCrumbs('mail', label)).toEqual([{ label: 'settings.title' }]);
  });

  it('the per-person page is offered to who manages the space only', () => {
    const ids = (role: 'owner' | 'admin' | 'member' | 'viewer' | 'guest' | null) =>
      offeredSections({ my_role: role }).map((s) => s.id);
    expect(ids('admin')).toContain('facet-people');
    expect(ids(null)).toContain('facet-people');
    expect(ids('member')).not.toContain('facet-people');
    expect(ids('member')).toContain('facet-packages');
    expect(ids('guest')).toEqual(['profile']);
  });
});
