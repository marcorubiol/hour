/**
 * La línea que entiende texto (ADR-139 § 3): frases reales de una compañía,
 * en cuatro idiomas, las ambigüedades y lo que se fija a mano.
 *
 * Hoy, en todos los casos salvo los de zona horaria, es el miércoles
 * 21-10-2026 en Madrid.
 */
import { describe, expect, it } from 'vitest';
import { NO_HAND, applyLine, parseLine, type KnownPlace, type LineOptions } from './quick-line';
import { freshDraft, type QuickType } from './quick-add';

const NOW = new Date('2026-10-21T10:00:00Z'); // miércoles
const TZ = 'Europe/Madrid';
const read = (text: string, type: QuickType = 'performance', over: Partial<LineOptions> = {}) =>
  parseLine(text, { now: NOW, tz: TZ, type, ...over });
/** Only what was read, for a compact expectation. */
const said = (text: string, type: QuickType = 'performance', over: Partial<LineOptions> = {}) => {
  const p = read(text, type, over);
  const o: Record<string, unknown> = {};
  for (const k of ['type', 'day', 'until', 'start', 'end', 'venue', 'city', 'origin', 'direction'] as const) {
    if (p[k] !== null) o[k] = p[k];
  }
  o.title = p.title;
  return o;
};

describe('the five lines of the brief', () => {
  it('«ensayo jue 10-14 Mercat»', () => {
    expect(said('ensayo jue 10-14 Mercat')).toEqual({
      type: 'rehearsal',
      day: '2026-10-22',
      start: '10:00',
      end: '14:00',
      venue: 'Mercat',
      title: '',
    });
  });

  it('«función 14 nov 20h Girona»: a performance takes no hour, said; Girona is its line', () => {
    const p = read('función 14 nov 20h Girona', 'rehearsal');
    expect(p).toMatchObject({ type: 'performance', day: '2026-11-14', start: null, title: 'Girona', unused: ['20h'] });
  });

  it('«función 14 nov 20h Girona» with Girona known as a city', () => {
    const places: KnownPlace[] = [{ venue: 'Teatre Municipal', city: 'Girona' }];
    expect(said('función 14 nov 20h Girona', 'rehearsal', { places })).toEqual({
      type: 'performance',
      day: '2026-11-14',
      city: 'Girona',
      title: '',
    });
  });

  it('«viaje BCN → Madrid vie»', () => {
    expect(said('viaje BCN → Madrid vie')).toEqual({
      type: 'travel_day',
      day: '2026-10-23',
      origin: 'BCN',
      city: 'Madrid',
      title: '',
    });
  });

  it('«day off 3-5 dic»', () => {
    expect(said('day off 3-5 dic')).toEqual({ type: 'day_off', day: '2026-12-03', until: '2026-12-05', title: '' });
  });

  it('«prensa mañana 12h»', () => {
    expect(said('prensa mañana 12h')).toEqual({ type: 'press', day: '2026-10-22', start: '12:00', title: '' });
  });
});

describe('the type', () => {
  it('reads it in four languages', () => {
    expect(read('assaig dijous').type).toBe('rehearsal');
    expect(read('rehearsal thu').type).toBe('rehearsal');
    expect(read('répétition jeudi').type).toBe('rehearsal');
    expect(read('bolo 14 nov', 'rehearsal').type).toBe('performance');
    expect(read('concert 14 nov', 'rehearsal').type).toBe('performance');
    expect(read('viatge dv').type).toBe('travel_day');
    expect(read('voyage vendredi').type).toBe('travel_day');
    expect(read('residència 16-19 nov').type).toBe('residency');
    expect(read('premsa demà 12h').type).toBe('press');
    expect(read('presse demain 12h').type).toBe('press');
    expect(read('dia lliure dilluns').type).toBe('day_off');
    expect(read('jour off lundi').type).toBe('day_off');
    expect(read('relâche lundi').type).toBe('day_off');
    expect(read('no disponible 3-5 dic').type).toBe('unavailable');
  });

  it('is the first word that is not a date, and only one', () => {
    expect(said('jue ensayo 10h')).toMatchObject({ type: 'rehearsal', day: '2026-10-22', title: '' });
    expect(said('Ensayo general jue 10h')).toMatchObject({ type: 'rehearsal', title: 'general' });
    // A type word later in the line is title.
    const later = said('Lectura del ensayo jue', 'rehearsal');
    expect(later).not.toHaveProperty('type');
    expect(later.title).toBe('Lectura del ensayo');
  });

  it('none named: the dialog keeps its own, and the line is the title', () => {
    expect(said('Teatre Lliure', 'performance')).toEqual({ title: 'Teatre Lliure' });
  });

  it('a type fixed by hand is not read: the word stays in the title', () => {
    const p = read('Ensayo abierto jue 19h', 'other', { keep: { type: true } });
    expect(p).toMatchObject({ type: null, day: '2026-10-22', start: '19:00', title: 'Ensayo abierto' });
  });
});

