import { describe, expect, it } from 'vitest';
import { chatWhen, chatWho, soloOf } from './chat-row';

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
  });
  it('sola: su único contacto se llama como ella', () => {
    expect(soloOf('Marta Vidal', ['marta  vidal'])).toBe(true);
    expect(soloOf('Marta Vidal', ['Marta Vidal', 'Jordi Sastre'])).toBe(false);
    expect(soloOf('Teatre de la Llum', ['Laia Puig'])).toBe(false);
    expect(soloOf('Teatre de la Llum', [])).toBe(false);
  });
});
