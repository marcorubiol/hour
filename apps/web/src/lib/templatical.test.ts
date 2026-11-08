import { describe, expect, test } from 'vitest';
import source from './templatical.ts?raw';
import pkg from '../../package.json';

/**
 * La licencia de Templatical pide, al redistribuirlo, los términos o un enlace
 * a ellos y el copyright (ADR-190). El aviso vive en la cabecera `/*!` de la
 * puerta, que el minificador conserva en el chunk que se sirve.
 */
describe('aviso de licencia de Templatical', () => {
  const banner = source.split('\n')[0];

  test('la puerta empieza por un comentario legal con copyright, licencia y enlace', () => {
    expect(banner.startsWith('/*! @license')).toBe(true);
    expect(banner).toContain('Copyright 2026-present Templatical');
    expect(banner).toContain('FSL-1.1-MIT');
    expect(banner).toContain('https://github.com/templatical/sdk/blob/main/LICENSE');
  });

  test('nombra la versión exacta que fija package.json', () => {
    const version = pkg.dependencies['@templatical/editor'];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(banner).toContain(version);
  });
});
