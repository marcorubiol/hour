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
    expect(san(`<img src="/m/ws/${WS}/mail/a1a1a1a1-1x1.jpg" alt="a">`)).toContain(`src="/m/ws/${WS}/mail/a1a1a1a1-1x1.jpg"`);
    expect(san('<img src="/m/ws/99999999-2222-3333-4444-555555555555/mail/a1a1a1a1-1x1.jpg">')).not.toContain('<img');
    expect(isHourMailImage('/m/ws/99999999-2222-3333-4444-555555555555/mail/a1a1a1a1-1x1.jpg')).toBe(true);
  });

  test('CSS: sin comentarios ni barras que partan url( o @import, sin position', () => {
    const out = san('<style>.a{background:u/**/rl(https://x.test/a.png)} .b{background:\\75rl(https://x.test/b.png)} @im/**/port "https://x.test/c.css"; .mj-c{position:fixed;color:red}</style>');
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
    const pair = '<!--[if mso | IE]><table role="presentation"><tr><td style="width:600px;"><![endif]--><p>x</p><!--[if mso | IE]></td></tr></table><![endif]-->';
    expect(san(pair)).toContain('<!--[if mso | IE]><table role="presentation"><tr><td style="width:600px;"><![endif]-->');
    expect(san(pair)).toContain('<!--[if mso | IE]></td></tr></table><![endif]-->');
    expect(san('<!--[if mso | IE]><table style="background:url(https://evil/x.png)"><![endif]-->')).not.toContain('evil');
  });
});

describe('la segunda verificación (2026-11-08, t1.mts)', () => {
  const OTHER = '22222222-2222-2222-2222-222222222222';
  const tags = (h: string) => (san(h).match(/<[^>]+>/g) ?? []).join(' ');
  const cases: [string, string, RegExp][] = [
    ['url() con comillas mezcladas', `<style>.a{background:url("https://evil.com/a'b.png")}</style><div style="background:url('https://evil.com/x&quot;y.png')">x</div><div style="background-image:url(&quot;https://evil.com/c'd.png&quot;)">y</div>`, /evil/],
    ['image-set', `<style>.a{background-image:image-set("https://evil.com/t.png" 1x)}</style><div style="background-image:-webkit-image-set('https://evil.com/u.png' 1x)">x</div>`, /evil|image-set/],
    ['@font-face', '<style>@font-face{font-family:x;src:url(https://evil.com/f.woff)}</style>', /evil|font-face/],
    ['condicional que se revela sin cerrar', '<p>hi</p><!--[if !mso]><!-->', /<!--/],
    ['condicional que abre y no cierra, con mso-hide', '<p>hi</p><!--[if mso]><table><tr><td style="mso-hide:all"><![endif]-->', /<!--|mso-hide/],
    ['imagen de otro espacio dentro de un condicional', `<!--[if mso]><div style="background:url(/m/ws/${OTHER}/mail/c3c3c3c3-1x1.png)"></div><![endif]-->`, new RegExp(OTHER)],
    ['<body> dentro de una cadena CSS', '<style>.x{content:"<body>"}</style><p>a</p>', /content/],
    ['propiedades que esconden', '<style>p{max-height:0!important;overflow:hidden!important;text-indent:-9999px} .r{zoom:.01;transform:scale(0);clip:rect(0 0 0 0);filter:opacity(0);visibility:hidden;opacity:0}</style>', /max-height|overflow|text-indent|zoom|transform|clip|filter|visibility|opacity/],
    ['href a una imagen de otro espacio', `<a href="/m/ws/${OTHER}/mail/c3c3c3c3-1x1.png">x</a>`, new RegExp(OTHER)],
    ['nombre de imagen que no es de Hour', `<img src="/m/ws/${WS}/mail/..">`, /<img/],
    ['condicionales anidados para colar un script', '<!--[if mso]><table width="1"><![endif]--><!--[if mso]>--><script>alert(1)</script><!--<![endif]-->', /<!--|script/],
    ['@import partido con barra', `<style>@im\\port url(https://e.com/x.css); @import"https://e.com/y.css"; @IMPORT 'z';</style>`, /import|e\.com/],
    ['url() escapado', '<style>.a{background:u\\72l(https://evil.com/x)}</style>', /evil/],
    ['fondo de body con comillas mezcladas', `<body style="background:url(&quot;https://evil.com/b'.png&quot;)"><p>x</p></body>`, /evil/],
    ['clase del pie en el diseño', '<p class="hour-foot-faint">x</p><style>.hour-foot-faint{color:#fff}</style>', /hour-/],
  ];
  test.each(cases)('%s', (_name, dirty, bad) => {
    expect(tags(dirty)).not.toMatch(bad);
  });

  test('un solo <title>', () => {
    expect(san('<title>x</title><p>a</p><title>y</title>').match(/<title>/g)?.length).toBe(1);
  });
});