describe('days', () => {
  it('today, tomorrow, the day after, in four languages', () => {
    for (const w of ['hoy', 'avui', 'today', "aujourd'hui"]) expect(read(`ensayo ${w}`).day, w).toBe('2026-10-21');
    for (const w of ['mañana', 'demà', 'tomorrow', 'demain']) expect(read(`ensayo ${w}`).day, w).toBe('2026-10-22');
    for (const w of ['pasado mañana', 'demà passat', 'day after tomorrow', 'après-demain']) {
      expect(read(`ensayo ${w}`).day, w).toBe('2026-10-23');
    }
  });

  it('«por la mañana» is the morning, not tomorrow', () => {
    expect(read('ensayo jue por la mañana').day).toBe('2026-10-22');
  });

  it('a weekday is the next one, today included', () => {
    expect(read('ensayo miércoles').day).toBe('2026-10-21');
    expect(read('ensayo dimecres').day).toBe('2026-10-21');
    expect(read('ensayo lun').day).toBe('2026-10-26');
    expect(read('ensayo dilluns').day).toBe('2026-10-26');
    expect(read('ensayo monday').day).toBe('2026-10-26');
    expect(read('ensayo lundi').day).toBe('2026-10-26');
    expect(read('ensayo dg').day).toBe('2026-10-25');
  });

  it('«próximo miércoles» is not today', () => {
    expect(read('ensayo próximo miércoles').day).toBe('2026-10-28');
    expect(read('rehearsal next wed').day).toBe('2026-10-28');
  });

  it('«el 14» is the next 14th; «el 30» still this month', () => {
    expect(read('ensayo el 14').day).toBe('2026-11-14');
    expect(read('ensayo el 30').day).toBe('2026-10-30');
    expect(read('rehearsal the 14th').day).toBe('2026-11-14');
    expect(read('répétition le 14').day).toBe('2026-11-14');
  });

  it('a bare number alone is not a day: it stays title', () => {
    expect(said('Sala 2', 'rehearsal')).toEqual({ title: 'Sala 2' });
  });

  it('day and month, either order, with or without «de»', () => {
    expect(read('función 14 nov').day).toBe('2026-11-14');
    expect(read('función 14 de noviembre').day).toBe('2026-11-14');
    expect(read('funció 14 de novembre').day).toBe('2026-11-14');
    expect(read("funció 1r de setembre").day).toBe('2027-09-01');
    expect(read("funció 12 d'octubre").day).toBe('2026-10-12');
    expect(read('concert nov 14').day).toBe('2026-11-14');
    expect(read('concert November 14th').day).toBe('2026-11-14');
    expect(read('représentation 14 novembre').day).toBe('2026-11-14');
    expect(read('función 1r de desembre').day).toBe('2026-12-01');
  });

  it('a weekday with its number: the number decides', () => {
    expect(read('función sáb 14 nov').day).toBe('2026-11-14');
    expect(read('función vendredi 14 novembre').day).toBe('2026-11-14');
    expect(read('ensayo jue 29').day).toBe('2026-10-29');
  });

  it('years: written, or the next time that day comes', () => {
    expect(read('función 14 nov 2027').day).toBe('2027-11-14');
    expect(read('función 14 de noviembre de 2027').day).toBe('2027-11-14');
    expect(read('función 3 ene').day).toBe('2027-01-03');
    // Gone less than 30 days ago: still this year (writing down last week).
    expect(read('función 14 oct').day).toBe('2026-10-14');
    // Gone longer: next year.
    expect(read('función 10 sep').day).toBe('2027-09-10');
  });

  it('numeric: day/month, and ISO', () => {
    expect(read('función 14/11').day).toBe('2026-11-14');
    expect(read('función 14/11/2027').day).toBe('2027-11-14');
    expect(read('función 14/11/27').day).toBe('2027-11-14');
    expect(read('función 2026-11-14').day).toBe('2026-11-14');
    expect(read('función 14.11.2026').day).toBe('2026-11-14');
  });

  it('an impossible day is not a day', () => {
    expect(read('función 31 nov').day).toBeNull();
    expect(read('función 30/02').day).toBeNull();
  });

  it('the 29th of February in a leap year', () => {
    expect(read('función 29 feb').day).toBe('2028-02-29');
  });

  it('only the first day is read; a second stays in the title, in sight', () => {
    expect(said('ensayo jue y vie', 'rehearsal')).toMatchObject({ day: '2026-10-22', title: 'y vie' });
  });
});

