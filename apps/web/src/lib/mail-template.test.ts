import { describe, expect, test } from 'vitest';
import { imageSize, mailHtml, mailTemplate, mailUrl, NO_TEMPLATE, type MailParts } from './mail-template';

const ORIGIN = 'https://hour.test';
const WS = '20000000-0000-4000-8000-000000000001';
const LOGO = `/m/ws/${WS}/logo/${'a'.repeat(32)}-480x120.png`;
const IMAGE = `/m/ws/${WS}/mail/${'b'.repeat(32)}-1200x800.jpg`;

const parts: MailParts = {
  language: 'ca',
  subject: 'MaMeMi per a Teatre de Salt',
  body: 'Hola, Laia:\n\nUs escrivim per MaMeMi.\nEns parlem?',
  signature: 'MüK Cia\nmamemi.cat',
  footer: ['MüK Cia · Barcelona', 'Baixa: https://hour.test/u/tok Un clic.'],
};

const row = {
  company_name: 'MüK Cia',
  logo_url: LOGO,
  image_url: IMAGE,
  image_alt: 'MaMeMi, foto de escena',
  image_link_url: 'https://mamemi.cat/dossier.pdf',
};

/** El texto visible de un HTML: sin etiquetas, con las entidades de aquí resueltas. */
function visibleText(html: string): string {
  return html
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/<br>/g, '\n')
    .replace(/<\/p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

describe('la caja del correo', () => {
  test('sin logo ni imagen: tablas de 600 px, estilos en línea, sin imágenes ni hojas de estilo', () => {
    const html = mailHtml(parts);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="ca">');
    expect(html).toContain('role="presentation" width="600"');
    expect(html).toContain('max-width:600px');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('class=');
    expect(html).not.toMatch(/<script/i);
  });

  test('lleva el mismo texto que la versión plana: cuerpo, firma y pie, en orden', () => {
    const text = visibleText(mailHtml(parts, mailTemplate(row, ORIGIN)));
    const order = ['Hola, Laia:', 'Us escrivim per MaMeMi.', 'Ens parlem?', 'MüK Cia\nmamemi.cat', 'MüK Cia · Barcelona', 'Baixa: https://hour.test/u/tok Un clic.'];
    let at = 0;
    for (const piece of order) {
      const i = text.indexOf(piece, at);
      expect(i, piece).toBeGreaterThanOrEqual(at);
      at = i + piece.length;
    }
  });

  test('pesa poco', () => {
    expect(new TextEncoder().encode(mailHtml(parts, mailTemplate(row, ORIGIN))).byteLength).toBeLessThan(8_000);
  });
});

describe('logo', () => {
  test('con logo: arriba, con alt de la compañía y tamaño a la mitad del fichero', () => {
    const html = mailHtml(parts, mailTemplate({ ...row, image_url: null, image_alt: null, image_link_url: null }, ORIGIN));
    expect(html).toContain(`<img src="${ORIGIN}${LOGO}" alt="MüK Cia" width="240" height="60"`);
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('Hola, Laia'));
    expect(html.match(/<img/g)).toHaveLength(1);
  });

  test('un logo alto se ajusta a la altura máxima', () => {
    const tall = `/m/ws/${WS}/logo/${'c'.repeat(32)}-200x400.png`;
    expect(mailHtml(parts, mailTemplate({ ...row, logo_url: tall, image_url: null, image_alt: null, image_link_url: null }, ORIGIN))).toContain(
      'width="32" height="64"',
    );
  });

  test('sin logo no hay cabecera', () => {
    const html = mailHtml(parts, mailTemplate({ ...row, logo_url: null }, ORIGIN));
    expect(html.match(/<img/g)).toHaveLength(1);
    expect(html.indexOf('<img')).toBeGreaterThan(html.indexOf('Ens parlem?'));
  });
});

