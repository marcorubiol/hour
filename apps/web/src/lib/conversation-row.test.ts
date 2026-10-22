import { describe, expect, it } from 'vitest';
import { LATE_DAYS, boloLabel, mailoutLabel, nearestBolo, rowLast, rowTurn } from './conversation-row';
import { mailoutOutcome } from './conversation-overview';
import type { ConversationBolo } from './conversation-relation';

const NOW = new Date(2026, 9, 22, 12, 0, 0);
const ago = (days: number) => new Date(2026, 9, 22 - days, 9, 0, 0).toISOString();
const day = (offset: number) => {
  const d = new Date(2026, 9, 22 + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function base(over: Record<string, unknown> = {}) {
  return {
    not_now_at: null,
    not_now_until: null,
    last: null,
    last_in: null,
    last_contacted_at: null,
    first_contacted_at: null,
    contacted_undated: false,
    reply_settled_at: null,
    next_action_at: null,
    ...over,
  } as Parameters<typeof rowTurn>[0];
}

function bolo(id: string, status: string, first: string | null): ConversationBolo {
  return {
    conversation_id: 'c',
    bolo_id: id,
    project_id: 'p',
    line_id: null,
    status,
    venue_name: null,
    city: null,
    country: null,
    function_count: 1,
    first_performed_at: first,
    last_performed_at: first,
    performance_slug: `f-${id}`,
  };
}

describe('rowTurn', () => {
  it('una respuesta pendiente es «te toca», en aviso desde LATE_DAYS', () => {
    const fresh = rowTurn(base({ last: { direction: 'inbound', occurred_at: ago(1) }, last_in: { occurred_at: ago(1) } }), NOW, 'es');
    expect(fresh).toMatchObject({ since: 'ayer', tone: 'ours' });
    const late = rowTurn(base({ last: { direction: 'inbound', occurred_at: ago(LATE_DAYS) }, last_in: { occurred_at: ago(LATE_DAYS) } }), NOW, 'es');
    expect(late?.tone).toBe('late');
  });
  it('un seguimiento vencido dice su día; uno futuro no es turno', () => {
    expect(rowTurn(base({ next_action_at: day(-2) }), NOW, 'en')?.tone).toBe('ours');
    expect(rowTurn(base({ next_action_at: day(3) }), NOW, 'en')).toBeNull();
  });
  it('lo suyo en voz baja; «no esta vez» no tiene turno', () => {
    expect(rowTurn(base({ last: { direction: 'outbound', occurred_at: ago(4) } }), NOW, 'en')?.tone).toBe('theirs');
    expect(rowTurn(base({ last: { direction: 'inbound', occurred_at: ago(4) }, last_in: { occurred_at: ago(4) }, not_now_at: ago(1) }), NOW, 'en')).toBeNull();
  });
});

describe('nearestBolo', () => {
  it('el vivo más cercano desde hoy, con los otros como +N; los cancelados no cuentan', () => {
    const n = nearestBolo([bolo('lejos', 'confirmed', day(60)), bolo('cerca', 'hold_1', day(10)), bolo('x', 'cancelled', day(5))], NOW);
    expect(n).toMatchObject({ bolo: { bolo_id: 'cerca' }, more: 1 });
    expect(boloLabel(n!, 'es')).toMatch(/^1\.ª opción · .+ \+1$/);
  });
  it('si todos son de antes, el último; sin fecha, al final', () => {
    expect(nearestBolo([bolo('viejo', 'done', day(-200)), bolo('reciente', 'done', day(-20))], NOW)?.bolo.bolo_id).toBe('reciente');
    expect(nearestBolo([bolo('sin', 'hold', null), bolo('pasado', 'done', day(-3))], NOW)?.bolo.bolo_id).toBe('pasado');
    expect(nearestBolo([bolo('x', 'cancelled', day(1))], NOW)).toBeNull();
  });
});

describe('rowLast', () => {
  it('lo nuestro con «Tú», lo suyo sin nadie, sin asunto la clase', () => {
    expect(rowLast({ last: { direction: 'outbound', kind: 'email', subject: 'Rider' }, last_in: null }, 'es')).toEqual({ lead: 'Tú', last: 'Rider' });
    expect(rowLast({ last: { direction: 'inbound', kind: 'call', subject: null }, last_in: null }, 'es')).toEqual({ lead: null, last: 'Llamada' });
  });
  it('sin historial, el último envío que recibió', () => {
    const m = { mailout_id: 'm', at: ago(30), status: 'delivered' };
    expect(rowLast({ last: null, last_in: null, last_mailout: m }, 'es').last).toMatch(/^Envío .+ · sin respuesta$/);
    expect(mailoutLabel({ ...m, status: 'bounced' }, null, 'en')).toMatch(/bounced$/);
    expect(mailoutOutcome(m, ago(2))).toBe('replied');
    expect(rowLast({ last: null, last_in: null }, 'es')).toEqual({ lead: null, last: null });
  });
});
