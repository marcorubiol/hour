import { describe, expect, test } from 'vitest';
import { parseDocument } from 'htmlparser2';
import type { Element } from 'domhandler';
import { isHourMailImage, sanitizeMailHtml } from './mail-sanitize';
import { designedHtml, prepareDesign } from './mail-design';
import mjml from './fixtures/designed-mjml.html?raw';

const WS = '11111111-2222-3333-4444-555555555555';
const san = (h: string) => sanitizeMailHtml(h, { workspaceId: WS });
const bodyOf = (h: string) => /<body[^>]*>([\s\S]*)<\/body>/.exec(h)?.[1] ?? '';

describe('los casos de la revisión de seguridad (2026-11-08)', () => {
  const cases: [string, string][] = [
    ['etiqueta partida', '<scr<script>ipt>alert(1)</scr<script>ipt>'],
    ['on* sin espacio tras la barra', '<img/onerror=alert(1) src=x>'],
    ['on* pegado a otra comilla', '<img src="x"onerror="alert(1)">'],
    ['javascript: con entidad', '<a href="&#106;avascript:alert(1)">x</a>'],
    ['javascript: con tabulador', '<a href="java&#9;script:alert(1)">x</a>'],
    ['href pegado a otro atributo', '<a title="t"href="javascript:alert(1)">x</a>'],
    ['iframe partido', '<if<iframe>rame src="https://evil"></iframe>'],
    ['formulario partido', '<fo<form>rm action="https://evil"><inp<input>ut name=p></form>'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil">'],
    ['meta refresh al revés', '<meta content="0;url=https://evil" http-equiv=refresh>'],
    ['@import en una hoja', '<style>@import url(https://evil/x.css)</style>'],
    ['url() de fuera en línea', '<div style="background:url(https://track/p.png)"></div>'],
    ['imagen de fuera', '<img src="https://tracker.example/p.gif">'],
    ['xlink en math', '<math><mi xlink:href="javascript:alert(1)">x</mi></math>'],
  ];

  test.each(cases)('%s', (_name, dirty) => {
    // Only markup counts: a leftover of a split tag stays as escaped text.
    const out = (san(dirty).match(/<[^>]+>/g) ?? []).join(' ').toLowerCase();
    for (const bad of ['<script', '<iframe', '<form', '<input', 'onerror', 'javascript:', 'refresh', '@import', 'evil', 'tracker', 'track/', '<math', 'xlink']) {
      expect(out).not.toContain(bad);
    }
  });

  test('lo que queda de una etiqueta partida es texto escapado, no marcado', () => {
    const out = bodyOf(san('<scr<script>ipt>alert(1)</scr<script>ipt>'));
    expect(out).not.toMatch(/<[a-z]/i);
  });

  test('un enlace bueno se queda, decodificado y escapado', () => {
    expect(san('<a href="https://a.test/?x=1&amp;y=2" target="_blank">x</a>')).toContain(
      '<a href="https://a.test/?x=1&amp;y=2" target="_blank" rel="noopener">x</a>',
    );
    expect(san('<a href="mailto:hola@mukcia.com">x</a>')).toContain('href="mailto:hola@mukcia.com"');
  });

  test('las imágenes, solo de Hour y de este espacio', () => {
    expect(san(`<img src="/m/ws/${WS}/mail/a-1x1.jpg" alt="a">`)).toContain(`src="/m/ws/${WS}/mail/a-1x1.jpg"`);
    expect(san('<img src="/m/ws/99999999-2222-3333-4444-555555555555/mail/a-1x1.jpg">')).not.toContain('<img');
    expect(isHourMailImage('/m/ws/99999999-2222-3333-4444-555555555555/mail/a-1x1.jpg')).toBe(true);
  });

  test('CSS: sin comentarios ni barras que partan url( o @import, sin position', () => {
    const out = san('<style>.a{background:u/**/rl(https://x.test/a.png)} .b{background:\\75rl(https://x.test/b.png)} @im/**/port "https://x.test/c.css"; .c{position:fixed;color:red}</style>');
    expect(out).not.toMatch(/url\([^)]*x\.test/);
    expect(out).not.toMatch(/@import/);
    expect(out).not.toContain('position');
    expect(out).toContain('color:red');
  });

  test('una hoja no puede cerrar su <style> antes de tiempo', () => {
    const out = san('<style>.a{color:red}</style><style>p{content:"</style><script>alert(1)</script>"}</style>');
    expect(out).not.toContain('<script');
  });

  test('comentarios: fuera los que no son de Outlook; los de Outlook, solo con lo que pone MJML', () => {
    expect(san('<p>a</p><!-- oculto --><p>b</p>')).not.toContain('<!--');
    expect(san('<!--[if mso]><img src="https://evil/x.png"><![endif]-->')).not.toContain('evil');
    expect(san('<!--[if mso | IE]><table role="presentation"><tr><td style="width:600px;"><![endif]-->')).toContain('<!--[if mso | IE]>');
    expect(san('<!--[if mso | IE]><table style="background:url(https://evil/x.png)"><![endif]-->')).not.toContain('evil');
  });
});

describe('el HTML real de MJML (Templatical 0.56.1, todos los bloques)', () => {
  const clean = san(mjml);
  const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;

  test('no pierde estructura: tablas, celdas, estilos, imagen, enlaces y condicionales de Outlook', () => {
    expect(count(clean, /<table\b/g)).toBe(count(mjml, /<table\b/g));
    expect(count(clean, /<!--/g)).toBe(count(mjml, /<!--/g)); // every Outlook conditional MJML writes survives
    expect(count(clean, /<td\b/g)).toBeGreaterThan(0);
    expect(count(clean, /<!--\[if mso \| IE\]>/g)).toBe(count(mjml, /<!--\[if mso \| IE\]>/g));
    expect(clean).toContain('<!--[if mso]>');
    expect(clean).toContain('<!--[if lte mso 11]>');
    expect(clean).toContain('<!--[if !mso]><!-->');
    expect(count(clean, /<style\b/g)).toBe(count(mjml, /<style\b/g));
    expect(clean).toContain(`src="/m/ws/${WS}/mail/abc-1200x1500.jpg"`);
    expect(clean).toContain('href="https://salahiroshima.net/x"');
    expect(clean).toContain('href="https://mukcia.com"');
    expect(clean).toContain('{nombre}');
    expect(clean).toContain('@media only screen and (min-width:480px)');
  });

  test('limpiar dos veces da lo mismo', () => {
    expect(san(clean)).toBe(clean);
  });

  test('pasa prepareDesign sin perder el cuerpo', () => {
    const r = prepareDesign({ content: { blocks: [{ type: 'paragraph', content: '<p>Hola</p>' }], settings: {} }, html: mjml }, WS);
    expect('error' in r).toBe(false);
  });
});

describe('el pie no se puede esconder (ADR-190)', () => {
  const footer = {
    language: 'es',
    origin: null,
    preheader: null,
    footer: ['Te llega porque…'],
    footerHtml: { why: ['Te llega porque…'], links: [{ label: 'Darte de baja', url: 'https://h.test/u/t' }] },
  };

  /** The footer's table must be a direct child of <body>, after everything of the design. */
  function footerIsLastBodyChild(html: string): boolean {
    const doc = parseDocument(html);
    const find = (nodes: Element[] | undefined, name: string): Element | undefined => {
      for (const n of nodes ?? []) {
        if (n.type === 'tag' && n.name === name) return n;
        const deeper = find((n as Element).children as Element[], name);
        if (deeper) return deeper;
      }
      return undefined;
    };
    const body = find(doc.children as Element[], 'body');
    const kids = (body?.children ?? []).filter((c) => c.type === 'tag') as Element[];
    const last = kids[kids.length - 1];
    return Boolean(last && last.name === 'table' && JSON.stringify(last.attribs) && /Darte de baja/.test(html.slice(html.lastIndexOf('<table'))));
  }

  for (const [name, dirty] of [
    ['comentario sin cerrar', '<p>hola</p><!-- '],
    ['div oculto sin cerrar', '<p>hola</p><div style="display:none">'],
    ['</body> dentro de un comentario', '<p>hola</p><!-- </body> -->'],
    ['tabla sin cerrar', '<table><tr><td>hola'],
  ] as const) {
    test(name, () => {
      const out = designedHtml(san(dirty), footer);
      expect(out).toContain('Darte de baja');
      expect(footerIsLastBodyChild(out)).toBe(true);
      expect(out.lastIndexOf('Darte de baja')).toBeGreaterThan(out.lastIndexOf('hola'));
    });
  }

  test('el pie y body llevan sus estilos con !important en línea', () => {
    const out = designedHtml(san('<style>table{display:none!important}*{font-size:0!important}</style><p>x</p>'), footer);
    const foot = out.slice(out.lastIndexOf('<table role="presentation" width="100%"'));
    expect(foot).toContain('display:table!important');
    expect(foot).toContain('font-size:12px!important');
    expect(/<body style="[^"]*display:block!important/.test(out)).toBe(true);
  });
});
