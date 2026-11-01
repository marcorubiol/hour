/**
 * Ajustes en siete secciones (ADR-156): «Visibilidad y privacidad» y «Oficio»
 * son una sola, `space`, y los enlaces viejos caen en ella.
 */
import { describe, expect, it } from 'vitest';
import { SECTIONS, sectionFrom } from './SettingsNav.svelte';

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
    expect(SECTIONS.map((s) => s.id)).toEqual(['profile', 'workspaces', 'space', 'lenses', 'tags', 'facets', 'mail']);
  });
});
