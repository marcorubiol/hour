import { describe, expect, test } from 'vitest';
import {
  composeMailout,
  fieldsUsed,
  footerLines,
  mailoutLanguage,
  MAILOUT_LANGUAGES,
  testSubject,
  textToHtml,
  unsubscribeHeaders,
  unsubscribeUrl,
  type ComposeContext,
} from './mailout-compose';

const ctx: ComposeContext = {
  recipient_id: 'r1',
  address_kind: 'contact',
  basis_kind: 'relationship',
  contact_first_name: 'Laia',
  contact_name: 'Laia Puig',
  organization_name: 'Teatre de Salt',
  city: 'Salt',
  company_name: 'MüK Cia',
  company_city: 'Barcelona',
  company_website: 'https://www.mamemi.cat/',
  company_phone: null,
  company_signature: null,
  privacy_url: null,
};

const URL = 'https://hour.zerosense.studio/u/abc';

describe('campos', () => {
  test('rellena {nombre}, {sala} y {ciudad} en asunto y cuerpo', () => {
    const m = composeMailout(
      { subject: 'MaMeMi para {sala}', body: 'Hola, {nombre}:\n\n¿Os encaja en {ciudad}?', language: 'es' },
      ctx,
      URL,
    );
    expect(m.subject).toBe('MaMeMi para Teatre de Salt');
    expect(m.text.startsWith('Hola, Laia:\n\n¿Os encaja en Salt?')).toBe(true);
    expect(m.missing).toEqual([]);
  });

  test('el genérico de la sala se saluda al equipo, en el idioma del envío', () => {
    const org = { ...ctx, address_kind: 'organization' as const, contact_first_name: null, basis_kind: 'generic' as const };
    expect(composeMailout({ subject: 's', body: 'Hola, {nombre}', language: 'es' }, org, URL).text).toMatch(
      /^Hola, equipo de Teatre de Salt/,
    );
    expect(composeMailout({ subject: 's', body: 'Hello {nombre}', language: 'en' }, org, URL).text).toMatch(
      /^Hello Teatre de Salt team/,
    );
  });

  test('un campo sin valor se marca, no se envía vacío', () => {
    const m = composeMailout(
      { subject: '{sala}', body: 'Hola, {nombre}, en {ciudad}', language: 'es' },
      { ...ctx, city: null, organization_name: null },
      URL,
    );
    expect(m.missing).toEqual(['sala', 'ciudad']);
    expect(m.subject).toBe('{sala}');
  });

  test('solo cuenta los campos que se usan', () => {
    expect(fieldsUsed('{ciudad} {nombre} {nombre}', '{otro}')).toEqual(['nombre', 'ciudad']);
  });
});

describe('firma y pie', () => {
  test('firma propuesta de la compañía, y el pie con quién, por qué, la baja y sin privacidad si no hay', () => {
    const m = composeMailout({ subject: 's', body: 'Cuerpo', language: 'es' }, ctx, URL);
    expect(m.recordBody).toBe('Cuerpo\n\n-- \nMüK Cia\nmamemi.cat');
    const footer = m.text.slice(m.recordBody.length).trim().split('\n');
    expect(footer).toEqual([
      'MüK Cia · Barcelona · mamemi.cat',
      'Os escribimos porque ya hemos trabajado juntos.',
      `Si no queréis recibir más envíos de MüK Cia, daos de baja aquí: ${URL} Un clic basta.`,
    ]);
  });

  test('la firma guardada manda; la privacidad sale si la hay', () => {
    const m = composeMailout(
      { subject: 's', body: 'Cuerpo', language: 'ca' },
      { ...ctx, company_signature: 'Marco\nMüK', privacy_url: 'https://mamemi.cat/privacitat', basis_kind: 'consent' },
      URL,
    );
    expect(m.recordBody).toBe('Cuerpo\n\n-- \nMarco\nMüK');
    expect(m.text).toContain('Us escrivim perquè ens vau demanar rebre les nostres propostes.');
    expect(m.text).toContain('Política de privacitat: https://mamemi.cat/privacitat');
  });

  test('cada idioma tiene su pie, y el enlace de baja nunca falta', () => {
    for (const lang of MAILOUT_LANGUAGES) {
      for (const basis of ['consent', 'relationship', 'generic'] as const) {
        const lines = footerLines({ ...ctx, basis_kind: basis }, lang, URL);
        expect(lines).toHaveLength(3);
        expect(lines[2]).toContain(URL);
      }
    }
  });

  test('el historial no lleva el pie ni el enlace de baja', () => {
    const m = composeMailout({ subject: 's', body: 'Cuerpo', language: 'fr' }, ctx, URL);
    expect(m.recordBody).not.toContain(URL);
    expect(m.text).toContain(URL);
    expect(m.text).toContain('Un clic suffit.');
  });

  test('sin base no inventa una razón', () => {
    expect(footerLines({ ...ctx, basis_kind: null }, 'es', URL)).toHaveLength(2);
  });
});

describe('cabeceras y enlaces', () => {
  test('baja en un clic: las dos cabeceras de RFC 8058', () => {
    expect(unsubscribeHeaders(URL)).toEqual({
      'List-Unsubscribe': `<${URL}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(unsubscribeUrl('https://hour.zerosense.studio/', 'tok')).toBe('https://hour.zerosense.studio/u/tok');
  });

  test('el HTML gemelo escapa y enlaza, sin estilos', () => {
    const html = textToHtml('Hola <b>\n\nMira https://mamemi.cat/dossier.');
    expect(html).toContain('<p>Hola &lt;b&gt;</p>');
    expect(html).toContain('<a href="https://mamemi.cat/dossier">https://mamemi.cat/dossier</a>.');
    expect(html).not.toContain('style');
  });

  test('la prueba lleva su marca en el idioma del envío; idioma desconocido, castellano', () => {
    expect(testSubject('Hola', 'ca')).toBe('[Prova] Hola');
    expect(mailoutLanguage('de')).toBe('es');
  });
});