describe('imagen del espectáculo', () => {
  test('tras el cuerpo y antes de la firma, a 600 px, enlazada al dossier, con su alt', () => {
    const html = mailHtml(parts, mailTemplate({ ...row, logo_url: null }, ORIGIN));
    expect(html).toContain(
      `<a href="https://mamemi.cat/dossier.pdf" style="color:#1f1f1f;text-decoration:underline;font-family:`,
    );
    expect(html).toContain(`<img src="${ORIGIN}${IMAGE}" alt="MaMeMi, foto de escena" width="600" height="400"`);
    expect(html).toMatch(/<img[^>]*;width:100%/);
    const img = html.indexOf('<img');
    expect(img).toBeGreaterThan(html.indexOf('Ens parlem?'));
    expect(img).toBeLessThan(html.indexOf('mamemi.cat</p>'));
  });

  test('sin dossier no enlaza; sin alt guardado, el de la compañía', () => {
    const html = mailHtml(parts, mailTemplate({ ...row, logo_url: null, image_link_url: null, image_alt: null }, ORIGIN));
    expect(html).not.toContain('dossier.pdf');
    expect(html).toContain('alt="MüK Cia"');
  });

  test('una imagen más estrecha que la caja no se estira', () => {
    const small = `/m/ws/${WS}/mail/${'d'.repeat(32)}-400x300.jpg`;
    const html = mailHtml(parts, mailTemplate({ ...row, logo_url: null, image_url: small }, ORIGIN));
    expect(html).toContain('width="400" height="300"');
    expect(html).not.toMatch(/<img[^>]*;width:100%/);
  });

  test('sin imagen: nada entre el cuerpo y la firma', () => {
    expect(mailHtml(parts, mailTemplate({ ...row, logo_url: null, image_url: null }, ORIGIN))).not.toContain('<img');
    expect(mailHtml(parts, NO_TEMPLATE)).toBe(mailHtml(parts, mailTemplate(null, ORIGIN)));
  });
});

describe('escapes', () => {
  test('el texto, el asunto, el alt y los enlaces se escapan', () => {
    const evil: MailParts = {
      ...parts,
      subject: '</title><script>x</script>',
      body: '<img src=x onerror=alert(1)> & "comillas" \'simples\'',
      signature: '<b>firma</b>',
    };
    const html = mailHtml(
      evil,
      mailTemplate({ ...row, company_name: '"><script>', image_alt: '" onerror="alert(1)', image_link_url: 'https://a.test/?q="><x' }, ORIGIN),
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>firma');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;comillas&quot; &#39;simples&#39;');
    expect(html).toContain('alt="&quot; onerror=&quot;alert(1)"');
    expect(html).toContain('alt="&quot;&gt;&lt;script&gt;"');
    expect(html).not.toContain('"><x');
  });

  test('solo http(s) o rutas de Hour; nada de javascript: ni data:', () => {
    expect(mailUrl('javascript:alert(1)', ORIGIN)).toBeNull();
    expect(mailUrl('data:image/png;base64,AAAA', ORIGIN)).toBeNull();
    expect(mailUrl('//evil.test/x.png', ORIGIN)).toBeNull();
    expect(mailUrl('/m/ws/x/logo/a.png', `${ORIGIN}/`)).toBe(`${ORIGIN}/m/ws/x/logo/a.png`);
    expect(mailUrl('https://mamemi.cat/d.pdf', ORIGIN)).toBe('https://mamemi.cat/d.pdf');
    const html = mailHtml(parts, mailTemplate({ ...row, logo_url: 'javascript:alert(1)', image_link_url: 'javascript:alert(1)' }, ORIGIN));
    expect(html).not.toContain('javascript:');
    expect(html.match(/<img/g)).toHaveLength(1);
  });
});

describe('tamaño en el nombre', () => {
  test('lee el tamaño de una imagen de Hour; sin él, null', () => {
    expect(imageSize(IMAGE)).toEqual({ width: 1200, height: 800 });
    expect(imageSize('https://cdn.test/foto.jpg')).toBeNull();
    expect(imageSize(`/m/ws/x/mail/a-0x10.jpg`)).toBeNull();
  });

  test('una imagen de tamaño desconocido se pinta al ancho de la caja, sin alto', () => {
    const html = mailHtml(parts, mailTemplate({ ...row, logo_url: null, image_url: 'https://cdn.test/foto.jpg' }, ORIGIN));
    expect(html).toContain('alt="MaMeMi, foto de escena" width="600" style=');
  });
});
