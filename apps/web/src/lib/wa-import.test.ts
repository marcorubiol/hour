import { describe, expect, it } from 'vitest';
import {
  boloBindingUntil,
  bursts,
  candidatesFor,
  chunk,
  contentKey,
  fingerprints,
  guessSelf,
  looksLikePhone,
  matchAuthor,
  normalizeName,
  payloadOf,
  phoneKey,
  planBursts,
  propose,
  soleBoloOn,
  summarize,
  type ImportContext,
  type PreparedMessage,
} from './wa-import';

const persons = [
  { person_id: 'elena', name: 'Elena Ruiz Vidal', phone: '+34 600 112 233', team: false },
  { person_id: 'jordi', name: 'Jordi Sala', phone: '600 99 88 77', team: false },
  { person_id: 'anouk', name: 'Anouk Martí', phone: null, team: true },
  { person_id: 'elena2', name: 'Elena Soto', phone: null, team: false },
];

/**
 * `private.whatsapp_fingerprint('2026-03-13T17:02:15Z', 'Hola Elena', 'photo', 2)`, el mismo valor en la Supabase
 * local y en producción (comprobado el 2026-11-08): la huella del dispositivo es la de la base.
 */
const DB_FP = '248bff2f073390798a09daa2319ff2f3';

const ctx: ImportContext = {
  me: { person_id: null, name: 'Marco Rubiol' },
  persons,
  conversations: [
    { id: 'conv-a', title: 'Kosmos', project_name: 'Obra A', last_contacted_at: '2026-10-01T10:00:00Z' },
    { id: 'conv-b', title: 'Kosmos', project_name: 'Obra B', last_contacted_at: '2026-11-01T10:00:00Z' },
    { id: 'conv-c', title: 'Teatre Nou', project_name: 'Obra A', last_contacted_at: null },
  ],
  contacts: [
    { conversation_id: 'conv-a', person_id: 'elena', since: '2026-01-01', until: null },
    { conversation_id: 'conv-b', person_id: 'elena', since: '2026-09-01', until: null },
    { conversation_id: 'conv-c', person_id: 'jordi', since: null, until: '2026-06-30' },
  ],
  bolos: [
    { id: 'bolo-1', conversation_id: 'conv-a', project_name: 'Obra A', venue_name: 'Kosmos', city: 'Girona', start_day: '2026-02-01', first_day: '2026-11-14', last_day: '2026-11-14' },
  ],
  known: [],
  chats: [],
};

describe('normalize and phones', () => {
  it('names compare without accents or signs', () => {
    expect(normalizeName('  Àngels  Puig-Martí ')).toBe('angels puig marti');
  });
  it('a number is a number', () => {
    expect(looksLikePhone('+34 600 11 22 33')).toBe(true);
    expect(looksLikePhone('Elena')).toBe(false);
    expect(looksLikePhone('123')).toBe(false);
  });
  it('the key is the last nine digits, with or without prefix', () => {
    expect(phoneKey('+34 600 112 233')).toBe('600112233');
    expect(phoneKey('0034600112233')).toBe('600112233');
    expect(phoneKey('600-112-233')).toBe('600112233');
    expect(phoneKey(null)).toBeNull();
  });
});

describe('matchAuthor', () => {
  it('by number', () => {
    expect(matchAuthor('+34 600 11 22 33', persons)).toEqual({ person_id: 'elena', how: 'phone' });
  });
  it('by full name, accents aside', () => {
    expect(matchAuthor('jordi sala', persons)).toEqual({ person_id: 'jordi', how: 'name' });
  });
  it('by every word inside a longer name, when only one fits', () => {
    expect(matchAuthor('Elena Ruiz', persons)).toEqual({ person_id: 'elena', how: 'name' });
  });
  it('a single first name shared by two is nobody', () => {
    expect(matchAuthor('Elena', persons)).toEqual({ person_id: null, how: null });
  });
  it('an unknown number is nobody', () => {
    expect(matchAuthor('+34 611 000 000', persons)).toEqual({ person_id: null, how: null });
  });
});