describe('spans of days', () => {
  it('«3-5 dic», «3 al 5 de diciembre», «del 3 al 5 dic», «du 3 au 5 décembre»', () => {
    for (const s of ['3-5 dic', '3–5 dic', '3 al 5 de diciembre', 'del 3 al 5 dic', 'du 3 au 5 décembre', '3 to 5 dec', 'dec 3-5', 'del 3 al 5 de desembre']) {
      expect(read(`residencia ${s}`), s).toMatchObject({ day: '2026-12-03', until: '2026-12-05' });
    }
  });

  it('across a month: «28 nov - 2 dic», «28-2 dic»', () => {
    expect(read('residencia 28 nov - 2 dic')).toMatchObject({ day: '2026-11-28', until: '2026-12-02' });
    expect(read('residencia 28-2 dic')).toMatchObject({ day: '2026-11-28', until: '2026-12-02' });
  });

  it('across a year: «28 dic - 3 ene»', () => {
    expect(read('residencia 28 dic - 3 ene')).toMatchObject({ day: '2026-12-28', until: '2027-01-03' });
    expect(read('residencia 28 dic al 3')).toMatchObject({ day: '2026-12-28', until: '2027-01-03' });
  });

  it('«16 nov hasta el 19», «16 nov fins al 19»', () => {
    expect(read('residencia 16 nov hasta el 19')).toMatchObject({ day: '2026-11-16', until: '2026-11-19' });
    expect(read('residència 16 nov fins al 19')).toMatchObject({ day: '2026-11-16', until: '2026-11-19' });
  });

  it('weekdays: «lun-vie»', () => {
    expect(read('residencia lun-vie')).toMatchObject({ day: '2026-10-26', until: '2026-10-30' });
    expect(read('residència dl-dv')).toMatchObject({ day: '2026-10-26', until: '2026-10-30' });
  });

  it('«del 3 al 5» with no month: days, even where the type has hours', () => {
    expect(read('ensayo del 3 al 5')).toMatchObject({ day: '2026-11-03', until: '2026-11-05', start: null });
  });

  it('«10-14» is hours in a rehearsal, days in a day off', () => {
    expect(read('ensayo 10-14')).toMatchObject({ day: null, start: '10:00', end: '14:00' });
    expect(read('day off 26-28')).toMatchObject({ day: '2026-10-26', until: '2026-10-28', start: null });
  });

  it('a span of days and hours together: «ensayo 3-5 dic 10-14»', () => {
    expect(read('ensayo 3-5 dic 10-14')).toMatchObject({
      day: '2026-12-03',
      until: '2026-12-05',
      start: '10:00',
      end: '14:00',
    });
  });
});

