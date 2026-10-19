import { describe, expect, it } from 'vitest';
import {
  DORMANT_DAYS,
  countBolos,
  hasAnswered,
  notNowInForce,
  relationOf,
  type RelationInput,
} from './conversation-relation';

const NOW = new Date('2026-10-20T10:00:00');

function row(over: Partial<RelationInput> = {}): RelationInput {
  return {
    not_now_at: null,
    not_now_until: null,
    last: null,
    last_in: null,
    last_contacted_at: null,
    first_contacted_at: null,
    contacted_undated: false,
    legacy_status: null,
    regular: false,
    ...over,
  };
}

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const inbound = (n: number) => ({ direction: 'inbound' as const, occurred_at: daysAgo(n) });
const outbound = (n: number) => ({ direction: 'outbound' as const, occurred_at: daysAgo(n) });

describe('relationOf: cada estado', () => {
  it('nunca contactada: ningún evento con dirección ni sello', () => {
    expect(relationOf(row(), NOW)).toBe('never');
  });

  it('contactada: les escribimos y no contestan', () => {
    expect(relationOf(row({ last: outbound(3), first_contacted_at: daysAgo(3), last_contacted_at: daysAgo(3) }), NOW)).toBe(
      'contacted',
    );
  });

  it('contactada por el sello, sin evento (de antes del historial)', () => {
    expect(relationOf(row({ first_contacted_at: daysAgo(90), last_contacted_at: daysAgo(90) }), NOW)).toBe('contacted');
  });

  it('contactada, sin fecha: la marca de la migración cuenta como contacto', () => {
    expect(relationOf(row({ contacted_undated: true }), NOW)).toBe('contacted');
  });

  it('en conversación: han contestado y hay movimiento reciente', () => {
    expect(relationOf(row({ last: inbound(2), last_in: inbound(2) }), NOW)).toBe('talking');
  });

  it('dormida: hubo conversación y nada desde hace 30 días', () => {
    const r = row({ last: outbound(DORMANT_DAYS), last_in: inbound(40), last_contacted_at: daysAgo(DORMANT_DAYS) });
    expect(relationOf(r, NOW)).toBe('dormant');
  });

  it('en conversación el día 29', () => {
    expect(relationOf(row({ last: inbound(DORMANT_DAYS - 1), last_in: inbound(DORMANT_DAYS - 1) }), NOW)).toBe('talking');
  });

  it('habitual: la organización tiene un bolo hecho en una temporada anterior', () => {
    expect(relationOf(row({ regular: true }), NOW)).toBe('regular');
  });

  it('no esta vez: marcada a mano', () => {
    expect(relationOf(row({ not_now_at: daysAgo(1), last_in: inbound(2) }), NOW)).toBe('not_now');
  });

  it('el estado viejo de «en conversación», «opción» o «confirmado» cuenta como respuesta', () => {
    for (const legacy of ['in_conversation', 'hold', 'confirmed']) {
      expect(relationOf(row({ legacy_status: legacy }), NOW)).toBe('talking');
      expect(hasAnswered({ last_in: null, legacy_status: legacy })).toBe(true);
    }
  });

  it('el «aparcado» y el «de la casa» viejos se dejan a la derivación', () => {
    expect(relationOf(row({ legacy_status: 'dormant' }), NOW)).toBe('never');
    expect(relationOf(row({ legacy_status: 'recurring', contacted_undated: true }), NOW)).toBe('contacted');
  });
});

describe('relationOf: precedencia', () => {
  it('no esta vez gana a habitual', () => {
    expect(relationOf(row({ not_now_at: daysAgo(1), regular: true }), NOW)).toBe('not_now');
  });

  it('habitual gana a en conversación y a dormida', () => {
    expect(relationOf(row({ regular: true, last: inbound(1), last_in: inbound(1) }), NOW)).toBe('regular');
    expect(relationOf(row({ regular: true, last_in: inbound(200), last: inbound(200) }), NOW)).toBe('regular');
  });

  it('en conversación gana a contactada', () => {
    expect(relationOf(row({ last: outbound(1), last_in: inbound(5), first_contacted_at: daysAgo(20) }), NOW)).toBe('talking');
  });

  it('dormida gana a contactada', () => {
    expect(relationOf(row({ last: outbound(60), last_in: inbound(70), first_contacted_at: daysAgo(80) }), NOW)).toBe('dormant');
  });

  it('contactada gana a nunca', () => {
    expect(relationOf(row({ first_contacted_at: daysAgo(1) }), NOW)).toBe('contacted');
  });
});

describe('«no esta vez» caduca', () => {
  it('sigue en vigor la víspera de su día', () => {
    expect(notNowInForce(row({ not_now_at: daysAgo(10), not_now_until: '2026-10-21' }), NOW)).toBe(true);
  });

  it('acaba el día que se puso para volver a escribir', () => {
    const r = row({ not_now_at: daysAgo(10), not_now_until: '2026-10-20', last: inbound(12), last_in: inbound(12) });
    expect(notNowInForce(r, NOW)).toBe(false);
    expect(relationOf(r, NOW)).toBe('talking');
  });

  it('acaba con una respuesta suya posterior', () => {
    const r = row({ not_now_at: daysAgo(10), last: inbound(2), last_in: inbound(2) });
    expect(notNowInForce(r, NOW)).toBe(false);
    expect(relationOf(r, NOW)).toBe('talking');
  });

  it('un correo nuestro posterior no lo levanta', () => {
    const r = row({ not_now_at: daysAgo(10), last: outbound(2), last_in: inbound(11) });
    expect(relationOf(r, NOW)).toBe('not_now');
  });

  it('sin fecha, dura hasta que contesten', () => {
    expect(notNowInForce(row({ not_now_at: daysAgo(400) }), NOW)).toBe(true);
  });
});

describe('countBolos', () => {
  it('cuenta en opción y firmes; propuestos y cancelados, no', () => {
    const statuses = ['hold', 'hold_1', 'hold_3', 'confirmed', 'done', 'proposed', 'cancelled'];
    expect(countBolos(statuses.map((status) => ({ status })))).toEqual({ option: 3, firm: 2 });
  });
});
