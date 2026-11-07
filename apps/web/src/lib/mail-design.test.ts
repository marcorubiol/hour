import { describe, expect, test } from 'vitest';
import {
  checkDesign,
  designedHtml,
  designText,
  htmlToText,
  isSafeLink,
  prepareDesign,
  sanitizeDesignHtml,
  type DesignContent,
} from './mail-design';
import { composeMailout, type ComposeContext } from './mailout-compose';
import { mailTemplate } from './mail-template';

const WS = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-2222-3333-4444-555555555555';
const IMG = `/m/ws/${WS}/mail/abc-1200x1500.jpg`;

const content = (blocks: Record<string, unknown>[]): DesignContent => ({ blocks, settings: { width: 600 } });

const sample = content([
  { id: 'a', type: 'image', src: IMG, alt: 'Cartel de MaMeMi', width: 'full', linkUrl: 'https://mukcia.com/mamemi', styles: {} },
  { id: 'b', type: 'title', content: 'Estreno de MaMeMi', level: 1, styles: {} },
  {
    id: 'c',
    type: 'section',
    columns: '2',
    styles: {},
    children: [
      [{ id: 'd', type: 'paragraph', content: '<p>Hola, {nombre}:</p><p>Te esperamos el <strong>{fecha}</strong>.</p>', styles: {} }],
      [{ id: 'e', type: 'button', text: 'Reservar', url: 'https://salahiroshima.net/mamemi', styles: {} }],
    ],
  },
  { id: 'f', type: 'divider', styles: {} },
  { id: 'g', type: 'image', src: IMG, alt: 'decoración', decorative: true, styles: {} },
]);

describe('checkDesign', () => {
  test('un diseño con los bloques de la paleta y una imagen de Hour vale', () => {
    expect(checkDesign(sample, WS)).toBeNull();
  });

  test('forma: sin blocks o sin settings', () => {
    expect(checkDesign({ blocks: [] }, WS)).toBe('design_shape');
    expect(checkDesign(null, WS)).toBe('design_shape');
    expect(checkDesign({ blocks: [{ type: 1 }], settings: {} }, WS)).toBe('design_shape');
  });

  test('un bloque fuera de la paleta (html, vídeo, redes) no entra', () => {
    for (const type of ['html', 'video', 'social', 'countdown', 'custom', 'menu', 'table']) {
      expect(checkDesign(content([{ type, styles: {} }]), WS)).toBe('design_block');
    }
  });

  test('ni dentro de una sección, ni una sección dentro de otra', () => {
    expect(checkDesign(content([{ type: 'section', children: [[{ type: 'html' }]] }]), WS)).toBe('design_block');
    expect(checkDesign(content([{ type: 'section', children: [[{ type: 'section', children: [] }]] }]), WS)).toBe(
      'design_block',
    );
  });

  test('las imágenes son de Hour y de este espacio', () => {
    expect(checkDesign(content([{ type: 'image', src: 'https://evil.test/x.png' }]), WS)).toBe('design_image');
    expect(checkDesign(content([{ type: 'image', src: `/m/ws/${OTHER}/mail/x-1x1.png` }]), WS)).toBe('design_image');
    expect(checkDesign(content([{ type: 'image', src: '' }]), WS)).toBeNull();
    expect(
      checkDesign(content([{ type: 'section', children: [], backgroundImage: { url: 'https://evil.test/bg.jpg' } }]), WS),
    ).toBe('design_image');
  });

  test('los enlaces son http(s) o mailto', () => {
    expect(checkDesign(content([{ type: 'button', url: 'javascript:alert(1)' }]), WS)).toBe('design_link');
    expect(checkDesign(content([{ type: 'image', src: IMG, linkUrl: 'data:text/html,x' }]), WS)).toBe('design_link');
    expect(isSafeLink('mailto:hola@mukcia.com')).toBe(true);
    expect(isSafeLink('')).toBe(true);
  });

  test('tope de tamaño', () => {
    const big = content([{ type: 'paragraph', content: 'x'.repeat(270_000) }]);
    expect(checkDesign(big, WS)).toBe('design_too_large');
  });
});