describe('hours', () => {
  it('every way of writing one', () => {
    const at = (s: string) => read(`ensayo jue ${s}`);
    expect(at('20h').start).toBe('20:00');
    expect(at('20:30').start).toBe('20:30');
    expect(at('20h30').start).toBe('20:30');
    expect(at('20.30h').start).toBe('20:30');
    expect(at('8pm').start).toBe('20:00');
    expect(at('8:30pm').start).toBe('20:30');
    expect(at('8 pm').start).toBe('20:00');
    expect(at('a las 20').start).toBe('20:00');
    expect(at('a les 20').start).toBe('20:00');
    expect(at('at 8').start).toBe('08:00');
    expect(at('à 20h').start).toBe('20:00');
    expect(at('mediodía').start).toBe('12:00');
    expect(at('9h').start).toBe('09:00');
  });

  it('a band: «10-14», «10h-14h», «de 10 a 14», «de 10 a 14h», «10:30-13:45», «8-10pm»', () => {
    const band = (s: string) => {
      const p = read(`ensayo jue ${s}`);
      return `${p.start}–${p.end}`;
    };
    expect(band('10-14')).toBe('10:00–14:00');
    expect(band('10h-14h')).toBe('10:00–14:00');
    expect(band('de 10 a 14')).toBe('10:00–14:00');
    expect(band('de 10 a 14h')).toBe('10:00–14:00');
    expect(band('de 10h a 14h')).toBe('10:00–14:00');
    expect(band('10:30-13:45')).toBe('10:30–13:45');
    expect(band('8-10pm')).toBe('20:00–22:00');
    expect(band('from 10 to 2pm')).toBe('10:00–14:00');
    expect(band('de 10 à 14h')).toBe('10:00–14:00');
  });

  it('an end before the start (past midnight) keeps only the start', () => {
    expect(read('ensayo jue 22-2')).toMatchObject({ start: '22:00', end: null });
  });

  it('a weekday with a band is not a day number: «jue 10-14»', () => {
    expect(read('ensayo jue 10-14')).toMatchObject({ day: '2026-10-22', start: '10:00', end: '14:00' });
  });

  it('a type without hours: read, marked, not kept', () => {
    const p = read('day off lun 10h');
    expect(p).toMatchObject({ type: 'day_off', start: null, unused: ['10h'], title: '' });
    expect(p.marks.map((m) => m.kind)).toContain('unused');
  });

  it('an impossible hour is not an hour', () => {
    expect(read('ensayo jue 25h').start).toBeNull();
    expect(read('ensayo jue 20:75').start).toBeNull();
  });
});

describe('where', () => {
  it('after a preposition: «en el Mercat», «a Girona», «at», «à»', () => {
    expect(said('ensayo jue en el Mercat de les Flors')).toMatchObject({ venue: 'Mercat de les Flors', title: '' });
    expect(said('assaig dijous a Girona')).toMatchObject({ venue: 'Girona', title: '' });
    expect(said('rehearsal thu at Sala Beckett')).toMatchObject({ venue: 'Sala Beckett' });
    expect(said('répétition jeudi à La Villette')).toMatchObject({ venue: 'La Villette' });
    expect(said('ensayo jue @Mercat')).toMatchObject({ venue: 'Mercat' });
  });

  it('a capitalised name right after the day or hour', () => {
    expect(said('Lectura dramatizada jue 19h Biblioteca Jaume Fuster', 'rehearsal')).toMatchObject({
      title: 'Lectura dramatizada',
      venue: 'Biblioteca Jaume Fuster',
      start: '19:00',
    });
  });

  it('lower case after the date is title, not a place', () => {
    expect(said('ensayo jue 10-14 pasada técnica')).toMatchObject({ title: 'pasada técnica' });
    expect(said('ensayo jue 10-14 pasada técnica').venue).toBeUndefined();
  });

  it('a place known in the space, whole, wins over a date word in it', () => {
    const places: KnownPlace[] = [{ venue: 'Sala Mañana', city: 'Sevilla' }];
    expect(said('ensayo jue Sala Mañana', 'rehearsal', { places })).toMatchObject({
      day: '2026-10-22',
      venue: 'Sala Mañana',
      city: 'Sevilla',
      title: '',
    });
  });

  it('a known venue in a performance stays its line and brings its city', () => {
    const places: KnownPlace[] = [{ venue: 'Teatre Lliure', city: 'Barcelona' }];
    expect(said('función Teatre Lliure 14 nov', 'rehearsal', { places })).toEqual({
      type: 'performance',
      day: '2026-11-14',
      city: 'Barcelona',
      title: 'Teatre Lliure',
    });
  });

  it('a performance: a venue then a city', () => {
    expect(said('función Teatre Lliure 14 nov Barcelona')).toMatchObject({ title: 'Teatre Lliure', city: 'Barcelona' });
    expect(said('función Teatre Lliure 14 nov en Barcelona')).toMatchObject({ title: 'Teatre Lliure', city: 'Barcelona' });
  });

  it('a type with no place keeps the words in the title', () => {
    expect(said('day off lun Girona')).toMatchObject({ type: 'day_off', title: 'Girona' });
  });

  it('a place fixed by hand is not read: the words stay in the title', () => {
    expect(said('ensayo jue en el Mercat', 'rehearsal', { keep: { place: true } })).toMatchObject({ title: 'en el Mercat' });
  });
});