describe('la tercera pasada (2026-11-08, t3.mts y t4.mts)', () => {
  const img = `/m/ws/${WS}/mail/abcdef12-10x10.png`;

  test.each([
    ['tipo y combinadores', '<style>body>table:last-child td{background-color:#767676!important}</style>'],
    ['a con fondo', '<style>a{background-color:#767676!important}</style>'],
    ['p con fondo', '<style>p{background:#767676!important}</style>'],
    ['td alto', '<style>body>table:last-child td{height:20000px!important}</style>'],
    ['borde enorme', '<style>body>table:last-child>tbody>tr>td{border-left:5000px solid #fff!important}</style>'],
    ['ancho mínimo', '<style>body>table:last-child{width:1px!important}</style>'],
    ['todo con *', '<style>body>table:last-child *{font:0px/0 a!important}</style>'],
    ['border-spacing', '<style>body>table:last-child table{border-spacing:0 9000px!important}</style>'],
    ['clase inventada', '<style>div.k{outline:3000px solid #ffffff}.k{color:red}</style>'],
  ])('la hoja no alcanza el pie: %s', (_name, sheet) => {
    expect(san(sheet + '<p>x</p>')).not.toContain('<style');
  });

  test('una hoja con las clases de MJML se queda', () => {
    expect(san('<style>.mj-column-per-50{width:50%!important;max-width:50%}</style>')).toContain('.mj-column-per-50{width:50%!important;max-width:50%}');
  });

  test('a solo admite color y subrayado', () => {
    const out = san('<style>a{color:#ff0000;text-decoration:none;background-color:#767676;font-size:0}</style>');
    expect(out).toContain('a{color:#ff0000;text-decoration:none}');
  });

  test.each([
    ['outline enorme', 'outline:3000px solid #ffffff'],
    ['margen negativo', 'margin-bottom:-5000px'],
    ['alto enorme', 'height:30000px'],
    ['borde enorme', 'border-left:5000px solid #fff'],
    ['relleno enorme', 'padding:0 0 0 5000px'],
    ['border-spacing enorme', 'border-spacing:0 9000px'],
  ])('en línea, valores fuera de su tope: %s', (_name, css) => {
    expect(san(`<div style="${css}">x</div>`)).toContain('<div>x</div>');
  });

  test.each([
    [`<div style="background:url(${img}) , url('//evil.com/a.png')">a</div>`],
    [`<div style="background:url(${img})url(//evil.com/x)">b</div>`],
    [`<div style="background-image:image(&quot;//evil.com/x.png&quot;)">c</div>`],
    [`<div style="background-image:cross-fade(url(${img}), &quot;//evil.com/y&quot; 50%)">d</div>`],
    ['<style>@media screen{.mj-a{background:url(//evil.com/m)}} @font-face{src:url(//e)} @supports (x){.mj-c{color:red}}</style>'],
    ['<style>.mj-a{color:"}";background:url(//evil.com/z)}</style>'],
    [`<style>.mj-a{background:url(${img}?//evil.com)}</style>`],
    [`<div style="background:url(&quot;${img}&quot;)x://y">e</div>`],
    ['<style>.mj-a{font-family:"x://y"}</style><div style="cursor:url(//evil.com/c),auto">f</div>'],
    ['<style>.mj-a{list-style:url(//evil.com/l)}</style>'],
  ])('ninguna dirección de fuera: %s', (dirty) => {
    expect(san(dirty)).not.toMatch(/evil|\/\/e\b|x:\/\//);
  });

  test('mso-* solo los que escribe MJML', () => {
    const h = '<!--[if mso]><div style="mso-line-height-rule:exactly;mso-text-raise:-9999px;mso-font-width:1%"><![endif]--><p>x</p><!--[if mso]></div><![endif]-->';
    expect(san(h)).not.toContain('<!--');
    expect(san('<td style="mso-line-height-rule:exactly;mso-text-raise:-9999px">x</td>')).toContain('style="mso-line-height-rule:exactly"');
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
    expect(clean).toContain(`src="/m/ws/${WS}/mail/a1b2c3d4e5f60718-1200x1500.jpg"`);
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

  test('los ataques medidos en Chromium (t2.mts) ya no pasan la hoja', () => {
    const out = san('<style>p.m-faint{max-height:0!important;overflow:hidden!important}a{font-size:0!important}td.m-rule{zoom:.01!important}p{text-indent:-9999px!important}body{max-height:300px!important;overflow:hidden!important}</style><p>x</p>');
    expect(out).not.toMatch(/max-height|overflow|zoom|text-indent/);
  });

  test('cada elemento del pie lleva fijado en línea lo que lo puede encoger, y clases hour-', () => {
    const out = designedHtml(san('<p>x</p>'), footer);
    const foot = out.slice(out.lastIndexOf('<table role="presentation" width="100%"'));
    const link = /<a [^>]*>/.exec(foot)![0];
    for (const pin of ['font-size:12px!important', 'line-height:1.5!important', 'max-height:none!important', 'overflow:visible!important', 'zoom:1!important', 'transform:none!important', 'clip:auto!important', 'color:#767676!important', 'visibility:visible!important']) {
      expect(link).toContain(pin);
    }
    expect(foot).toContain('background-color:#ffffff!important');
    expect(foot).toContain('class="hour-foot-faint"');
    expect(foot).not.toContain('class="m-faint"');
  });

  test('el pie: fondo transparente dentro de su banda blanca, sin bordes salvo su raya, alto automático', () => {
    const out = designedHtml(san('<p>x</p>'), footer);
    const foot = out.slice(out.lastIndexOf('<table role="presentation" width="100%"'));
    for (const tag of ['td', 'p', 'a']) {
      const el = new RegExp(`<${tag} [^>]*>`).exec(foot)![0];
      expect(el).toContain('background-color:transparent!important');
      expect(el).toContain('height:auto!important');
    }
    expect(foot).toMatch(/<table [^>]*border-spacing:0!important/);
    expect(foot).toMatch(/border-top:1px solid #e2e2e2!important[^"]*border-left:0!important/);
  });

  test('el reset de MJML lo pone Hour, el primero en la cabecera', () => {
    const out = designedHtml(san('<p>x</p>'), footer);
    expect(out).toMatch(/<head><style type="text\/css">#outlook a\{padding:0\}body\{margin:0/);
  });

  test('el pie arranca donde el texto de los bloques (10 px a cada lado)', () => {
    const out = designedHtml(san('<p>x</p>'), footer);
    expect(out).toContain('padding:0 10px 24px');
  });

  test('el pie y body llevan sus estilos con !important en línea', () => {
    const out = designedHtml(san('<style>table{display:none!important}*{font-size:0!important}</style><p>x</p>'), footer);
    const foot = out.slice(out.lastIndexOf('<table role="presentation" width="100%"'));
    expect(foot).toContain('display:table!important');
    expect(foot).toContain('font-size:12px!important');
    expect(/<body style="[^"]*display:block!important/.test(out)).toBe(true);
  });
});
