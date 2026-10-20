import { describe, expect, it } from 'vitest';
import { CALM_FOCUS, plannerCalmFacts, railNextShows, shows, type CalmLens } from './calm';

describe('calm as focus (ADR-139 § 5): what each lens keeps', () => {
  it('outside calm every block of every lens is drawn: the normal mode does not change', () => {
    for (const lens of Object.keys(CALM_FOCUS) as CalmLens[])
      for (const block of Object.keys(CALM_FOCUS[lens]))
        expect(shows(lens, block as never, false), `${lens}.${block}`).toBe(true);
  });

  it('Hoy keeps the next thing and today; the overdue, the week, the season and the changes fold', () => {
    const kept = Object.entries(CALM_FOCUS.desk).filter(([, v]) => v).map(([k]) => k);
    expect(kept).toEqual(['next', 'waiting_today']);
  });

  it('the Planner keeps what is confirmed and what you have to decide; options, bands and lists fold', () => {
    expect(shows('planner', 'decide', true)).toBe(true);
    expect(shows('planner', 'confirmed', true)).toBe(true);
    for (const b of ['options', 'blackouts', 'census', 'legend', 'season_lists', 'week_options'] as const)
      expect(shows('planner', b, true), b).toBe(false);
  });

  it('Conversaciones keeps «Te toca» and the way to add one; Cuentas one figure and «Pide atención»', () => {
    expect(Object.entries(CALM_FOCUS.conversations).filter(([, v]) => v).map(([k]) => k)).toEqual(['due', 'add']);
    expect(Object.entries(CALM_FOCUS.books).filter(([, v]) => v).map(([k]) => k)).toEqual(['inflow_figure', 'attention']);
  });

  it('every lens keeps something and folds something: calm is never empty, never a no-op', () => {
    for (const lens of Object.keys(CALM_FOCUS) as CalmLens[]) {
      const values = Object.values(CALM_FOCUS[lens]) as boolean[];
      expect(values.some(Boolean), lens).toBe(true);
      expect(values.some((v) => !v), lens).toBe(true);
    }
  });

  it('the Planner line counts a bounded window and only names a growing one', () => {
    const stats = { confirmed: 4, holds: 3 };
    expect(plannerCalmFacts('month', stats)).toEqual({ confirmed: 4, options: 3 });
    expect(plannerCalmFacts('overview', stats)).toEqual({ confirmed: 4, options: 3 });
    for (const v of ['day', 'agenda', 'board'] as const)
      expect(plannerCalmFacts(v, stats)).toEqual({ confirmed: null, options: null });
  });

  it('the rail\'s «Siguiente» keeps only what is confirmed in calm, and everything outside it', () => {
    for (const f of ['confirmed', 'hold', 'proposed', 'released'] as const)
      expect(railNextShows(f, false), f).toBe(true);
    expect(railNextShows('confirmed', true)).toBe(true);
    for (const f of ['hold', 'proposed', 'released'] as const) expect(railNextShows(f, true), f).toBe(false);
  });
});
