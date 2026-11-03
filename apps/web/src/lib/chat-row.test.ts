import { describe, expect, it } from 'vitest';
import { chatWhen } from './chat-row';

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
