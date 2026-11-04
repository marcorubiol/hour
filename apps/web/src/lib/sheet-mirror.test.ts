import { describe, expect, test } from 'vitest';
import { boloLine, bolosBySala, orderBolos, projectFacts } from './sheet-mirror';

const TODAY = '2026-11-04';

type B = Parameters<typeof bolosBySala>[0][number] & { id: string };

function bolo(over: Partial<B> & { id: string }): B {
  return {
    status: 'confirmed',
    function_count: 1,
    first_performed_at: null,
    last_performed_at: null,
    city: null,
    fee_amount: null,
    fee_currency: 'EUR',
    conversation_id: 'c1',
    venue_name: 'Teatre de la Llum',
    ...over,
  };
}

describe('projectFacts', () => {
  test('counts the functions of firm bolos and what they sold, per currency', () => {
    const f = projectFacts(
      [
        bolo({ id: 'a', function_count: 2, fee_amount: 2400 }),
        bolo({ id: 'b', status: 'paid', fee_amount: 1200 }),
        bolo({ id: 'c', status: 'hold_1', fee_amount: 9000 }),
        bolo({ id: 'd', status: 'cancelled', fee_amount: 9000 }),
        bolo({ id: 'e', fee_amount: 500, fee_currency: 'CHF' }),
        bolo({ id: 'f', fee_amount: null }),
      ],
      TODAY,
    );
    expect(f.firmFunctions).toBe(5);
    expect(f.sold).toEqual([
      ['CHF', 500],
      ['EUR', 3600],
    ]);
  });

  test('without money there is nothing sold, never a zero', () => {
    expect(projectFacts([bolo({ id: 'a', fee_amount: undefined })], TODAY).sold).toEqual([]);
  });

  test('next is the nearest live bolo from today, with its city', () => {
    const f = projectFacts(
      [
        bolo({ id: 'past', first_performed_at: '2026-10-01T18:00:00Z', city: 'Vic' }),
        bolo({ id: 'far', first_performed_at: '2027-03-07T19:00:00Z', city: 'Olot' }),
        bolo({ id: 'near', status: 'hold', first_performed_at: '2026-12-01T19:00:00Z', city: 'Girona' }),
        bolo({ id: 'dead', status: 'cancelled', first_performed_at: '2026-11-10T19:00:00Z' }),
      ],
      TODAY,
    );
    expect(f.next).toEqual({ at: '2026-12-01T19:00:00Z', city: 'Girona' });
  });
});

describe('bolosBySala', () => {
  test('one row per conversation, the nearest first; a bolo without one stands alone', () => {
    const groups = bolosBySala(
      [
        bolo({ id: 'p', conversation_id: 'c1', first_performed_at: '2026-01-01T00:00:00Z' }),
        bolo({ id: 'n', conversation_id: 'c2', venue_name: 'Auditori', first_performed_at: '2026-12-01T00:00:00Z' }),
        bolo({ id: 'm', conversation_id: 'c1', first_performed_at: '2027-01-01T00:00:00Z' }),
        bolo({ id: 'x', conversation_id: null, venue_name: 'Sala B' }),
        bolo({ id: 'z', status: 'cancelled', conversation_id: 'c3' }),
      ],
      TODAY,
    );
    expect(groups.map((g) => [g.conversationId, g.name, g.bolos.map((b) => b.id)])).toEqual([
      ['c2', 'Auditori', ['n']],
      ['c1', 'Teatre de la Llum', ['m', 'p']],
      [null, 'Sala B', ['x']],
    ]);
  });
});

describe('orderBolos', () => {
  test('coming (nearest first), then past (latest first), then undated', () => {
    const out = orderBolos(
      [
        bolo({ id: 'u' }),
        bolo({ id: 'old', first_performed_at: '2025-01-01T00:00:00Z' }),
        bolo({ id: 'soon', first_performed_at: '2026-11-20T00:00:00Z' }),
        bolo({ id: 'recent', first_performed_at: '2026-10-01T00:00:00Z' }),
        bolo({ id: 'later', first_performed_at: '2027-01-20T00:00:00Z' }),
      ],
      TODAY,
    );
    expect(out.map((b) => b.id)).toEqual(['soon', 'later', 'recent', 'old', 'u']);
  });
});

describe('boloLine', () => {
  test('the amount only when there is a fee', () => {
    const withFee = boloLine(bolo({ id: 'a', fee_amount: 2400, first_performed_at: '2026-12-01T19:00:00Z' }), {
      locale: 'es',
      href: null,
    });
    expect(withFee.amount).toMatch(/2\.400/);
    expect(withFee.status).toBe('confirmado');
    expect(withFee.functions).toBeNull();
    const none = boloLine(bolo({ id: 'b', function_count: 3 }), { locale: 'es', href: '/x', where: 'Olot' });
    expect(none).toMatchObject({ amount: null, href: '/x', where: 'Olot', day: 'sin fecha', functions: '3 funciones' });
  });
});
