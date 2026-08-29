import { describe, expect, it } from 'vitest';
import { parseDayQuery } from './day-query';

const TODAY = '2026-08-29';
const p = (q: string, today = TODAY) => parseDayQuery(q, { today, locales: ['es', 'ca', 'en'] });

describe('parseDayQuery', () => {
  it('reads an exact ISO day', () => {
    expect(p('2031-07-10')).toBe('2031-07-10');
  });

  it('reads the words for the days you can name', () => {
    expect(p('hoy')).toBe(TODAY);
    expect(p('today')).toBe(TODAY);
    expect(p('avui')).toBe(TODAY);
    expect(p('mañana')).toBe('2026-08-30');
    expect(p('tomorrow')).toBe('2026-08-30');
    expect(p('ayer')).toBe('2026-08-28');
  });

  it('reads day-first numerics, with the separators people actually type', () => {
    expect(p('3/9')).toBe('2026-09-03');
    expect(p('3-9-2031')).toBe('2031-09-03');
    expect(p('3.9.31'), 'a two-digit year is this century').toBe('2031-09-03');
  });

  it('reads a month by name in any of the three languages', () => {
    expect(p('10 sept')).toBe('2026-09-10');
    expect(p('10 de septiembre')).toBe('2026-09-10');
    expect(p('10 setembre')).toBe('2026-09-10');
    expect(p('10 september')).toBe('2026-09-10');
    expect(p('3 oct 2031')).toBe('2031-10-03');
  });

  /**
   * QUIEN ESCRIBE UNA FECHA CORTA ESTÁ PLANIFICANDO. Sin año, un día que ya
   * pasó este año es el del año que viene — mandar al usuario al pasado es la
   * respuesta menos útil de las dos posibles.
   */
  it('sends a bare date forward, never back', () => {
    expect(p('1/3'), 'March 1st has passed, so it means next year').toBe('2027-03-01');
    expect(p('29/8'), 'today itself still means today').toBe(TODAY);
    expect(p('30/8')).toBe('2026-08-30');
  });

  it('refuses a day that does not exist instead of sliding it', () => {
    expect(p('31/2')).toBeNull();
    expect(p('2026-02-31')).toBeNull();
    expect(p('32/1')).toBeNull();
  });

  it('refuses what it cannot mean exactly', () => {
    // Hay dos jueves a un salto de aquí; elegir uno por el usuario es adivinar.
    expect(p('jueves')).toBeNull();
    expect(p('thursday')).toBeNull();
    expect(p('mamemi')).toBeNull();
    expect(p('')).toBeNull();
    expect(p('10 xyz')).toBeNull();
    // Dos letras no son un mes: «ma» sería marzo y mayo a la vez.
    expect(p('10 ma')).toBeNull();
  });
});