describe('a trip', () => {
  it('«BCN → Madrid», «Girona->Lyon», «de Girona a Madrid», «from Lyon to Paris»', () => {
    expect(said('viaje Girona->Lyon vie')).toMatchObject({ origin: 'Girona', city: 'Lyon' });
    expect(said('viaje Barcelona - Girona vie 8h')).toMatchObject({ origin: 'Barcelona', city: 'Girona', start: '08:00', title: '' });
    expect(said('viaje de Girona a Madrid vie')).toMatchObject({ origin: 'Girona', city: 'Madrid', day: '2026-10-23' });
    expect(said('trip from Lyon to Paris fri')).toMatchObject({ origin: 'Lyon', city: 'Paris' });
    expect(said('viatge des de Girona a Lleida dv')).toMatchObject({ origin: 'Girona', city: 'Lleida' });
    expect(said('voyage de Lyon à Paris vendredi')).toMatchObject({ origin: 'Lyon', city: 'Paris' });
  });

  it('only a destination: «viaje a Madrid vie»', () => {
    expect(said('viaje a Madrid vie')).toMatchObject({ city: 'Madrid', title: '' });
    expect(said('viaje a Madrid vie').origin).toBeUndefined();
  });

  it('«ida», «vuelta», «tornada» give the direction', () => {
    expect(said('viaje vuelta Madrid → BCN dom')).toMatchObject({ direction: 'return', origin: 'Madrid', city: 'BCN' });
    expect(said('viatge tornada dg')).toMatchObject({ direction: 'return' });
    expect(said('viaje ida vie')).toMatchObject({ direction: 'outbound' });
  });

  it('an arrow with no type word says it is a trip', () => {
    expect(said('BCN → Madrid vie', 'rehearsal')).toMatchObject({ type: 'travel_day', origin: 'BCN', city: 'Madrid' });
  });

  it('known cities on either side', () => {
    const places: KnownPlace[] = [{ venue: 'Teatro Pradillo', city: 'Madrid' }];
    expect(said('viaje Barcelona → Madrid vie', 'rehearsal', { places })).toMatchObject({ origin: 'Barcelona', city: 'Madrid' });
  });
});

describe('lines a company writes', () => {
  it.each([
    ['Ensayo con luces jue 16-20h', { type: 'rehearsal', day: '2026-10-22', start: '16:00', end: '20:00', title: 'con luces' }],
    ['ensayo técnico en Sala Beckett el 3 de nov a las 10h', { day: '2026-11-03', start: '10:00', venue: 'Sala Beckett', title: 'técnico' }],
    ['assaig de 10 a 14 al Graner dc', { day: '2026-10-21', start: '10:00', end: '14:00', venue: 'Graner', title: '' }],
    ['prensa entrevista RAC1 jue 9:30', { type: 'press', start: '09:30', title: 'entrevista RAC1' }],
    ['Ensayo abierto el 30 a las 19h en La Villarroel', { day: '2026-10-30', start: '19:00', venue: 'La Villarroel', title: 'abierto' }],
    ['viaje a Lyon 3 dic tren 7:25', { day: '2026-12-03', start: '07:25', city: 'Lyon', title: 'tren' }],
    ['no disponible del 23 al 29 nov', { type: 'unavailable', day: '2026-11-23', until: '2026-11-29', title: '' }],
    ['reunión con Anouk mañana 11h', { day: '2026-10-22', start: '11:00', title: 'reunión con Anouk' }],
  ] as const)('%s', (line, want) => {
    expect(said(line, 'rehearsal')).toMatchObject(want);
  });
});

describe('quotes are literal', () => {
  it('«"Viernes 13"» is a title, not a Friday', () => {
    expect(said('función "Viernes 13" sáb 14 nov')).toEqual({ type: 'performance', day: '2026-11-14', title: 'Viernes 13' });
    expect(said('ensayo «Mañana» jue')).toMatchObject({ day: '2026-10-22', title: 'Mañana' });
  });
});

describe('ambiguous short weekdays', () => {
  it('«mon spectacle» is French, «mon 10h» is Monday', () => {
    expect(read('mon spectacle', 'rehearsal').day).toBeNull();
    expect(read('rehearsal mon 10h').day).toBe('2026-10-26');
  });

  it('«mar» alone is Tuesday, «14 mar» is March', () => {
    expect(read('ensayo mar').day).toBe('2026-10-27');
    expect(read('función 14 mar').day).toBe('2027-03-14');
  });
});

