import { describe, expect, it } from 'vitest';
import { agendaWords, daysTo, firstDue, type OpenItem } from './agenda-missing';

const say = { when: (d: string) => `when ${d}`, toClose: (n: number) => `${n} to close`, more: (n: number) => `+${n} more` };
const it_ = (text: string, urgent: boolean, due: string): OpenItem => ({ text, urgent, due });

describe('One amber in the Agenda (ADR-236)', () => {
  const rows = [
    { id: 'a', items: [it_('sheet', true, '2026-11-25'), it_('team', false, '2026-11-25')] },
    { id: 'b', items: [it_('hold', true, '2026-11-22')] },
    { id: 'c', items: [it_('team', false, '2026-11-23')] },
  ];

  it('the first due is the earliest urgent day of all the rows', () => {
    expect(firstDue(rows)).toEqual({ id: 'b', text: 'hold', due: '2026-11-22' });
    expect(firstDue([{ id: 'c', items: rows[2].items }])).toBeNull();
  });

  it('that row says what and when in amber; the others, «N por cerrar» in grey with the dot', () => {
    const first = firstDue(rows);
    expect(agendaWords('b', rows[1].items, first, say)).toEqual([{ text: 'hold · when 2026-11-22', urgent: true }]);
    expect(agendaWords('a', rows[0].items, first, say)).toEqual([{ text: '2 to close', urgent: false, dot: true }]);
    expect(agendaWords('c', [], first, say)).toEqual([]);
  });

  it('the first due row counts what else it has open, in grey', () => {
    const first = firstDue([rows[0]]);
    expect(agendaWords('a', rows[0].items, first, say)).toEqual([
      { text: 'sheet · when 2026-11-25', urgent: true },
      { text: '+1 more', urgent: false },
    ]);
  });

  it('counts whole days', () => {
    expect(daysTo('2026-11-22', '2026-11-20')).toBe(2);
    expect(daysTo('2026-11-19', '2026-11-20')).toBe(-1);
  });
});