describe('sanitizeDesignHtml', () => {
  test('quita scripts, marcos, formularios, on* y javascript:', () => {
    const dirty =
      '<html><head><script>alert(1)</script><link rel="stylesheet" href="https://x.test/a.css"><meta http-equiv="refresh" content="0;url=https://x.test"></head>' +
      '<body><iframe src="https://x.test"></iframe><form action="https://x.test"><input name="a"></form>' +
      '<a href="javascript:alert(1)" onclick="x()">a</a><img src="data:image/png;base64,AAA" onerror="x()">' +
      '<td style="background:url(javascript:alert(1))">t</td><p>Hola</p></body></html>';
    const clean = sanitizeDesignHtml(dirty);
    for (const bad of ['<script', 'alert(1)</script', '<iframe', '<form', '<input', 'onclick', 'onerror', 'javascript:', 'data:image', '<link', 'refresh']) {
      expect(clean.toLowerCase()).not.toContain(bad);
    }
    expect(clean).toContain('<p>Hola</p>');
  });

  test('sin @import ni url() de fuera en las hojas ni en los estilos en línea', () => {
    const dirty =
      '<style>@import url("https://fonts.googleapis.com/css?family=Ubuntu");@import "https://x.test/a.css";.a{background:url(https://x.test/bg.png)}.b{background:url(\'/m/ws/w/mail/a-1x1.jpg\')}</style>' +
      '<td style="background-image:url(https://x.test/t.png);color:#000">t</td><div style="background:url(/m/ws/w/mail/b-1x1.jpg)">b</div>';
    const clean = sanitizeDesignHtml(dirty);
    expect(clean).not.toContain('@import');
    expect(clean).not.toContain('x.test');
    expect(clean).not.toContain('googleapis');
    expect(clean).toContain("url('/m/ws/w/mail/a-1x1.jpg')");
    expect(clean).toContain('url(/m/ws/w/mail/b-1x1.jpg)');
    expect(clean).toContain('color:#000');
  });

  test('deja lo de MJML: estilos, tablas y condicionales de Outlook', () => {
    const mjml =
      '<!doctype html><html><head><style type="text/css">.x{color:#000}</style><!--[if mso | IE]><table><tr><td><![endif]--></head><body style="word-spacing:normal;"><table role="presentation"><tr><td><a href="https://a.test">a</a></td></tr></table></body></html>';
    expect(sanitizeDesignHtml(mjml)).toBe(mjml);
  });
});

describe('designText', () => {
  test('el texto en el orden en que se lee: título, columnas, botón, imagen enlazada', () => {
    expect(designText(sample)).toBe(
      [
        'Cartel de MaMeMi: https://mukcia.com/mamemi',
        'Estreno de MaMeMi',
        'Hola, {nombre}:\n\nTe esperamos el {fecha}.',
        'Reservar: https://salahiroshima.net/mamemi',
      ].join('\n\n'),
    );
  });

  test('un campo del editor (ficha) vuelve a ser {campo}', () => {
    expect(htmlToText('<p>Hola, <span data-merge-tag="{nombre}">nombre</span>: te esperamos en <span data-merge-tag="{sala}">sala</span>.</p>')).toBe(
      'Hola, {nombre}: te esperamos en {sala}.',
    );
  });

  test('htmlToText: enlaces, listas, saltos y entidades', () => {
    expect(htmlToText('<p>Ver <a href="https://a.test">el dossier</a> &amp; más</p><ul><li>uno</li><li>dos</li></ul>')).toBe(
      'Ver el dossier (https://a.test) & más\n\n· uno\n· dos',
    );
    expect(htmlToText('<p><a href="https://a.test">https://a.test</a><br>línea&nbsp;2</p>')).toBe('https://a.test\nlínea 2');
  });
});

describe('prepareDesign', () => {
  test('devuelve el JSON, el HTML limpio y el texto que será el body', () => {
    const r = prepareDesign({ content: sample, html: '<html><body><script>x</script><p>ok</p></body></html>' }, WS);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.html).not.toContain('<script');
    expect(r.body).toContain('Hola, {nombre}:');
  });

  test('un diseño sin texto no se guarda: el correo necesita su versión de texto', () => {
    expect(prepareDesign({ content: content([{ type: 'divider' }]), html: '<p>x</p>' }, WS)).toEqual({ error: 'design_empty' });
  });

  test('el error de la comprobación sube tal cual', () => {
    expect(prepareDesign({ content: content([{ type: 'html' }]), html: '<p>x</p>' }, WS)).toEqual({ error: 'design_block' });
  });
});

