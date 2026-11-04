import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import es from './i18n/es.json';
import ca from './i18n/ca.json';
import en from './i18n/en.json';
import fr from './i18n/fr.json';
import * as v from 'valibot';
import {
  addPersonOutcome,
  alsoSubscribed,
  AudienceAddSchema,
  draftChoices,
  embedCode,
  formUrl,
  ImportSchema,
  parseCsv,
  readAudienceCsv,
} from './audience';

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

describe('la declaración aceptada es la que guarda la base (plan § 3.6)', () => {
  const sql = readFileSync(
    join(import.meta.dirname, '..', '..', '..', '..', 'supabase', 'migrations', '20261102180100_audience.sql'),
    'utf8',
  );
  test('cada idioma y cada base, palabra por palabra en import_audience', () => {
    for (const dict of [es, ca, en, fr] as Record<string, string>[]) {
      for (const key of ['audience.import_statement_consent', 'audience.import_statement_relationship']) {
        const asSql = dict[key].replace(/'/g, "''").replace('{company}', "' || v_company || '");
        expect(sql, `${key}: ${dict[key]}`).toContain(asSql);
      }
    }
  });
});

describe('alta a mano (tarea 101)', () => {
  test('el esquema limpia la dirección y rechaza lo que no es correo o un idioma que no hay', () => {
    expect(v.parse(AudienceAddSchema, { address: '  Ana@Example.TEST ', name: ' Ana ' })).toEqual({ address: 'ana@example.test', name: 'Ana' });
    expect(v.safeParse(AudienceAddSchema, { address: 'no-es-correo' }).success).toBe(false);
    expect(v.safeParse(AudienceAddSchema, { address: `${'a'.repeat(250)}@b.cd` }).success).toBe(false);
    expect(v.safeParse(AudienceAddSchema, { address: 'a@b.cd', language: 'de' }).success).toBe(false);
    expect(v.safeParse(AudienceAddSchema, { address: 'a@b.cd', language: 'ca' }).success).toBe(true);
  });

  test('qué pasó: con confirmación pedida, lo que dijo el envío; sin ella, confirmada o el cupo', () => {
    expect(addPersonOutcome(true, 'sent', 'pending')).toBe('sent');
    expect(addPersonOutcome(true, 'failed', 'pending')).toBe('failed');
    expect(addPersonOutcome(true, null, 'pending')).toBe('no_route');
    expect(addPersonOutcome(false, null, 'confirmed')).toBe('confirmed');
    expect(addPersonOutcome(false, null, 'pending')).toBe('recent');
    expect(addPersonOutcome(false, null, null)).toBe('recent');
  });

  test('cada resultado tiene su aviso en los cuatro idiomas', () => {
    for (const dict of [es, ca, en, fr] as Record<string, string>[]) {
      for (const o of ['sent', 'no_route', 'failed', 'confirmed', 'recent']) expect(dict[`audience.added_${o}`]).toContain('{address}');
    }
  });
});

describe('«también está apuntada a» y «añadir a un borrador» (tarea 103)', () => {
  test('las otras listas: sin bajas, sin la de origen, una vez cada una y por nombre', () => {
    const rows = [
      { audience_id: 'a3', status: 'confirmed' as const, audience: { name: 'Teatro' } },
      { audience_id: 'a1', status: 'confirmed' as const, audience: { name: 'Origen' } },
      { audience_id: 'a2', status: 'pending' as const, audience: { name: 'Barcelona' } },
      { audience_id: 'a4', status: 'unsubscribed' as const, audience: { name: 'Baja' } },
      { audience_id: 'a2', status: 'pending' as const, audience: { name: 'Barcelona' } },
      { audience_id: 'a5', status: 'confirmed' as const, audience: null },
    ];
    expect(alsoSubscribed(rows, 'a1')).toEqual([
      { audience_id: 'a2', name: 'Barcelona', status: 'pending' },
      { audience_id: 'a3', name: 'Teatro', status: 'confirmed' },
    ]);
    expect(alsoSubscribed(rows).map((a) => a.audience_id)).toEqual(['a2', 'a1', 'a3']);
  });

  test('los borradores: sin el que ya lleva esta lista, lo último arriba', () => {
    const drafts = [
      { id: 'm1', subject: 'A', created_at: '2026-11-01T10:00:00Z', audience: null },
      { id: 'm2', subject: 'B', created_at: '2026-11-03T10:00:00Z', audience: { id: 'a1', name: 'Esta' } },
      { id: 'm3', subject: 'C', created_at: '2026-11-02T10:00:00Z', audience: { id: 'a2', name: 'Otra' } },
    ];
    expect(draftChoices(drafts, 'a1').map((d) => d.id)).toEqual(['m3', 'm1']);
  });
});