describe('the clock is the viewer’s', () => {
  it('at 23:30 UTC it is already tomorrow in Madrid', () => {
    const late = new Date('2026-10-21T23:30:00Z'); // 01:30 on Thursday in Madrid
    expect(parseLine('ensayo hoy', { now: late, tz: 'Europe/Madrid', type: 'rehearsal' }).day).toBe('2026-10-22');
    expect(parseLine('ensayo hoy', { now: late, tz: 'America/New_York', type: 'rehearsal' }).day).toBe('2026-10-21');
    expect(parseLine('ensayo mañana', { now: late, tz: 'Europe/Madrid', type: 'rehearsal' }).day).toBe('2026-10-23');
  });

  it('the end of the year: «mañana» on 31 Dec', () => {
    const nye = new Date('2026-12-31T12:00:00Z');
    expect(parseLine('ensayo mañana', { now: nye, tz: TZ, type: 'rehearsal' }).day).toBe('2027-01-01');
    expect(parseLine('ensayo el 2', { now: nye, tz: TZ, type: 'rehearsal' }).day).toBe('2027-01-02');
  });
});

describe('marks', () => {
  it('cover the recognised parts and nothing else', () => {
    const text = 'Ensayo general jue 10-14 Mercat';
    const p = read(text);
    const pieces = p.marks.map((m) => [m.kind, text.slice(m.from, m.to)]);
    expect(pieces).toEqual([
      ['type', 'Ensayo'],
      ['when', 'jue'],
      ['time', '10-14'],
      ['where', 'Mercat'],
    ]);
  });

  it('a glue word goes with its date: «el jueves», «a las 20h»', () => {
    const text = 'ensayo el jueves a las 20h';
    const p = read(text);
    expect(p.marks.map((m) => text.slice(m.from, m.to))).toEqual(['ensayo', 'el jueves', 'a las 20h']);
    expect(p.title).toBe('');
  });
});

describe('applyLine · the text into the draft', () => {
  const draft = (type: QuickType = 'performance') => ({ ...freshDraft('2026-10-30', type), said: '' });

  it('fills the chips and leaves the rest as the title', () => {
    const d = draft();
    const p = read('ensayo general jue 10-14 Mercat');
    const { draft: out } = applyLine(d, p, NO_HAND, {});
    expect(out).toMatchObject({ type: 'rehearsal', title: 'general', venue: 'Mercat' });
    expect(out.when).toMatchObject({ day: '2026-10-22', timed: true, start: '10:00', end: '14:00' });
  });

  it('a word taken out gives back what was there (the cell’s day)', () => {
    const d = draft('rehearsal');
    const first = applyLine(d, read('ensayo jue'), NO_HAND, {});
    expect(first.draft.when.day).toBe('2026-10-22');
    const second = applyLine(first.draft, read('ensayo'), NO_HAND, first.base);
    expect(second.draft.when.day).toBe('2026-10-30');
    expect(second.base.day).toBeUndefined();
  });

  it('a type taken out gives back the type it had', () => {
    const d = draft('performance');
    const first = applyLine(d, read('ensayo jue'), NO_HAND, {});
    expect(first.draft.type).toBe('rehearsal');
    const second = applyLine(first.draft, read('jue'), NO_HAND, first.base);
    expect(second.draft.type).toBe('performance');
  });

  it('a span opens «hasta»; a single day closes it again', () => {
    const d = draft('rehearsal');
    const a = applyLine(d, read('ensayo 3-5 dic'), NO_HAND, {});
    expect(a.draft.when).toMatchObject({ day: '2026-12-03', until: '2026-12-05', until_on: true });
    const b = applyLine(a.draft, read('ensayo 3 dic'), NO_HAND, a.base);
    expect(b.draft.when).toMatchObject({ day: '2026-12-03', until: '', until_on: false });
  });

  it('what was fixed by hand wins over what is read', () => {
    const d = { ...draft('rehearsal'), venue: 'Sala B' };
    d.when.day = '2026-11-02';
    const hand = { ...NO_HAND, day: true, venue: true };
    const { draft: out } = applyLine(d, read('ensayo jue en el Mercat'), hand, {});
    expect(out.when.day).toBe('2026-11-02');
    expect(out.venue).toBe('Sala B');
  });

  it('an hour is not written into a type without hours', () => {
    const d = draft('day_off');
    const { draft: out } = applyLine(d, read('day off lun 10h'), NO_HAND, {});
    expect(out.when.timed).toBe(false);
  });

  it('a trip: origin, destination (the city), direction', () => {
    const d = draft('rehearsal');
    const { draft: out } = applyLine(d, read('viaje vuelta Madrid → BCN dom'), NO_HAND, {});
    expect(out).toMatchObject({ type: 'travel_day', origin: 'Madrid', city: 'BCN', direction: 'return', title: '' });
  });
});
