/**
 * Limpiar el HTML de un correo diseñado (ADR-190) con un parser y listas
 * blancas, no con expresiones regulares sobre el texto: htmlparser2 construye
 * el árbol y aquí se vuelve a escribir entero, con lo que se admite y nada más.
 *
 *   · Etiquetas: las que da MJML y el texto enriquecido de Templatical
 *     (tablas, `div`, `p`, encabezados, listas, énfasis, enlaces, imágenes,
 *     `style` y `meta` en la cabecera). Lo peligroso (`script`, `iframe`,
 *     formularios, `svg`, `math`, `object`…) se va con su contenido; una
 *     etiqueta desconocida se va y deja su contenido como texto.
 *   · Atributos: por lista; ningún `on*`. Los enlaces, `http(s)` o `mailto`
 *     ya decodificados y sin espacios ni controles; las imágenes, solo las de
 *     Hour (`/m/ws/<espacio>/mail/…`, ADR-172): una `<img>` de fuera se quita.
 *   · CSS (hojas y `style=`): sin `@import`, sin `url()` que no sea de Hour,
 *     sin `expression`, `behavior`, `-moz-binding` ni `position`; sin
 *     comentarios ni escapes con barra, que servían para partir palabras.
 *   · Comentarios: solo los condicionales de Outlook que escribe MJML, y solo
 *     si lo de dentro son las etiquetas y atributos que MJML pone ahí. Los
 *     demás se quitan: un comentario podía tapar el pie.
 *
 * La salida está escrita aquí: un solo `<html>`, `<head>` y `<body>`, todo
 * cerrado, texto y atributos escapados. Por eso `mail-design.ts` puede poner
 * el pie justo antes del último `</body>` sin que quede dentro de nada.
 *
 * Funciona igual en el Worker, en la cola y en el navegador.
 */

import { parseDocument } from 'htmlparser2';
import type { ChildNode, Element } from 'domhandler';

/** Una imagen de envío de Hour; con espacio, solo las de ese espacio. */
export function isHourMailImage(src: string, workspaceId?: string | null): boolean {
  const m = /^\/m\/ws\/([0-9a-f-]{36})\/mail\/[A-Za-z0-9._-]+$/.exec(src);
  return Boolean(m) && (!workspaceId || m![1] === workspaceId);
}

const DROP_WITH_CONTENT = new Set([
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'textarea',
  'select', 'option', 'svg', 'math', 'noscript', 'template', 'base', 'link', 'audio', 'video', 'source', 'canvas',
  'portal', 'xml',
]);

const ALLOWED = new Set([
  'html', 'head', 'title', 'meta', 'style', 'body', 'div', 'span', 'p', 'br', 'hr', 'a', 'img', 'table', 'thead',
  'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b',
  'em', 'i', 'u', 's', 'strike', 'sub', 'sup', 'small', 'ul', 'ol', 'li', 'blockquote', 'center', 'font', 'pre', 'code',
]);

const VOID = new Set(['meta', 'br', 'hr', 'img', 'col']);

const ATTRS = new Set([
  'style', 'class', 'align', 'valign', 'width', 'height', 'border', 'cellpadding', 'cellspacing', 'bgcolor', 'role',
  'dir', 'lang', 'title', 'alt', 'colspan', 'rowspan', 'aria-roledescription', 'aria-hidden', 'aria-label', 'color',
  'face', 'size', 'start', 'type',
]);

const HTML_ATTRS = new Set(['lang', 'dir', 'xmlns', 'xmlns:v', 'xmlns:o']);
const XMLNS: Record<string, string> = {
  xmlns: 'http://www.w3.org/1999/xhtml',
  'xmlns:v': 'urn:schemas-microsoft-com:vml',
  'xmlns:o': 'urn:schemas-microsoft-com:office:office',
};

export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Un valor de URL ya decodificado, sin espacios ni controles (que partían «java\tscript:»). */
function compact(url: string): string {
  return url.replace(/[\u0000-\u0020\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\ufeff]+/g, '');
}

/** `href`: http(s) o mailto; también una ruta de Hour (se hace absoluta al montar). */
function safeHref(raw: string): string | null {
  const url = compact(raw);
  if (/^https?:\/\/[^\s<>"]+$/i.test(url) || /^mailto:[^\s<>"]+$/i.test(url)) return raw.trim();
  return /^\/m\/ws\//.test(url) && isHourMailImage(url.split(/[?#]/)[0]) ? url : null;
}

// ── CSS ────────────────────────────────────────────────────────────────────

const BLOCKED_PROPS = /^(position|behavior|-moz-binding|-o-link|-o-link-source)$/i;

function cleanUrls(css: string, workspaceId?: string | null): string {
  return css.replace(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi, (whole, _q: string, target: string) =>
    isHourMailImage(target.trim(), workspaceId) ? whole : 'none',
  );
}

