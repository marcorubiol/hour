import { describe, expect, it } from 'vitest';
import { docTitle } from './doc-title';

describe('docTitle', () => {
  it('is «Hour» alone for the Hall', () => {
    expect(docTitle()).toBe('Hour');
  });
  it('puts the screen first and joins with a middle dot', () => {
    expect(docTitle('Planificador')).toBe('Planificador · Hour');
    expect(docTitle('Teatre de la Llum', 'Conversación')).toBe('Teatre de la Llum · Conversación · Hour');
  });
  it('skips the parts that are not there yet', () => {
    expect(docTitle(null, ' ', 'Cuentas', undefined)).toBe('Cuentas · Hour');
  });
});
