import { describe, expect, it } from 'vitest';
import { chatLast, chatLine, chatWhen, chatWho } from './chat-row';

describe('la fila de chat fuera de Conversaciones (mesa, punto 6)', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  const base = {
    not_now_at: null,
    not_now_until: null,
    last_contacted_at: null,
    first_contacted_at: null,
    contacted_undated: false,
    reply_settled_at: null,
    next_action_at: null,
    next_action_note: null,
    relation: 'talking' as const,
  };

  it('lo último que se dijo: su contacto y el asunto; nos toca, en tinta', () => {
    const line = chatLine(
      {
        ...base,
        organization: { name: 'Teatre de la Llum', kind: 'theatre', city: 'Girona' },
        person: { full_name: 'Laia Puig' },
        last_turn: [{ direction: 'inbound', occurred_at: '2026-11-05T10:00:00Z', kind: 'email', subject: 'Marzo nos encaja' }],
        last_in: [{ occurred_at: '2026-11-05T10:00:00Z' }],
      },
      now,
      'es',
    );
    expect(line).toMatchObject({ shape: 'organization', words: ['sala', 'Girona'], lead: 'Laia Puig', last: 'Marzo nos encaja' });
    expect(line.turn).toMatchObject({ text: 'Nos toca responder', ink: true, reason: 'reply' });
  });

  it('lo escribimos nosotros: «Tú» y esperando su respuesta, sin tinta', () => {
    const line = chatLine(
      {
        ...base,
        organization: { name: 'Sala Beckett', kind: null, city: null },
        person: { full_name: 'Marc Roig', city: 'Barcelona' },
        last_turn: [{ direction: 'outbound', occurred_at: '2026-11-03T10:00:00Z', kind: 'email', subject: 'Dossier' }],
      },
      now,
      'es',
    );
    // Sin tipo, sólo la ciudad: la de la persona si la organización no la tiene.
    expect(line).toMatchObject({ words: ['Barcelona'], lead: 'Tú', last: 'Dossier' });
    expect(line.turn).toMatchObject({ text: 'Esperando su respuesta', ink: false, reason: 'theirs' });
  });

  it('una persona por libre: redonda, y su nombre no se repite delante de lo que dijo', () => {
    const line = chatLine(
      {
        ...base,
        organization: { name: 'Marta Vidal', kind: 'other', city: 'Lleida' },
        person: { full_name: 'Marta Vidal' },
        last_turn: [{ direction: 'inbound', occurred_at: '2026-11-04T10:00:00Z', kind: 'call', subject: null }],
      },
      now,
      'es',
    );
    expect(line).toMatchObject({ shape: 'person', words: ['por libre', 'Lleida'], lead: 'Llamada', last: null });
  });

  it('la lectura de la lente manda en con quién (`place`)', () => {
    const line = chatLine(
      {
        ...base,
        relation: 'never',
        organization: { name: 'Anna Bosch', kind: 'other', city: null },
        place: { kind: 'festival', solo: false, city: 'Tàrrega' },
      },
      now,
      'es',
    );
    expect(line).toMatchObject({ shape: 'organization', words: ['festival', 'Tàrrega'], lead: null, last: 'Sin contactar', turn: null });
  });

  it('un seguimiento vencido dice su nota', () => {
    const line = chatLine({ ...base, next_action_at: '2026-11-04', next_action_note: 'llamar a Jordi' }, now, 'es');
    expect(line).toMatchObject({ lead: 'Seguimiento', last: 'llamar a Jordi' });
    expect(line.turn).toMatchObject({ reason: 'follow_up', ink: true });
  });

  it('chatLast es la regla del feed: sin nada dicho, la relación', () => {
    expect(chatLast({ person: null, last: null, relation: 'contacted' }, 'es').lead).toBeNull();
    expect(chatLast({ person: null, last: null, relation: 'never' }, 'es').last).toBe('Sin contactar');
  });
});

describe('la fila de chat (ADR-176)', () => {
  it('cuándo: la hora hoy, ayer, el día de la semana, después la fecha', () => {
    const now = new Date('2026-11-02T13:10:00Z');
    expect(chatWhen('2026-11-02T12:02:00Z', 'es', 'UTC', now)).toBe('12h02');
    expect(chatWhen('2026-11-01T09:00:00Z', 'es', 'UTC', now)).toBe('ayer');
    expect(chatWhen('2026-10-29T09:00:00Z', 'en', 'UTC', now)).toBe('Thu');
    expect(chatWhen('2026-10-02T09:00:00Z', 'es', 'UTC', now)).toBe('2 oct');
    expect(chatWhen('2024-10-02T09:00:00Z', 'es', 'UTC', now)).toBe('2 oct 2024');
  });
});

describe('con quién es la fila (ADR-177 § 2 y § 3)', () => {
  it('una sala: cuadrada, tipo y ciudad', () => {
    expect(chatWho({ kind: 'theatre', city: 'Girona' }, 'es')).toEqual({ shape: 'organization', words: ['sala', 'Girona'] });
  });
  it('sin tipo, o «otra»: sólo la ciudad, nunca «otro»', () => {
    expect(chatWho({ kind: 'other', city: 'Tàrrega' }, 'es').words).toEqual(['Tàrrega']);
    expect(chatWho({ kind: null, city: null }, 'ca').words).toEqual([]);
  });
  it('una organización que es una sola persona: redonda y «por libre»', () => {
    expect(chatWho({ kind: 'presenter', solo: true, city: 'Lleida' }, 'es')).toEqual({ shape: 'person', words: ['por libre', 'Lleida'] });
    expect(chatWho({ solo: true }, 'ca').words).toEqual(['per lliure']);
    // El tipo `solo` (115), aunque la lectura no traiga `solo`.
    expect(chatWho({ kind: 'solo', city: 'Reus' }, 'es')).toEqual({ shape: 'person', words: ['por libre', 'Reus'] });
  });
});
