import { describe, expect, it } from 'vitest';
import { LINE_TEMPLATES, MODULE_KEYS, MODULES_BY_KIND, moduleLabel, modulesForKind } from './line-templates';

describe('LINE_TEMPLATES', () => {
  it('ships the six ADR-056 templates', () => {
    expect(LINE_TEMPLATES.map((t) => t.key)).toEqual([
      'tour',
      'booking',
      'creation',
      'press',
      'fair',
      'blank',
    ]);
  });

  it('booking and fair fix kind=campaign (no fair enum value, ADR-056)', () => {
    expect(LINE_TEMPLATES.find((t) => t.key === 'booking')?.kind).toBe('campaign');
    expect(LINE_TEMPLATES.find((t) => t.key === 'fair')?.kind).toBe('campaign');
  });

  it('a template carries no module list of its own: the kind decides (ADR-166)', () => {
    for (const t of LINE_TEMPLATES) expect(t).not.toHaveProperty('modules');
  });
});

describe('modulesForKind (ADR-166)', () => {
  it('a kind always draws the same modules, in the same order', () => {
    expect(modulesForKind('tour')).toEqual([
      'planner',
      'tasks',
      'roadsheets',
      'team',
      'money',
      'materials',
      'notes',
    ]);
    expect(modulesForKind('campaign')).toEqual(['conversations', 'planner', 'tasks', 'materials', 'notes']);
    expect(modulesForKind('creation')).toEqual(['planner', 'tasks', 'notes', 'materials', 'money']);
  });

  it('unknown kind degrades to notes-only, never crashes', () => {
    expect(modulesForKind('someday-enum-value')).toEqual(['notes']);
  });

  it('every kind has modules, all known and none twice', () => {
    for (const kind of Object.keys(MODULES_BY_KIND)) {
      const mods = modulesForKind(kind);
      expect(mods.length).toBeGreaterThan(0);
      expect(new Set(mods).size).toBe(mods.length);
      for (const m of mods) expect(MODULE_KEYS).toContain(m);
    }
  });
});

describe('moduleLabel and the trade of the line (tarea 142)', () => {
  it('a line of a music space says its word, whatever the screen speaks', () => {
    expect(moduleLabel('conversations', 'es', 'music')).toBe('Contratación');
    expect(moduleLabel('conversations', 'es', 'stage')).toBe('Difusión');
    expect(moduleLabel('planner', 'es', 'music')).toBe(moduleLabel('planner', 'es', 'stage'));
  });
});