/** Una hoja de `<style>`. */
export function cleanSheet(css: string, workspaceId?: string | null): string {
  let out = css
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, '')
    .replace(/\\/g, '')
    .replace(/@import\b[^;{}]*;?/gi, '')
    .replace(/expression\s*\(/gi, 'invalid(')
    .replace(/javascript\s*:|vbscript\s*:/gi, 'invalid:')
    .replace(/(^|[;{\s])(position|behavior|-moz-binding|-o-link|-o-link-source)\s*:[^;}]*;?/gi, '$1');
  out = cleanUrls(out, workspaceId);
  // Nothing can close the element early.
  return out.replace(/<\//g, '<\\/').replace(/<!--|-->/g, '');
}

/** Un `style=`: declaración a declaración. */
export function cleanInline(css: string, workspaceId?: string | null): string {
  return css
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, '')
    .replace(/\\/g, '')
    .split(';')
    .map((d) => d.trim())
    .filter((d) => {
      const i = d.indexOf(':');
      if (i <= 0) return false;
      const prop = d.slice(0, i).trim();
      const value = d.slice(i + 1);
      if (BLOCKED_PROPS.test(prop) || /^[^a-z-]/i.test(prop)) return false;
      if (/expression\s*\(|javascript\s*:|vbscript\s*:|@import/i.test(value)) return false;
      return !/url\(/i.test(value) || cleanUrls(value, workspaceId) === value;
    })
    .join(';');
}

// ── Comentarios de Outlook ─────────────────────────────────────────────────

const MSO_TAGS = new Set(['table', 'tr', 'td', 'tbody', 'div', 'p', 'noscript', 'xml', 'style', 'o:officedocumentsettings', 'o:allowpng', 'o:pixelsperinch']);
const MSO_ATTRS = new Set(['align', 'border', 'cellpadding', 'cellspacing', 'class', 'role', 'style', 'width', 'height', 'valign', 'bgcolor', 'type']);
/** El texto que MJML deja entre esas etiquetas: espacios, el 96 de PixelsPerInch, el &nbsp; del separador. */
const MSO_TEXT = /^(?:\s|\d|&nbsp;)*$/;
/** La única hoja que MJML pone dentro de un condicional. */
const MSO_SHEET = /^\s*\.mj-outlook-group-fix\s*\{\s*width:\s*100%\s*!important;\s*\}\s*$/;

/** Lo de dentro de un condicional: solo las etiquetas, atributos y textos de MJML. */
function msoInnerOk(inner: string): boolean {
  const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9:]*)((?:\s+[a-zA-Z:-]+(?:\s*=\s*"[^"<>]*")?)*)\s*(\/?)>/g;
  let last = 0;
  let inStyle = false;
  for (const m of inner.matchAll(TAG)) {
    const text = inner.slice(last, m.index);
    if (inStyle ? !MSO_SHEET.test(text) : !MSO_TEXT.test(text)) return false;
    last = (m.index ?? 0) + m[0].length;
    const name = m[2].toLowerCase();
    if (!MSO_TAGS.has(name)) return false;
    inStyle = name === 'style' && m[1] !== '/';
    for (const a of m[3].matchAll(/([a-zA-Z:-]+)(?:\s*=\s*"([^"<>]*)")?/g)) {
      if (!MSO_ATTRS.has(a[1].toLowerCase())) return false;
      if (a[1].toLowerCase() === 'style' && a[2] !== undefined && cleanInline(a[2]) !== a[2].trim().replace(/;\s*$/, '').split(';').map((d) => d.trim()).filter(Boolean).join(';')) {
        return false;
      }
    }
  }
  return MSO_TEXT.test(inner.slice(last));
}

/** El comentario tal cual si es un condicional de Outlook de MJML; si no, null. */
function msoComment(data: string): string | null {
  if (data === '[if !mso]><!' || data === '<![endif]') return data;
  const m = /^\[if (!?mso(?: \| IE)?|(?:lte|lt|gte|gt) mso \d{1,2}|IE)\]>([\s\S]*)<!\[endif\]$/.exec(data);
  return m && msoInnerOk(m[2]) ? data : null;
}

// ── Escribir el árbol ──────────────────────────────────────────────────────

export interface SanitizeOptions {
  /** Al guardar: las imágenes, solo de este espacio. Al montar, cualquiera de Hour. */
  workspaceId?: string | null;
}

/**
 * El HTML limpio y bien formado: `<!doctype html><html><head>…</head><body>…</body></html>`,
 * con un solo `<head>` y un solo `<body>` aunque la entrada no los tenga.
 */
export function sanitizeMailHtml(html: string, opts: SanitizeOptions = {}): string {
  const ws = opts.workspaceId ?? null;
  const doc = parseDocument(html, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  const head: string[] = [];
  const body: string[] = [];
  let htmlAttrs = '';
  let bodyAttrs = '';

  const attrsOf = (el: Element): string => {
    const out: string[] = [];
    for (const [rawName, value] of Object.entries(el.attribs)) {
      const name = rawName.toLowerCase();
      if (name === 'href') {
        if (el.name !== 'a') continue;
        const href = safeHref(value);
        if (href) out.push(`href="${escapeAttr(href)}"`);
      } else if (name === 'src' || name === 'background') {
        const src = compact(value);
        if (isHourMailImage(src, ws)) out.push(`${name}="${escapeAttr(src)}"`);
      } else if (name === 'target') {
        if (el.name === 'a' && value === '_blank') out.push('target="_blank" rel="noopener"');
      } else if (name === 'style') {
        const css = cleanInline(value, ws);
        if (css) out.push(`style="${escapeAttr(css)}"`);
      } else if (name === 'type') {
        if (el.name === 'style' && /^text\/css$/i.test(value.trim())) out.push('type="text/css"');
        if ((el.name === 'ol' || el.name === 'ul') && /^[1aAiI]$|^(disc|circle|square)$/.test(value.trim())) out.push(`type="${escapeAttr(value.trim())}"`);
      } else if (ATTRS.has(name)) {
        out.push(`${name}="${escapeAttr(value)}"`);
      } else if (name === 'media' && el.name === 'style') {
        if (/^[a-z0-9 ():,.-]+$/i.test(value)) out.push(`media="${escapeAttr(value)}"`);
      }
    }
    return out.length ? ` ${out.join(' ')}` : '';
  };

  const meta = (el: Element): string => {
    const a = el.attribs;
    if (a.charset) return '<meta charset="utf-8">';
    const equiv = (a['http-equiv'] ?? '').toLowerCase();
    if (equiv === 'content-type') return '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">';
    if (equiv === 'x-ua-compatible') return '<meta http-equiv="X-UA-Compatible" content="IE=edge">';
    if (equiv) return '';
    const name = (a.name ?? '').toLowerCase();
    const OK: Record<string, RegExp> = {
      viewport: /^[a-z0-9=,.\- ]+$/i,
      'x-apple-disable-message-reformatting': /^.*$/,
      'color-scheme': /^[a-z ]+$/i,
      'supported-color-schemes': /^[a-z ]+$/i,
      'format-detection': /^[a-z=, ]+$/i,
    };
    return OK[name] && OK[name].test(a.content ?? '') ? `<meta name="${name}" content="${escapeAttr(a.content ?? '')}">` : '';
  };

  const write = (nodes: ChildNode[], out: string[], inHead: boolean): void => {
    for (const node of nodes) {
      switch (node.type) {
        case 'text':
          if (!inHead) out.push(escapeText(node.data));
          break;
        case 'comment': {
          const kept = msoComment(node.data);
          if (kept) out.push(`<!--${kept}-->`);
          break;
        }
        case 'tag':
        case 'script':
        case 'style': {
          const el = node as Element;
          const name = el.name.toLowerCase();
          if (DROP_WITH_CONTENT.has(name)) break;
          if (name === 'html') {
            htmlAttrs = Object.entries(el.attribs)
              .filter(([k]) => HTML_ATTRS.has(k))
              .map(([k, v]) => (k.startsWith('xmlns') ? `${k}="${XMLNS[k]}"` : `${k}="${escapeAttr(v)}"`))
              .join(' ');
            write(el.children, out, inHead);
            break;
          }
          if (name === 'head') {
            write(el.children, head, true);
            break;
          }
          if (name === 'body') {
            const bg = cleanInline(el.attribs.style ?? '', ws)
              .split(';')
              .filter((d) => /^(background-color|background|word-spacing)\s*:/i.test(d))
              .join(';');
            bodyAttrs = bg;
            write(el.children, body, false);
            break;
          }
          if (name === 'style') {
            const css = el.children.map((c) => (c.type === 'text' ? c.data : '')).join('');
            head.push(`<style${attrsOf(el)}>${cleanSheet(css, ws)}</style>`);
            break;
          }
          if (name === 'title') {
            const t = el.children.map((c) => (c.type === 'text' ? c.data : '')).join('');
            head.push(`<title>${escapeText(t)}</title>`);
            break;
          }
          if (name === 'meta') {
            const m = meta(el);
            if (m) head.push(m);
            break;
          }
          if (inHead) break;
          if (!ALLOWED.has(name)) {
            // Unknown tag: gone, its content stays (as text if that is all it is).
            write(el.children, out, inHead);
            break;
          }
          if (name === 'img' && !isHourMailImage(compact(el.attribs.src ?? ''), ws)) break;
          out.push(`<${name}${attrsOf(el)}>`);
          if (!VOID.has(name)) {
            write(el.children, out, inHead);
            out.push(`</${name}>`);
          }
          break;
        }
        default:
          break;
      }
    }
  };

  write(doc.children, body, false);
  return [
    '<!doctype html>',
    `<html${htmlAttrs ? ` ${htmlAttrs}` : ''}>`,
    `<head>${head.join('')}</head>`,
    `<body${bodyAttrs ? ` style="${escapeAttr(bodyAttrs)}"` : ''}>`,
    body.join(''),
    '</body>',
    '</html>',
  ].join('');
}
