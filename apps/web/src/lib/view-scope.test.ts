/**
 * «Lo mío / Todo» per space (ADR-151): the defaults by package, the choice,
 * and what each keeps on the pulse, Hoy, Ahora and the Planner.
 */
import { describe, expect, test } from 'vitest';
import { defaultViewScope, keepsVerdict, viewScopeIndex, viewScopeOf } from './view-scope';
import { buildPersonAttribution } from './people';
import { pulseRows } from './pulse';
import { agendaPoints } from './day-agenda';
import type { DateEvent, PerformanceEvent } from './month-events';

describe('the default comes from the package', () => {
  test('Mínim and Equip see theirs; Coordinació, Direcció and the owner see it all', () => {
    expect(defaultViewScope('member', 'minim')).toBe('mine');
    expect(defaultViewScope('member', 'equip')).toBe('mine');
    expect(defaultViewScope('member', 'coordinacio')).toBe('all');
    expect(defaultViewScope('admin', 'direccio')).toBe('all');
    expect(defaultViewScope('owner', 'equip')).toBe('all');
  });

  test('without a package, the role: admin and member all, viewer and guest theirs', () => {
    expect(defaultViewScope('owner', null)).toBe('all');
    expect(defaultViewScope('admin', null)).toBe('all');
    expect(defaultViewScope('member', null)).toBe('all');
    expect(defaultViewScope('viewer', null)).toBe('mine');
    expect(defaultViewScope('guest', null)).toBe('mine');
  });

  test('a role that has not arrived reads as the generous side', () => {
    expect(defaultViewScope(null, null)).toBe('all');
    expect(viewScopeOf(null)).toBe('all');
  });
});

describe('the person’s own choice wins', () => {
  test('a saved «mine» or «all» beats the package; anything else is the default', () => {
    expect(viewScopeOf({ my_role: 'owner', view_scope: 'mine' })).toBe('mine');
    expect(viewScopeOf({ my_role: 'member', my_preset: 'equip', view_scope: 'all' })).toBe('all');
    expect(viewScopeOf({ my_role: 'member', my_preset: 'equip', view_scope: 'weird' })).toBe('mine');
  });

  test('one lookup per view; an unknown space is «all»', () => {
    const of = viewScopeIndex([
      { id: 'a', my_role: 'member', my_preset: 'minim' },
      { id: 'b', my_role: 'owner' },
    ]);
    expect([of('a'), of('b'), of('c'), of(null)]).toEqual(['mine', 'all', 'all', 'all']);
  });
});

describe('what each keeps', () => {
  test('«todo» keeps the whole company; «lo mío» only what you are on; none is ADR-147', () => {
    expect(['explicit', 'unattributed', 'no'].map((v) => keepsVerdict(v as never, 'all'))).toEqual([true, true, true]);
    expect(['explicit', 'unattributed', 'no'].map((v) => keepsVerdict(v as never, 'mine'))).toEqual([true, false, false]);
    expect(['explicit', 'unattributed', 'no'].map((v) => keepsVerdict(v as never, null))).toEqual([true, true, false]);
  });
});

// Two spaces: a technician on Equip in `ws-co` (the company) and owner of
// their own `ws-me`. In each, a show they are cast on, a show of the others,
// and a rehearsal nobody said «voy» to (a company date).
const DAY = '2026-11-07';
const TZ = 'Europe/Madrid';
const proj = (id: string, ws: string) => ({ id, name: id, workspace_id: ws }) as PerformanceEvent['project'];
function perf(id: string, ws: string, cast: string[]): PerformanceEvent {
  return {
    id,
    slug: id,
    performed_at: DAY,
    status: 'confirmed',
    start_at: `${DAY}T19:00:00Z`,
    venue_name: id,
    city: null,
    country: null,
    line_id: null,
    project: proj(`pr-${ws}`, ws),
    venue: null,
    person_ids: cast,
  } as PerformanceEvent;
}
function rehearsal(id: string, ws: string): DateEvent {
  return {
    id,
    kind: 'rehearsal',
    status: 'confirmed',
    title: null,
    starts_at: `${DAY}T09:00:00Z`,
    ends_at: null,
    all_day: false,
    venue_name: null,
    city: null,
    project: proj(`pr-${ws}`, ws) as DateEvent['project'],
    venue: null,
  };
}
const team = [
  { person_id: 'me', workspace_id: 'ws-co', slug: 'me', full_name: 'Me', project_ids: ['pr-ws-co'] },
  { person_id: 'me', workspace_id: 'ws-me', slug: 'me', full_name: 'Me', project_ids: ['pr-ws-me'] },
];
const rows = {
  performances: [perf('co-mine', 'ws-co', ['me']), perf('co-theirs', 'ws-co', ['you']), perf('me-mine', 'ws-me', ['me']), perf('me-theirs', 'ws-me', ['you'])],
  dates: [rehearsal('co-reh', 'ws-co'), rehearsal('me-reh', 'ws-me')],
  viewerTz: TZ,
};

describe('per space, on the pulse’s rows (Hoy, Ahora, the rail)', () => {
  test('«lo mío» in the company, «todo» in my own space', () => {
    const axis = buildPersonAttribution({
      pinnedPersonIds: ['me'],
      team,
      viewScope: viewScopeIndex([
        { id: 'ws-co', my_role: 'member', my_preset: 'equip' },
        { id: 'ws-me', my_role: 'owner' },
      ]),
    });
    const ids = pulseRows({ ...rows, axis }).map((r) => r.row.id).sort();
    expect(ids).toEqual(['co-mine', 'me-mine', 'me-reh', 'me-theirs']);
    // Hoy's agenda reads the same rows.
    expect(new Set(agendaPoints({ ...rows, axis }, DAY).map((p) => p.ref.id))).toEqual(new Set(ids));
  });

  test('switching the company to «todo» brings its company date and the others’ show', () => {
    const axis = buildPersonAttribution({
      pinnedPersonIds: ['me'],
      team,
      viewScope: viewScopeIndex([
        { id: 'ws-co', my_role: 'member', my_preset: 'equip', view_scope: 'all' },
        { id: 'ws-me', my_role: 'owner' },
      ]),
    });
    expect(pulseRows({ ...rows, axis }).map((r) => r.row.id).sort()).toEqual([
      'co-mine',
      'co-reh',
      'co-theirs',
      'me-mine',
      'me-reh',
      'me-theirs',
    ]);
  });

  test('without the preference on the axis, ADR-147 as before', () => {
    const axis = buildPersonAttribution({ pinnedPersonIds: ['me'], team });
    expect(pulseRows({ ...rows, axis }).map((r) => r.row.id).sort()).toEqual(['co-mine', 'co-reh', 'me-mine', 'me-reh']);
  });
});
