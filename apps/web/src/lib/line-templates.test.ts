import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
  LINE_TEMPLATES,
  LineModulesSchema,
  MODULE_KEYS,
  MODULES_BY_KIND,
  modulesForLine,
} from './line-templates';

describe('LineModulesSchema', () => {
  it('accepts an ordered list of known keys and preserves order', () => {
    const r = v.safeParse(LineModulesSchema, ['notes', 'planner', 'money']);
    expect(r.success).toBe(true);
    if (r.success) expect(r.output).toEqual(['notes', 'planner', 'money']);
  });

  it('rejects unknown module keys', () => {
    const r = v.safeParse(LineModulesSchema, ['planner', 'kanban']);
    expect(r.success).toBe(false);
  });

  it('rejects duplicates', () => {
    const r = v.safeParse(LineModulesSchema, ['notes', 'notes']);
    expect(r.success).toBe(false);
  });

  it('rejects non-arrays', () => {
    expect(v.safeParse(LineModulesSchema, 'notes').success).toBe(false);
    expect(v.safeParse(LineModulesSchema, { 0: 'notes' }).success).toBe(false);
  });
});

describe('LINE_TEMPLATES', () => {
  it('every template maps to a valid module set', () => {
    for (const t of LINE_TEMPLATES) {
      const r = v.safeParse(LineModulesSchema, t.modules);
      expect(r.success, `template ${t.key}`).toBe(true);
    }
  });

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

  it('booking and fair fix kind=campaign (no fair enum value — ADR-056)', () => {
    expect(LINE_TEMPLATES.find((t) => t.key === 'booking')?.kind).toBe('campaign');
    expect(LINE_TEMPLATES.find((t) => t.key === 'fair')?.kind).toBe('campaign');
  });
});

describe('modulesForLine', () => {
  it('explicit modules win, unknown keys dropped, duplicates collapsed', () => {
    expect(
      modulesForLine({ kind: 'tour', modules: ['notes', 'bogus', 'notes', 'money'] }),
    ).toEqual(['notes', 'money']);
  });

  it('NULL modules fall back to kind defaults (pre-ADR lines need no backfill)', () => {
    // The two real pre-ADR lines: demo tour line + difusion-2026-27 (campaign).
    expect(modulesForLine({ kind: 'tour', modules: null })).toEqual(
      MODULES_BY_KIND.tour,
    );
    expect(modulesForLine({ kind: 'campaign', modules: null })).toEqual(
      MODULES_BY_KIND.campaign,
    );
    expect(modulesForLine({ kind: 'campaign', modules: null })[0]).toBe('conversations');
  });

  it('unknown kind degrades to notes-only, never crashes', () => {
    expect(modulesForLine({ kind: 'someday-enum-value', modules: null })).toEqual(['notes']);
  });

  it('every kind has defaults covering the full enum', () => {
    for (const kind of Object.keys(MODULES_BY_KIND)) {
      const mods = modulesForLine({ kind, modules: null });
      expect(mods.length).toBeGreaterThan(0);
      for (const m of mods) expect(MODULE_KEYS).toContain(m);
    }
  });
});
