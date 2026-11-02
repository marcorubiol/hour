import { describe, expect, test } from 'vitest';
import {
  composeMailout,
  fieldsUsed,
  footerLines,
  isAudienceRecipient,
  mailoutLanguage,
  MAILOUT_LANGUAGES,
  suggestedBasis,
  testSubject,
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
  mailout_kind: 'outreach',
  audience_subscription_id: null,
  audience_name: null,
  subscriber_name: null,
  subscribed_at: null,
  venue_name: null,
  venue_city: null,
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
      for (const basis of ['consent', 'relationship', 'generic', 'sector'] as const) {
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

  test('ADR-174: la base que propone la pantalla nunca es la del sector', () => {
    for (const kind of ['contact', 'organization', null] as const) {
      expect(suggestedBasis(kind)).not.toBe('sector');
    }
    expect(suggestedBasis('organization')).toBe('generic');
    expect(suggestedBasis('contact')).toBe('relationship');
  });

  test('ADR-174: la base del sector dice por qué le llega, en su idioma', () => {
    expect(footerLines({ ...ctx, basis_kind: 'sector' }, 'es', URL)[1]).toBe(
      'Os escribimos porque trabajáis en programación o difusión de artes en vivo.',
    );
    expect(footerLines({ ...ctx, basis_kind: 'sector' }, 'ca', URL)[1]).toContain('arts en viu');
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

  test('el HTML lleva el mismo texto que la versión plana, escapado y con enlaces', () => {
    const m = composeMailout({ subject: 's', body: 'Hola <b>\n\nMira https://mamemi.cat/dossier.', language: 'es' }, ctx, URL);
    expect(m.text).toContain('Hola <b>');
    expect(m.html).toContain('Hola &lt;b&gt;</p>');
    expect(m.html).toContain('<a href="https://mamemi.cat/dossier" style="');
    expect(m.html).toContain('>https://mamemi.cat/dossier</a>.');
    expect(m.html).toContain(`href="${URL}"`);
    expect(m.html).toContain('mamemi.cat');
    expect(m.html).not.toContain('<img');
  });

  test('la prueba lleva su marca en el idioma del envío; idioma desconocido, castellano', () => {
    expect(testSubject('Hola', 'ca')).toBe('[Prova] Hola');
    expect(mailoutLanguage('de')).toBe('es');
  });
});

describe('invitaciones (ADR-173 § 10)', () => {
  const invitation: ComposeContext = { ...ctx, mailout_kind: 'invitation', venue_name: 'Teatre Lliure', venue_city: 'Barcelona' };
  const subscriber: ComposeContext = {
    ...invitation,
    address_kind: 'subscriber',
    basis_kind: 'consent',
    contact_first_name: null,
    contact_name: null,
    organization_name: null,
    city: null,
    audience_subscription_id: 's1',
    audience_name: 'Estrenos en Cataluña',
    subscriber_name: 'Núria Vidal',
    subscribed_at: '2026-03-14T10:00:00Z',
  };

  test('{sala} y {ciudad} son los de la función, para un profesional y para el público', () => {
    const draft = { subject: 'Estreno en {sala}', body: 'Hola, {nombre}: en {ciudad}.', language: 'es' };
    const pro = composeMailout(draft, invitation, URL);
    expect(pro.subject).toBe('Estreno en Teatre Lliure');
    expect(pro.text.startsWith('Hola, Laia: en Barcelona.')).toBe(true);
    const aud = composeMailout(draft, subscriber, URL);
    expect(aud.subject).toBe('Estreno en Teatre Lliure');
    expect(aud.text.startsWith('Hola, Núria: en Barcelona.')).toBe(true);
    expect(aud.missing).toEqual([]);
  });

  test('una invitación sin función bloquea {sala} como en la difusión', () => {
    const m = composeMailout({ subject: '{sala}', body: 'x', language: 'es' }, { ...invitation, venue_name: null }, URL);
    expect(m.missing).toEqual(['sala']);
  });

  test('el público sin nombre recibe el saludo sin él, sin bloquear', () => {
    const nameless = { ...subscriber, subscriber_name: null };
    expect(composeMailout({ subject: 's', body: 'Hola, {nombre}:\n\nVen.', language: 'es' }, nameless, URL).text).toMatch(
      /^Hola:\n\nVen\./,
    );
    expect(composeMailout({ subject: 's', body: 'Hello {nombre},', language: 'en' }, nameless, URL).text).toMatch(/^Hello,/);
    expect(composeMailout({ subject: '{nombre}, ven', body: 'x', language: 'es' }, nameless, URL).subject).toBe('ven');
    expect(composeMailout({ subject: 's', body: 'Gracias, {nombre}, por venir.', language: 'es' }, nameless, URL).text).toMatch(
      /^Gracias por venir\./,
    );
    expect(composeMailout({ subject: 's', body: 'Hola, {nombre}', language: 'es' }, nameless, URL).missing).toEqual([]);
  });

  test('un profesional sin nombre sigue bloqueando', () => {
    const m = composeMailout({ subject: 's', body: 'Hola, {nombre}', language: 'es' }, { ...invitation, contact_first_name: null }, URL);
    expect(m.missing).toEqual(['nombre']);
  });

  test('el pie del público: la lista y la fecha, su baja y la privacidad', () => {
    const lines = footerLines({ ...subscriber, privacy_url: 'https://mamemi.cat/privacidad' }, 'es', URL);
    expect(lines).toEqual([
      'MüK Cia · Barcelona · mamemi.cat',
      'Te llega porque te apuntaste a «Estrenos en Cataluña» de MüK Cia el 14 de marzo de 2026.',
      `Darte de baja: ${URL} Un clic basta.`,
      'Política de privacidad: https://mamemi.cat/privacidad',
    ]);
  });

  test('el pie del público por trato previo, y sin fecha si no la hay', () => {
    expect(footerLines({ ...subscriber, basis_kind: 'relationship' }, 'ca', URL)[1]).toBe(
      'Et arriba perquè has estat client de MüK Cia.',
    );
    expect(footerLines({ ...subscriber, subscribed_at: null }, 'en', URL)[1]).toBe(
      'You\'re getting this because you signed up to "Estrenos en Cataluña" from MüK Cia.',
    );
  });

  test('cada idioma tiene el pie del público con su baja', () => {
    for (const lang of MAILOUT_LANGUAGES) {
      for (const basis of ['consent', 'relationship'] as const) {
        const lines = footerLines({ ...subscriber, basis_kind: basis }, lang, URL);
        expect(lines).toHaveLength(3);
        expect(lines[2]).toContain(URL);
      }
    }
  });

  test('un profesional de una invitación lleva el pie de la difusión según su base', () => {
    expect(footerLines({ ...invitation, basis_kind: 'sector' }, 'es', URL)[1]).toBe(
      'Os escribimos porque trabajáis en programación o difusión de artes en vivo.',
    );
    expect(footerLines(invitation, 'es', URL)[2]).toContain('daos de baja');
  });

  test('el origen lo dice la fila, no el envío', () => {
    expect(isAudienceRecipient(subscriber)).toBe(true);
    expect(isAudienceRecipient(invitation)).toBe(false);
  });

  test('las dos ramas visten la misma plantilla (ADR-172)', () => {
    const template = {
      logo: { url: 'https://hour.zerosense.studio/m/ws/x/logo.png', alt: 'MüK', width: null, height: null },
      image: null,
    };
    for (const c of [invitation, subscriber]) {
      expect(composeMailout({ subject: 's', body: 'x', language: 'es' }, c, URL, template).html).toContain('<img');
    }
  });
});
