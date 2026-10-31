import { describe, expect, test } from 'vitest';
import { scopePillLabel } from './scope-door';

// What the scope pill in the title row says (ADR-152).
const names: Record<string, string> = {
  's:txema': 'Txema Muñoz',
  'p:gota': 'Gota',
  'l:primavera': 'Gira de primavera',
  'u:anouk': 'Anouk',
};
const label = (tok: string) => names[tok] ?? tok;

describe('scopePillLabel', () => {
  test('nothing scoped: no name (the pill says «Todo»)', () => {
    expect(scopePillLabel([], label)).toBeNull();
  });

  test('one token: its own name, whatever its level', () => {
    expect(scopePillLabel(['s:txema'], label)).toBe('Txema Muñoz');
    expect(scopePillLabel(['p:gota'], label)).toBe('Gota');
    expect(scopePillLabel(['l:primavera'], label)).toBe('Gira de primavera');
    expect(scopePillLabel(['u:anouk'], label)).toBe('Anouk');
  });

  test('several: the first name and +N for the rest, a pinned person counted like any token', () => {
    expect(scopePillLabel(['s:txema', 'p:gota'], label)).toBe('Txema Muñoz +1');
    expect(scopePillLabel(['p:gota', 's:txema', 'u:anouk'], label)).toBe('Gota +2');
  });
});
