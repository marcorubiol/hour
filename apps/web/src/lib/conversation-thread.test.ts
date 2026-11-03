import { describe, expect, it } from 'vitest';
import {
  conversationThreadEntries,
  isLongText,
  isMail,
  senderName,
  subjectStem,
  threadDayLabel,
  type ThreadEvent,
} from './conversation-thread';
import type { ThreadMessage } from './threads';

const TZ = 'Europe/Madrid';

function mail(id: string, at: string, over: Partial<ThreadEvent> = {}): ThreadEvent {
  return {
    id,
    occurred_at: at,
    recorded_at: at,
    kind: 'email',
    source: 'email',
    direction: 'inbound',
    body: 'Hola',
    subject: 'MaMeMi 26-27',
    ...over,
  };
}

function msg(id: string, at: string, author = 'anouk'): ThreadMessage {
  return { id, created_at: at, author_id: author, body: 'nota' } as ThreadMessage;
}

const base = { me: 'marco', eventsReadAt: null, teamReadAt: null, tz: TZ };

describe('conversationThreadEntries', () => {
  it('lo antiguo arriba, lo nuevo abajo, y el equipo intercalado con lo de fuera', () => {
    const out = conversationThreadEntries({
      ...base,
      events: [mail('b', '2026-10-13T08:00:00Z'), mail('a', '2026-10-12T08:00:00Z')],
      messages: [msg('m', '2026-10-12T09:00:00Z')],
      teamReadAt: '2026-10-20T00:00:00Z',
    });
    expect(out.filter((x) => x.kind !== 'day').map((x) => x.key)).toEqual(['a', 'm', 'b']);
  });

  it('a la misma hora, lo de fuera primero', () => {
    const out = conversationThreadEntries({
      ...base,
      events: [mail('e', '2026-10-12T08:00:00Z')],
      messages: [msg('m', '2026-10-12T08:00:00Z')],
      teamReadAt: '2026-10-20T00:00:00Z',
    });
    expect(out.filter((x) => x.kind !== 'day').map((x) => x.key)).toEqual(['e', 'm']);
  });

  it('un separador cada vez que cambia el día, en la zona de quien mira', () => {
    const out = conversationThreadEntries({
      ...base,
      events: [mail('a', '2026-10-12T21:30:00Z'), mail('b', '2026-10-12T22:30:00Z')],
      messages: [],
    });
    // 23:30 y 00:30 en Madrid: dos días.
    expect(out.map((x) => x.kind)).toEqual(['day', 'mail', 'day', 'mail']);
  });

  it('el asunto sólo cuando cambia, sin contar «Re:»', () => {
    const out = conversationThreadEntries({
      ...base,
      events: [
        mail('a', '2026-10-12T08:00:00Z', { subject: 'MaMeMi 26-27' }),
        mail('b', '2026-10-12T09:00:00Z', { subject: 'Re: MaMeMi 26-27' }),
        mail('c', '2026-10-12T10:00:00Z', { subject: 'RE: Fwd: mamemi  26-27' }),
        mail('d', '2026-10-12T11:00:00Z', { subject: 'Rider técnico' }),
        mail('e', '2026-10-12T12:00:00Z', { subject: null }),
        mail('f', '2026-10-12T13:00:00Z', { subject: 'Re: Rider técnico' }),
      ],
      messages: [],
    });
    const shown = out.flatMap((x) => (x.kind === 'mail' ? [[x.key, x.showSubject]] : []));
    expect(shown).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
      ['d', true],
      ['e', false],
      ['f', false],
    ]);
  });

  it('cada cosa en su forma: correo, envío, lo apuntado', () => {
    const out = conversationThreadEntries({
      ...base,
      events: [
        mail('mail', '2026-10-12T08:00:00Z'),
        mail('sent', '2026-10-12T09:00:00Z', { direction: 'outbound', mailout_id: 'x' }),
        mail('bounce', '2026-10-12T10:00:00Z', { mailout_id: 'x', mailout_note: 'unsubscribed' }),
        mail('call', '2026-10-12T11:00:00Z', { kind: 'call', source: 'manual' }),
        mail('logged', '2026-10-12T12:00:00Z', { source: 'manual' }),
      ],
      messages: [],
    });
    expect(out.filter((x) => x.kind !== 'day').map((x) => `${x.key}:${x.kind}`)).toEqual([
      'mail:mail',
      'sent:mailout',
      'bounce:logged',
      'call:logged',
      'logged:logged',
    ]);
  });

  it('la raya de nuevos va antes de lo primero sin leer y cuenta lo de fuera y lo del equipo', () => {
    const out = conversationThreadEntries({
      ...base,
      events: [
        mail('old', '2026-10-12T08:00:00Z'),
        mail('mine', '2026-10-13T08:00:00Z', { direction: 'outbound' }),
        mail('fresh', '2026-10-14T08:00:00Z'),
      ],
      messages: [msg('own', '2026-10-13T09:00:00Z', 'marco'), msg('team', '2026-10-14T09:00:00Z')],
      eventsReadAt: '2026-10-12T12:00:00Z',
      teamReadAt: '2026-10-12T12:00:00Z',
    });
    const i = out.findIndex((x) => x.kind === 'new');
    expect(out[i]).toEqual({ kind: 'new', key: 'new', count: 2 });
    expect(out.slice(i + 1).find((x) => x.kind !== 'day')?.key).toBe('fresh');
  });

  it('sin la lectura de fuera todavía, no se pinta raya por lo de fuera', () => {
    const out = conversationThreadEntries({ ...base, events: [mail('a', '2026-10-12T08:00:00Z')], messages: [] });
    expect(out.some((x) => x.kind === 'new')).toBe(false);
  });

  it('un correo anotado tarde (sincronizado hoy, escrito ayer) es nuevo por cuándo se anotó', () => {
    const out = conversationThreadEntries({
      ...base,
      events: [mail('late', '2026-10-10T08:00:00Z', { recorded_at: '2026-10-14T08:00:00Z' })],
      messages: [],
      eventsReadAt: '2026-10-12T00:00:00Z',
    });
    expect(out.some((x) => x.kind === 'new')).toBe(true);
  });
});

