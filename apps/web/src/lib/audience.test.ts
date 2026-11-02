import { describe, expect, test } from 'vitest';
import * as v from 'valibot';
import { embedCode, formUrl, ImportSchema, parseCsv, readAudienceCsv } from './audience';

describe('el CSV de una importación (plan § 3.6)', () => {
  test('reconoce correo, nombre e idioma por su cabecera, en cualquier idioma y con punto y coma', () => {
    const r = readAudienceCsv('﻿Nombre;Correo electrónico;Idioma\r\nNúria Vidal;Nuria@Example.cat;CA\r\n;anon@example.cat;\r\n');
    expect(r.columns).toEqual({ email: 'Correo electrónico', name: 'Nombre', language: 'Idioma' });
    expect(r.rows).toEqual([
      { email: 'nuria@example.cat', name: 'Núria Vidal', language: 'ca' },
      { email: 'anon@example.cat', name: null, language: null },
    ]);
    expect(r.total).toBe(2);
  });

  test('sin cabecera, la primera columna con una dirección', () => {
    const r = readAudienceCsv('Laia,laia@example.cat\nJoan,joan@example.cat\n');
    expect(r.columns.email).toBeNull();
    expect(r.rows.map((x) => x.email)).toEqual(['laia@example.cat', 'joan@example.cat']);
  });

  test('las comillas guardan comas y saltos dentro de una celda', () => {
    expect(parseCsv('email,name\n"a@b.cat","Puig, Laia"\n')).toEqual([
      ['email', 'name'],
      ['a@b.cat', 'Puig, Laia'],
    ]);
  });

  test('sin ninguna dirección no inventa filas; la base decide lo mal formado', () => {
    expect(readAudienceCsv('nombre,ciudad\nLaia,Salt\n').rows).toEqual([]);
    expect(readAudienceCsv('email\nno-es-correo\n').rows).toEqual([{ email: 'no-es-correo', name: null, language: null }]);
  });
});

describe('importar pide base, fuente y la declaración', () => {
  const ok = {
    rows: [{ email: 'a@b.cat' }],
    basis_kind: 'consent',
    source_note: 'Formulario de la web, 2022 a 2026',
    statement_accepted: true,
    statement_language: 'es',
  };
  test('completa, pasa', () => {
    expect(v.safeParse(ImportSchema, ok).success).toBe(true);
  });
  test('sin base, sin fuente, con fuente corta o sin aceptar la declaración, no', () => {
    expect(v.safeParse(ImportSchema, { ...ok, basis_kind: undefined }).success).toBe(false);
    expect(v.safeParse(ImportSchema, { ...ok, basis_kind: 'generic' }).success).toBe(false);
    expect(v.safeParse(ImportSchema, { ...ok, source_note: '' }).success).toBe(false);
    expect(v.safeParse(ImportSchema, { ...ok, source_note: 'web' }).success).toBe(false);
    expect(v.safeParse(ImportSchema, { ...ok, statement_accepted: false }).success).toBe(false);
  });
});

describe('enlaces del formulario (plan § 3.2)', () => {
  test('la URL va por clave y el iframe a /embed, con el título escapado', () => {
    expect(formUrl('https://hour.zerosense.studio/', 'abc')).toBe('https://hour.zerosense.studio/public/audience/abc');
    const code = embedCode('https://hour.zerosense.studio', 'abc', 'Estrenos "MüK" & más');
    expect(code).toContain('src="https://hour.zerosense.studio/public/audience/abc/embed"');
    expect(code).toContain('title="Estrenos &quot;MüK&quot; &amp; más"');
    expect(code).toContain('loading="lazy"');
  });
});