describe('guessSelf', () => {
  it('by the full name or the first name, when only one fits', () => {
    expect(guessSelf(['Elena Kosmos', 'Marco Rubiol'], 'Marco Rubiol')).toBe('Marco Rubiol');
    expect(guessSelf(['Elena Kosmos', 'Marco'], 'Marco Rubiol')).toBe('Marco');
    expect(guessSelf(['Elena Kosmos', 'Yo'], 'Marco Rubiol')).toBeNull();
    expect(guessSelf(['Marco A', 'Marco B'], 'Marco Rubiol')).toBeNull();
  });
});

describe('fingerprints', () => {
  it('same minute and text: the same print, the order tells twins apart', async () => {
    const att = [{ type: 'photo' as const, name: null }];
    const [a, b, c] = (await fingerprints([
      { at: '2026-03-13T17:02:15.000Z', body: 'ok', attachments: [] },
      { at: '2026-03-13T17:02:40.000Z', body: 'ok', attachments: [] },
      { at: '2026-03-13T17:03:00.000Z', body: '', attachments: att },
    ])).map((x) => x.fp);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    // Omitido en un teléfono y adjunto en el otro: el mismo mensaje.
    const [d] = await fingerprints([{ at: '2026-03-13T17:03:00.000Z', body: ' ', attachments: [{ type: 'photo' as const, name: 'IMG.jpg' }] }]);
    expect(c).toBe(d.fp);
    const [again] = await fingerprints([{ at: '2026-03-13T17:02:59.000Z', body: 'ok', attachments: [] }]);
    expect(again).toEqual({ fp: a, n: 1 });
  });
  it('matches private.whatsapp_fingerprint in the database (values computed there)', async () => {
    // SELECT private.whatsapp_fingerprint('2026-03-13T17:02:15Z', 'Hola  Elena\n', 'photo', 2)
    const [, second] = await fingerprints([
      { at: '2026-03-13T17:02:15.000Z', body: 'Hola  Elena\n', attachments: [{ type: 'photo', name: null }] },
      { at: '2026-03-13T17:02:40.000Z', body: 'Hola Elena', attachments: [{ type: 'photo', name: 'x.jpg' }] },
    ]);
    expect(second).toEqual({ fp: DB_FP, n: 2 });
  });
  it('the content key ignores spacing and file names', () => {
    expect(contentKey(' Hola\n  Elena ', [{ type: 'photo', name: 'x.jpg' }])).toBe(contentKey('Hola Elena', [{ type: 'photo', name: null }]));
  });
});

describe('bursts', () => {
  it('a gap of three hours or more opens a new one', () => {
    expect(
      bursts(['2026-03-13T10:00:00Z', '2026-03-13T12:59:00Z', '2026-03-13T15:59:00Z', '2026-03-13T16:00:00Z']),
    ).toEqual([[0, 1], [2, 3]]);
    expect(bursts([])).toEqual([]);
  });
});

describe('candidates and proposals (ADR-188 § 4)', () => {
  it('contact on that day, most recent first', () => {
    expect(candidatesFor(['elena'], '2026-10-15', ctx)).toEqual(['conv-b', 'conv-a']);
    expect(candidatesFor(['elena'], '2026-05-01', ctx)).toEqual(['conv-a']);
    expect(candidatesFor(['jordi'], '2026-07-01', ctx)).toEqual([]);
  });
  it('one candidate places, two guess the most recent, none has no site', () => {
    expect(propose(['elena'], '2026-05-01', null, ctx)).toMatchObject({ site: { kind: 'conversation', id: 'conv-a' }, guess: false, reason: 'single_candidate' });
    expect(propose(['elena'], '2026-10-15', null, ctx)).toMatchObject({
      site: { kind: 'conversation', id: 'conv-b' },
      guess: true,
      reason: 'most_recent',
      candidates: ['conv-b', 'conv-a'],
    });
    expect(propose(['jordi'], '2026-07-01', null, ctx)).toMatchObject({ site: { kind: 'none' }, reason: 'none' });
  });
  it('a group bound to a bolo goes to its board until the day after, then nowhere', () => {
    const until = boloBindingUntil(ctx.bolos[0]);
    expect(until).toBe('2026-11-15');
    const binding = { kind: 'bolo' as const, id: 'bolo-1', until };
    expect(propose(['jordi'], '2026-11-15', binding, ctx).site).toEqual({ kind: 'bolo', id: 'bolo-1' });
    expect(propose(['jordi'], '2026-11-16', binding, ctx).site).toEqual({ kind: 'none' });
  });
  it('a chat bound to a conversation goes there', () => {
    expect(propose([], '2020-01-01', { kind: 'conversation', id: 'conv-c' }, ctx)).toMatchObject({ site: { kind: 'conversation', id: 'conv-c' }, reason: 'chat_binding' });
  });
  it('the bolo mark only with a single bolo going on', () => {
    expect(soleBoloOn('conv-a', '2026-11-10', ctx.bolos)).toBe('bolo-1');
    expect(soleBoloOn('conv-a', '2026-01-10', ctx.bolos)).toBeNull();
    expect(soleBoloOn('conv-b', '2026-11-10', ctx.bolos)).toBeNull();
  });
});