describe('las piezas', () => {
  it('subjectStem quita los prefijos de respuesta y reenvío, repetidos', () => {
    expect(subjectStem('Re: RV: Fwd:  Propuesta de gira')).toBe('propuesta de gira');
    expect(subjectStem('AW: Re[2]: x')).toBe('x');
    expect(subjectStem(null)).toBe('');
  });

  it('isLongText: por líneas o por caracteres', () => {
    expect(isLongText('a\nb\nc')).toBe(false);
    expect(isLongText('1\n2\n3\n4\n5\n6\n7')).toBe(true);
    expect(isLongText('x'.repeat(481))).toBe(true);
    expect(isLongText(null)).toBe(false);
  });

  it('isMail: sólo el correo del buzón, no lo apuntado ni lo de un envío', () => {
    expect(isMail({ kind: 'email', source: 'email' })).toBe(true);
    expect(isMail({ kind: 'email', source: 'manual' })).toBe(false);
    expect(isMail({ kind: 'email', source: 'email', mailout_id: 'x' })).toBe(false);
    expect(isMail({ kind: 'call', source: 'email' })).toBe(false);
  });

  it('senderName saca el nombre de la cabecera', () => {
    expect(senderName('Laia Puig <laia@llum.cat>')).toBe('Laia Puig');
    expect(senderName('"Puig, Laia" <laia@llum.cat>')).toBe('Puig, Laia');
    expect(senderName('<laia@llum.cat>')).toBe('laia@llum.cat');
    expect(senderName('laia@llum.cat')).toBe('laia@llum.cat');
    expect(senderName(null)).toBe('');
  });

  it('threadDayLabel: hoy, ayer, y la fecha', () => {
    expect(threadDayLabel('2026-11-02', 'es', '2026-11-02')).toBe('hoy');
    expect(threadDayLabel('2026-11-01', 'es', '2026-11-02')).toBe('ayer');
    expect(threadDayLabel('2026-10-08', 'es', '2026-11-02')).toBe('8 oct');
    expect(threadDayLabel('2024-10-08', 'es', '2026-11-02')).toBe('8 oct 2024');
  });
});
