import { describe, expect, test } from 'vitest';
import {
  annotateMoves,
  canProposeMove,
  isLateMinutes,
  lateEta,
  lateMinutesWord,
  lateLineText,
  lateMomentWord,
  nextMilestone,
  roadsheetTeam,
  type LateMove,
} from './roadsheet-late';
import { roadsheetDay } from './roadsheet-day';
import { movedEnd } from './server/collab-schedule';

describe('roadsheetDay carries the move', () => {
  test('a moved moment keeps its time before; the others nothing', () => {
    const points = roadsheetDay({
      schedule: {
        load_in_at: null,
        soundcheck_at: null,
        start_at: null,
        loadout_at: null,
        wrap_at: null,
        moments: [
          { kind: 'load_in', label: null, at: at('16:20'), ends_at: null, moved_from: at('16:00'), moved_at: at('15:50') },
          { kind: 'start', label: null, at: at('21:00'), ends_at: null },
        ],
      },
      travel: null,
    });
    expect(points[0]).toMatchObject({ of: 'moment', moved_from: at('16:00'), moved_at: at('15:50') });
    expect(points[1]).not.toHaveProperty('moved_from');
  });
});

describe('movedEnd', () => {
  test('no end, no end', () => {
    expect(movedEnd({ at: at('16:00'), ends_at: null }, at('16:20'))).toBeNull();
  });
  test('an end still after the new start stays', () => {
    expect(movedEnd({ at: at('16:00'), ends_at: at('19:00') }, at('16:20'))).toBe(at('19:00'));
  });
  test('an end the new start passes keeps the moment’s length', () => {
    expect(movedEnd({ at: at('16:00'), ends_at: at('16:15') }, at('16:20'))).toBe(at('16:35'));
  });
});

const at = (hm: string) => `2026-11-14T${hm}:00.000Z`;

describe('nextMilestone', () => {
  const moments = [
    { kind: 'load_in', label: null, at: at('14:00') },
    { kind: 'soundcheck', label: null, at: at('18:30') },
    { kind: 'start', label: null, at: at('20:00') },
  ];

  test('the first moment still ahead', () => {
    expect(nextMilestone(moments, new Date(at('15:38')))?.kind).toBe('soundcheck');
  });

  test('a moment at this very minute has already come', () => {
    expect(nextMilestone(moments, new Date(at('18:30')))?.kind).toBe('start');
  });

  test('nothing ahead, nothing to be late to', () => {
    expect(nextMilestone(moments, new Date(at('23:00')))).toBeNull();
  });

  test('by time, not by written order', () => {
    const shuffled = [moments[2]!, moments[1]!, moments[0]!];
    expect(nextMilestone(shuffled, new Date(at('10:00')))?.kind).toBe('load_in');
  });
});

describe('lateEta', () => {
  test('the moment plus the minutes', () => {
    expect(lateEta(at('16:00'), 20)).toBe(at('16:20'));
  });
  test('«No sé» or no moment: no time', () => {
    expect(lateEta(at('16:00'), null)).toBeNull();
    expect(lateEta(null, 20)).toBeNull();
  });
});

describe('isLateMinutes', () => {
  test('only the four choices', () => {
    expect([10, 20, 30, 45].every(isLateMinutes)).toBe(true);
    expect(isLateMinutes(15)).toBe(false);
    expect(isLateMinutes('20')).toBe(false);
    expect(isLateMinutes(null)).toBe(false);
  });
});

describe('canProposeMove', () => {
  const base = { can_edit: true, milestone: { kind: 'load_in', label: null, at: at('16:00') }, minutes: 20, moved_to: null };
  test('whoever edits, with a moment and minutes, not yet moved', () => {
    expect(canProposeMove(base)).toBe(true);
  });
  test('not without edit rights, a moment, minutes, or once moved', () => {
    expect(canProposeMove({ ...base, can_edit: false })).toBe(false);
    expect(canProposeMove({ ...base, milestone: null })).toBe(false);
    expect(canProposeMove({ ...base, minutes: null })).toBe(false);
    expect(canProposeMove({ ...base, moved_to: at('16:20') })).toBe(false);
  });
});

