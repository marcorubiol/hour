import { describe, expect, test } from 'vitest';
import { columnHasContent, copyCandidates, mergeColumn, mergeSchedule, shiftSchedule } from './performance-copy';

describe('mergeColumn', () => {
  test('into an empty column, the source whole', () => {
    expect(mergeColumn(null, { PA: '2 x 12' }, 'fill')).toEqual({ PA: '2 x 12' });
    expect(mergeColumn({}, { PA: '2 x 12' }, 'fill')).toEqual({ PA: '2 x 12' });
  });

  test('fill keeps what the destination says and adds what it lacks', () => {
    expect(mergeColumn({ PA: 'propia' }, { PA: '2 x 12', Luces: '24 canales' }, 'fill')).toEqual({
      PA: 'propia',
      Luces: '24 canales',
    });
  });

  test('fill with nothing new writes nothing', () => {
    expect(mergeColumn({ PA: 'propia' }, { PA: '2 x 12' }, 'fill')).toBeNull();
  });

  test('replace takes the source', () => {
    expect(mergeColumn({ PA: 'propia', Otro: 'x' }, { PA: '2 x 12' }, 'replace')).toEqual({ PA: '2 x 12' });
  });

  test('an empty source writes nothing', () => {
    expect(mergeColumn({ PA: 'propia' }, {}, 'replace')).toBeNull();
    expect(mergeColumn({ PA: 'propia' }, null, 'replace')).toBeNull();
  });

  test('content means an object with keys', () => {
    expect(columnHasContent({})).toBe(false);
    expect(columnHasContent(null)).toBe(false);
    expect(columnHasContent({ a: 1 })).toBe(true);
  });
});

describe('shiftSchedule', () => {
  const from = { day: '2026-10-10', tz: 'Europe/Madrid' };

  test('the same wall-clock hours on the new day, past midnight included', () => {
    const out = shiftSchedule(
      [
        { kind: 'show', label: null, at: '2026-10-10T18:00:00.000Z', ends_at: '2026-10-10T19:30:00.000Z', notes: 'n' },
        { kind: 'loadout', label: null, at: '2026-10-10T22:30:00.000Z', ends_at: null, notes: null },
      ],
      from,
      { day: '2026-11-20', tz: 'Europe/Madrid' },
    );
    // 20:00 CEST → 20:00 CET; 00:30 the next day stays the next day.
    expect(out.map((s) => s.at)).toEqual(['2026-11-20T19:00:00.000Z', '2026-11-20T23:30:00.000Z']);
    expect(out[0].ends_at).toBe('2026-11-20T20:30:00.000Z');
    expect(out[0].notes).toBe('n');
    expect(out[0].id).toBeUndefined();
  });

  test('into another zone, the hour of the destination', () => {
    const out = shiftSchedule(
      [{ kind: 'show', label: null, at: '2026-10-10T18:00:00.000Z', ends_at: null, notes: null }],
      from,
      { day: '2026-10-12', tz: 'Europe/London' },
    );
    expect(out[0].at).toBe('2026-10-12T19:00:00.000Z');
  });
});

describe('mergeSchedule', () => {
  const a = { id: 'a', kind: 'show', label: null, at: '2026-11-20T19:00:00.000Z', ends_at: null, notes: null };
  const b = { kind: 'load_in', label: null, at: '2026-11-20T12:00:00.000Z', ends_at: null, notes: null };

  test('fill keeps the moments there and adds the missing in time order', () => {
    expect(mergeSchedule([a], [{ ...a, id: undefined }, b], 'fill')).toEqual([b, a]);
  });

  test('fill with nothing new writes nothing', () => {
    expect(mergeSchedule([a], [{ ...a, id: undefined }], 'fill')).toBeNull();
  });

  test('replace takes the copy', () => {
    expect(mergeSchedule([a], [b], 'replace')).toEqual([b]);
  });
});

describe('copyCandidates', () => {
  const p = (id: string, project_id: string, day: string, status = 'confirmed') => ({
    id,
    slug: id,
    performed_at: day,
    project_id,
    venue_name: null,
    city: null,
    status,
  });

  test('this project first, nearest day first; never itself or a cancelled one', () => {
    const { project, others } = copyCandidates(
      [
        p('self', 'P', '2026-11-20'),
        p('far', 'P', '2026-01-01'),
        p('near', 'P', '2026-11-18'),
        p('gone', 'P', '2026-11-19', 'cancelled'),
        p('other', 'Q', '2026-11-21'),
        p('near', 'P', '2026-11-18'),
      ],
      { id: 'self', project_id: 'P', performed_at: '2026-11-20' },
    );
    expect(project.map((x) => x.id)).toEqual(['near', 'far']);
    expect(others.map((x) => x.id)).toEqual(['other']);
  });
});
