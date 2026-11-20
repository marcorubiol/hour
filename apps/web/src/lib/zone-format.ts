/**
 * The formatters that read an instant in a zone, built once per zone.
 *
 * `new Intl.DateTimeFormat(…, { timeZone })` is the expensive half of every
 * «which day is this, there?»: the engine resolves the locale and loads the
 * zone's rules each time, tens of microseconds on a desktop and several times
 * that on a phone (Safari above all). Formatting with one already built is
 * close to free. Hoy asked that question thousands of times per paint (each
 * row of the pulse, for each of the things that come), a new formatter every
 * time: measured 20-11 with a phone's CPU, the tap that returns to Hoy held
 * the screen 1,7 s, nearly all of it here.
 *
 * Three fixed shapes, locale-stable (en-CA / en-GB), keyed by zone. An unknown
 * zone throws the same RangeError as before, every time: a failure is never
 * kept. No imports, so any module of `$lib` may read it.
 */

type Shape = 'day' | 'time' | 'parts';

const OPTIONS: Record<Shape, [string, Intl.DateTimeFormatOptions]> = {
  /** `YYYY-MM-DD`. */
  day: ['en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }],
  /** `HH:mm`, 24 h. */
  time: ['en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }],
  /** Every wall-clock part to the second, for `formatToParts`. */
  parts: [
    'en-CA',
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    },
  ],
};

const built = new Map<string, Intl.DateTimeFormat>();

export function zoneFormatter(shape: Shape, timeZone: string): Intl.DateTimeFormat {
  const key = `${shape}|${timeZone}`;
  let fmt = built.get(key);
  if (!fmt) {
    const [locale, options] = OPTIONS[shape];
    fmt = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    built.set(key, fmt);
  }
  return fmt;
}

/** The day (`YYYY-MM-DD`) an instant falls on in `timeZone`. */
export function zoneDay(at: Date | number, timeZone: string): string {
  return zoneFormatter('day', timeZone).format(at);
}