describe('annotateMoves', () => {
  const moments = [
    { kind: 'load_in', label: null, at: at('16:20'), ends_at: null },
    { kind: 'soundcheck', label: null, at: at('19:30'), ends_at: null },
  ];
  const move: LateMove = { kind: 'load_in', label: null, from: at('16:00'), to: at('16:20'), moved_at: at('15:50') };

  test('the moved moment says what it was', () => {
    const out = annotateMoves(moments, [move]);
    expect(out[0]).toMatchObject({ moved_from: at('16:00'), moved_at: at('15:50') });
    expect(out[1]).not.toHaveProperty('moved_from');
  });

  test('moving one time does not mark the others', () => {
    const out = annotateMoves(moments, [move]);
    expect(out.filter((m) => 'moved_from' in m)).toHaveLength(1);
  });

  test('a time edited again afterwards is not «cambiado» any more', () => {
    const edited = [{ ...moments[0]!, at: at('16:40') }];
    expect(annotateMoves(edited, [move])[0]).not.toHaveProperty('moved_from');
  });

  test('the same instant in another spelling still matches', () => {
    const plus = [{ ...moments[0]!, at: '2026-11-14T16:20:00+00:00' }];
    expect(annotateMoves(plus, [move])[0]).toHaveProperty('moved_from', at('16:00'));
  });

  test('the latest move of a moment wins', () => {
    const older: LateMove = { ...move, from: at('15:40'), moved_at: at('15:10') };
    expect(annotateMoves(moments, [older, move])[0]).toHaveProperty('moved_from', at('16:00'));
  });

  test('a free moment matches by its label', () => {
    const free = [{ kind: null, label: 'Photo call', at: at('17:10') }];
    const mv: LateMove = { kind: null, label: 'Photo call', from: at('17:00'), to: at('17:10'), moved_at: at('16:00') };
    expect(annotateMoves(free, [mv])[0]).toHaveProperty('moved_from', at('17:00'));
    expect(annotateMoves([{ ...free[0]!, label: 'Otra' }], [mv])[0]).not.toHaveProperty('moved_from');
  });
});

describe('roadsheetTeam', () => {
  const p = (id: string, full_name = id.toUpperCase()) => ({ id, full_name });

  test('crew first, then substitutes, then the cast nobody replaces; each person once', () => {
    const team = roadsheetTeam(
      [{ role: ' luces ', person: p('pau') }, { role: 'sonido', person: p('joan') }],
      [
        { role: 'actriz', person: p('ona') },
        { role: 'actor', person: p('marc') },
        { role: 'actor', person: p('pau') },
      ],
      [{ role: 'actor', person: p('lluc'), replaces_person: { id: 'marc' } }],
    );
    expect(team.map((m) => [m.person_id, m.kind, m.role])).toEqual([
      ['pau', 'crew', 'luces'],
      ['joan', 'crew', 'sonido'],
      ['lluc', 'cast', 'actor'],
      ['ona', 'cast', 'actriz'],
    ]);
  });

  test('a row without a person is skipped', () => {
    expect(roadsheetTeam([{ role: 'luces', person: null }], [], [])).toEqual([]);
  });
});

describe('lateLineText', () => {
  const late = {
    person_name: 'Pau Roca',
    minutes: 20,
    note: 'Tráfico',
    milestone_kind: 'load_in',
    milestone_label: null,
    milestone_at: at('15:00'),
    moved_from: null,
    moved_to: null,
  };

  test('the notice in the reader’s words', () => {
    expect(lateLineText('late_notice', late, '', 'fallback', 'es', 'UTC')).toBe(
      'Pau Roca llega tarde, unos 20 min · carga 15:00 · desde su hoja',
    );
    expect(lateLineText('late_notice', { ...late, minutes: null, milestone_at: null }, '', 'fallback', 'en', 'UTC')).toBe(
      'Pau Roca is running late · from their sheet',
    );
  });

  test('the move, with who moved it', () => {
    const moved = { ...late, moved_from: at('15:00'), moved_to: at('15:20') };
    expect(lateLineText('late_moved', moved, 'Núria', 'fallback', 'es', 'UTC')).toBe('Núria movió carga de 15:00 a 15:20');
  });

  test('without its notice, the base’s words', () => {
    expect(lateLineText('late_notice', null, '', 'Pau llega tarde', 'en', 'UTC')).toBe('Pau llega tarde');
    expect(lateLineText('late_moved', late, 'Núria', 'movió', 'es', 'UTC')).toBe('movió');
  });
});

describe('words', () => {
  test('a moment: its label, else its kind’s word', () => {
    expect(lateMomentWord({ kind: 'load_in', label: null }, 'es')).toBe('carga');
    expect(lateMomentWord({ kind: 'load_in', label: 'Montaje' }, 'es')).toBe('Montaje');
    expect(lateMomentWord({ kind: 'photo', label: null }, 'es')).toBe('photo');
  });

  test('the minutes', () => {
    expect(lateMinutesWord(20, 'es')).toBe('unos 20 min');
    expect(lateMinutesWord(45, 'es')).toBe('45 min o más');
    expect(lateMinutesWord(null, 'es')).toBe('sin saber cuánto');
  });
});