function msg(local: string, author: string, body: string, known = false): PreparedMessage {
  return { local, seconds: true, author, body, attachments: [], edited: false, at: new Date(`${local}Z`).toISOString(), fp: `fp-${local}-${author}`, n: 1, known };
}

describe('planBursts, summarize and payloadOf', () => {
  const labels = new Map<string, string | null>([
    ['Elena Kosmos', 'elena'],
    ['Marco', null],
  ]);
  const messages = [
    msg('2026-05-01T10:00:00', 'Elena Kosmos', 'Hola'),
    msg('2026-05-01T10:05:00', 'Marco', 'Hola Elena'),
    msg('2026-10-15T09:00:00', 'Marco', '¿Seguimos?'),
    msg('2026-10-15T09:30:00', 'Elena Kosmos', 'Sí'),
    msg('2026-11-10T09:00:00', 'Elena Kosmos', 'Ya está', true),
  ];

  const plan = planBursts(messages, labels, 'Marco', null, ctx);

  it('one burst per gap, proposals per burst, bursts with nothing new left out', () => {
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ fresh: 2, include: true, guess: false, site: { kind: 'conversation', id: 'conv-a' } });
    // Sólo Marco habla al empezar: la otra parte es la del chat.
    expect(plan[1]).toMatchObject({ fresh: 2, include: true, guess: true, site: { kind: 'conversation', id: 'conv-b' } });
  });

  it('summarizes by site: placed first, then guesses, then no site', () => {
    const s = summarize(plan);
    expect(s.map((x) => [x.key, x.messages])).toEqual([
      ['conversation:conv-a', 2],
      ['conversation:conv-b:guess', 2],
    ]);
  });

  it('the payload carries state, reason and candidates; a moved burst is the person’s choice', () => {
    const p = payloadOf(plan, ctx.bolos);
    expect(p).toHaveLength(4);
    // En mayo, conv-a tiene un solo bolo en curso (el de Girona): lleva su marca.
    expect(p[0].placements).toEqual([
      { surface: 'conversation', conversation_id: 'conv-a', bolo_id: 'bolo-1', state: 'placed', reason: 'single_candidate' },
    ]);
    expect(p[2].placements[0]).toMatchObject({ state: 'guess', reason: 'most_recent', candidates: ['conv-b', 'conv-a'] });
    const moved = plan.map((b, i) => (i === 1 ? { ...b, site: { kind: 'conversation' as const, id: 'conv-a' }, guess: false } : b));
    const q = payloadOf(moved, ctx.bolos);
    expect(q[2].placements[0]).toMatchObject({ conversation_id: 'conv-a', state: 'placed', reason: 'person_choice' });
    expect(q[2].placements[0].bolo_id).toBe('bolo-1');
  });

  it('a burst left out sends nothing; a burst without site, marked, goes without placement', () => {
    const none = planBursts([msg('2026-07-01T10:00:00', 'Jordi', 'Hola')], new Map([['Jordi', 'jordi']]), null, null, ctx);
    expect(none[0].include).toBe(false);
    expect(payloadOf(none, ctx.bolos)).toEqual([]);
    expect(payloadOf([{ ...none[0], include: true }], ctx.bolos)[0].placements).toEqual([]);
  });
});

describe('chunk', () => {
  it('slices by size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