describe('designedHtml', () => {
  const html = '<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><head></head><body style="margin:0"><img src="/m/ws/x/mail/a.jpg"><p>Hola</p></body></html>';

  test('lang, imágenes absolutas, previsualización al principio y pie al final', () => {
    const out = designedHtml(html, {
      language: 'ca',
      origin: 'https://hour.zerosense.studio/',
      preheader: 'Estrenem MaMeMi',
      footer: ['Et arriba perquè…'],
      footerHtml: { why: ['Et arriba perquè…'], links: [{ label: 'Donar-te de baixa', url: 'https://h.test/u/t' }] },
    });
    expect(out).toContain('<html lang="ca" xmlns=');
    expect(out).toContain('src="https://hour.zerosense.studio/m/ws/x/mail/a.jpg"');
    expect(out.indexOf('Estrenem MaMeMi')).toBeLessThan(out.indexOf('<p>Hola</p>'));
    expect(out.indexOf('Donar-te de baixa')).toBeGreaterThan(out.indexOf('<p>Hola</p>'));
    expect(out.indexOf('Donar-te de baixa')).toBeLessThan(out.indexOf('</body>'));
  });

  test('un lang que ya trae se cambia por el del texto', () => {
    const out = designedHtml(html.replace('<html ', '<html lang="en" '), {
      language: 'es',
      origin: null,
      preheader: null,
      footer: [],
      footerHtml: null,
    });
    expect(out).toContain('lang="es"');
    expect(out).not.toContain('lang="en"');
  });
});

describe('composeMailout con diseño (ADR-190)', () => {
  const ctx: ComposeContext = {
    recipient_id: 'r1',
    address_kind: 'subscriber',
    basis_kind: 'consent',
    contact_first_name: null,
    contact_name: null,
    organization_name: null,
    city: null,
    company_name: 'MüK Cia',
    company_city: 'Barcelona',
    company_website: 'https://mukcia.com',
    company_phone: null,
    company_signature: null,
    privacy_url: null,
    mailout_kind: 'invitation',
    audience_subscription_id: 's1',
    audience_name: 'Estrenos',
    subscriber_name: 'Núria <Puig>',
    subscribed_at: '2026-11-02T10:00:00Z',
    venue_name: 'Sala Hiroshima',
    venue_city: 'Barcelona',
    project_name: 'MaMeMi',
    performed_at: '2026-11-14',
    performance_start_at: '2026-11-14T17:00:00Z',
    performance_timezone: 'Europe/Madrid',
  };
  const designHtml = '<html><head></head><body><p>Hola, {nombre}:</p><p>{sala}, {hora}</p></body></html>';
  const template = mailTemplate(
    { company_name: 'MüK Cia', logo_url: null, image_url: null, image_alt: null, image_link_url: null, design_html: designHtml },
    'https://hour.zerosense.studio',
  );
  const draft = { subject: 'Estreno', body: 'Hola, {nombre}:\n\n{sala}, {hora}', language: 'es' };

  test('el HTML es el diseño con los campos escapados y el pie de Hour', () => {
    const m = composeMailout(draft, ctx, 'https://h.test/u/t', template);
    expect(m.html).toContain('<p>Hola, Núria:</p>');
    expect(m.html).toContain('<p>Sala Hiroshima, 18:00</p>');
    expect(m.html).toContain('Darte de baja');
    expect(m.html).toContain('MüK Cia · Barcelona · mukcia.com');
    expect(m.missing).toEqual([]);
  });

  test('un valor con < > sale escapado en el HTML', () => {
    const m = composeMailout(draft, { ...ctx, venue_name: '<b>Sala</b>' }, 'https://h.test/u/t', template);
    expect(m.html).toContain('&lt;b&gt;Sala&lt;/b&gt;');
    expect(m.html).not.toContain('<b>Sala</b>');
  });

  test('el texto plano es el body derivado y el pie, sin firma ni bloque de la función', () => {
    const m = composeMailout(draft, ctx, 'https://h.test/u/t', template);
    expect(m.text.startsWith('Hola, Núria:\n\nSala Hiroshima, 18:00\n\nMüK Cia · Barcelona · mukcia.com')).toBe(true);
    expect(m.text).not.toContain('Cuándo:');
    expect(m.recordBody).toBe('Hola, Núria:\n\nSala Hiroshima, 18:00');
  });

  test('un campo sin valor en el diseño bloquea ese correo, como en la carta', () => {
    const m = composeMailout(draft, { ...ctx, venue_name: null }, 'https://h.test/u/t', template);
    expect(m.missing).toEqual(['sala']);
  });

  test('una difusión ignora el diseño: sigue siendo carta', () => {
    const m = composeMailout(draft, { ...ctx, mailout_kind: 'outreach' }, 'https://h.test/u/t', template);
    expect(m.html).toContain('font-family:');
    expect(m.html).not.toContain('<p>Hola, Núria:</p><p>');
  });
});
