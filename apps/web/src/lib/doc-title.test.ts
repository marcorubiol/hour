import { describe, expect, it } from 'vitest';
import { docTitle } from './doc-title';

describe('docTitle', () => {
  it('is «hour» alone with nothing to name', () => {
    expect(docTitle()).toBe('hour');
  });
  it('puts the screen first and joins with a middle dot', () => {
    expect(docTitle('Planificador')).toBe('Planificador · hour');
    expect(docTitle('Teatre de la Llum', 'Conversación')).toBe('Teatre de la Llum · Conversación · hour');
  });
  it('skips the parts that are not there yet', () => {
    expect(docTitle(null, ' ', 'Cuentas', undefined)).toBe('Cuentas · hour');
  });
});
