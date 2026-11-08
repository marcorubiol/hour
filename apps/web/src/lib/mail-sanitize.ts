/**
 * Limpiar el HTML de un correo diseñado (ADR-190) con un parser y listas
 * blancas, nunca listas negras: htmlparser2 construye el árbol y aquí se
 * vuelve a escribir entero, con lo que se admite y nada más.
 *
 *   · Etiquetas: las que da MJML y el texto enriquecido de Templatical. Lo
 *     peligroso se va con su contenido; una etiqueta desconocida se va y deja
 *     su contenido como texto.
 *   · Atributos: por lista; ningún `on*`. Los enlaces, `http(s)` o `mailto`
 *     ya decodificados y sin espacios ni controles; las imágenes, solo las de
 *     Hour (`/m/ws/<espacio>/mail/<sha>-<ancho>x<alto>.<ext>`, ADR-172).
 *   · CSS, en hojas y en `style=`: un pequeño analizador propio (reglas,
 *     `@media`, declaraciones). Selectores: solo las clases que escriben MJML
 *     y Templatical (`mj-…`, `tpl-…`), y `a` para el color de los enlaces;
 *     nada de tipos, combinadores ni `:last-child`, así que una hoja no llega
 *     al pie (el reset de MJML lo pone Hour). Propiedades: las que emite MJML
 *     para la paleta, cada una con sus valores acotados (márgenes y rellenos no
 *     negativos y con tope, `outline` solo `none`, bordes, alturas y anchos con
 *     tope, `mso-*` por lista exacta). Funciones: solo `url()` de Hour y
 *     `rgb()`; comillas solo en `url()` y en nombres de fuente; ningún `//`
 *     fuera de `url()`; ningún `<` en la salida.
 *   · Comentarios: solo los condicionales de Outlook de MJML, con lo de
 *     dentro por lista, emparejados (`[if !mso]><!` con su `<![endif]`) y con
 *     sus etiquetas equilibradas en todo el documento. Si algo no cuadra se
 *     quitan todos: Outlook pierde el maquetado, no se abre nada.
 *
 * La salida está escrita aquí: un solo `<html>`, `<head>` y `<body>`, todo
 * cerrado, texto y atributos escapados, `</head><body` una sola vez. Por eso
 * `mail-design.ts` puede poner el pie justo antes del último `</body>`.
 *
 * Funciona igual en el Worker, en la cola y en el navegador.
 */

import { parseDocument } from 'htmlparser2';
import type { ChildNode, Element } from 'domhandler';

/** Una imagen de envío de Hour (`<sha>-<ancho>x<alto>.<ext>`); con espacio, solo las de ese espacio. */
export function isHourMailImage(src: string, workspaceId?: string | null): boolean {
  const m = /^\/m\/ws\/([0-9a-f-]{36})\/mail\/[0-9a-f]{8,64}-\d{1,5}x\d{1,5}\.(?:png|jpe?g)$/.exec(src);
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
  'align', 'valign', 'width', 'height', 'border', 'cellpadding', 'cellspacing', 'bgcolor', 'role', 'dir', 'lang',
  'title', 'alt', 'colspan', 'rowspan', 'aria-roledescription', 'aria-hidden', 'aria-label', 'color', 'face', 'size',
  'start',
]);

const HTML_ATTRS = new Set(['lang', 'dir', 'xmlns', 'xmlns:v', 'xmlns:o']);
const XMLNS: Record<string, string> = {
  xmlns: 'http://www.w3.org/1999/xhtml',
  'xmlns:v': 'urn:schemas-microsoft-com:vml',
  'xmlns:o': 'urn:schemas-microsoft-com:office:office',
};

/** Never in the output text: the placeholder of a comment while the document is checked. */
const MARK = String.fromCharCode(0);

export function escapeText(s: string): string {
  return s.split(MARK).join('').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s.split(MARK).join('').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Un valor de URL ya decodificado, sin espacios ni controles (que partían «java\tscript:»). */
function compact(url: string): string {
  return url.replace(CONTROLS, '');
}
const CONTROLS = new RegExp(
  '[' + ['0000-\\u0020', '007f-\\u009f', '00ad', '200b-\\u200f', '2028', '2029', 'feff'].map((r) => `\\u${r}`).join('') + ']+',
  'g',
);

/** `href`: http(s) o mailto; también una imagen de Hour (se hace absoluta al montar). */
function safeHref(raw: string, workspaceId: string | null): string | null {
  const url = compact(raw);
  if (/^https?:\/\/[^\s<>"]+$/i.test(url) || /^mailto:[^\s<>"]+$/i.test(url)) return raw.trim();
  return isHourMailImage(url, workspaceId) ? url : null;
}

// ── CSS: lista blanca de propiedades y de valores ──────────────────────────

/** A value split into tokens at spaces and commas, keeping `url(…)` and `rgb(…)` whole; null if unbalanced. */
function tokens(value: string): string[] | null {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let quote = '';
  for (const c of value) {
    if (quote) {
      cur += c;
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === '(') {
      depth++;
      cur += c;
    } else if (c === ')') {
      if (--depth < 0) return null;
      cur += c;
    } else if (depth === 0 && (/\s/.test(c) || c === ',')) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += c;
  }
  if (quote || depth) return null;
  if (cur) out.push(cur);
  return out;
}

type Units = Partial<Record<'px' | '%' | 'em' | 'rem' | 'pt' | '', number>>;

/** A length within its ceiling for its unit (non-negative unless `min` says otherwise). */
function len(tok: string, units: Units, min = 0): boolean {
  const m = /^(-?\d{1,5}(?:\.\d{1,4})?)(px|%|em|rem|pt)?$/.exec(tok);
  if (!m) return false;
  const n = Number(m[1]);
  const max = units[(m[2] ?? '') as keyof Units];
  if (max === undefined && !(n === 0 && !m[2])) return false;
  return n >= min && n <= (max ?? 0);
}

function isColor(tok: string): boolean {
  return (
    /^#[0-9a-f]{3,8}$/i.test(tok) ||
    /^rgba?\(\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*(,\s*(0|1|0?\.\d{1,3}))?\s*\)$/i.test(tok) ||
    /^[a-z]{3,20}$/i.test(tok)
  );
}

const oneOf = (...words: string[]) => (tok: string) => words.includes(tok.toLowerCase());
const SPACING: Units = { px: 200, em: 10, rem: 10, '%': 100, pt: 150 };
const SIZE: Units = { px: 1200, '%': 100, em: 60, rem: 60 };
const BORDER_W: Units = { px: 10, pt: 8 };
const RADIUS: Units = { px: 100, '%': 50 };
const BORDER_STYLE = oneOf('none', 'hidden', 'solid', 'dashed', 'dotted', 'double');
const POSITION = oneOf('left', 'right', 'top', 'bottom', 'center');
const REPEAT = oneOf('repeat', 'no-repeat', 'repeat-x', 'repeat-y');

type Check = (toks: string[], workspaceId: string | null) => boolean;
const each =
  (ok: (t: string) => boolean, maxCount = 4): Check =>
  (toks) =>
    toks.length >= 1 && toks.length <= maxCount && toks.every(ok);
const word = (...words: string[]): Check => each(oneOf(...words), 1);

const hourUrl = (tok: string, workspaceId: string | null): boolean => {
  if (!/^url\(/i.test(tok)) return false;
  const urls = urlsOf(tok);
  return urls !== null && urls.length === 1 && isHourMailImage(urls[0].trim(), workspaceId);
};

const margin = each((t) => t === 'auto' || len(t, SPACING));
const padding = each((t) => len(t, SPACING));
const border: Check = each((t) => len(t, BORDER_W) || oneOf('thin', '0')(t) || BORDER_STYLE(t) || isColor(t), 3);
const size = each((t) => oneOf('auto', 'inherit', 'none')(t) || len(t, SIZE), 1);

/**
 * Each property MJML writes for the palette, with the values it may take.
 * Nothing negative, nothing huge: a design can neither cover the footer
 * (no `outline`), nor push it out (no negative margins), nor stretch it.
 */
const CHECKS: Record<string, Check> = {
  margin, 'margin-top': margin, 'margin-right': margin, 'margin-bottom': margin, 'margin-left': margin,
  padding, 'padding-top': padding, 'padding-right': padding, 'padding-bottom': padding, 'padding-left': padding,
  'mso-padding-alt': padding,
  border, 'border-top': border, 'border-right': border, 'border-bottom': border, 'border-left': border,
  'border-width': each((t) => len(t, BORDER_W)),
  'border-style': each(BORDER_STYLE),
  'border-color': each(isColor),
  'border-radius': each((t) => len(t, RADIUS)),
  'border-collapse': word('collapse', 'separate'),
  'border-spacing': each((t) => len(t, BORDER_W), 2),
  color: each(isColor, 1),
  'background-color': each(isColor, 1),
  background: (toks, ws) =>
    toks.length <= 8 &&
    toks.every((t) => isColor(t) || hourUrl(t, ws) || POSITION(t) || REPEAT(t) || oneOf('cover', 'contain', 'auto')(t) || t === '/' || len(t, SIZE)),
  'background-image': (toks, ws) => toks.length === 1 && (toks[0] === 'none' || hourUrl(toks[0], ws)),
  'background-position': each((t) => POSITION(t) || len(t, SIZE), 2),
  'background-repeat': each(REPEAT, 1),
  'background-size': each((t) => oneOf('cover', 'contain', 'auto')(t) || len(t, SIZE), 2),
  cursor: word('auto', 'pointer', 'default'),
  direction: word('ltr', 'rtl'),
  display: word('block', 'inline', 'inline-block', 'none', 'table', 'table-cell', 'table-row', 'table-row-group', 'list-item'),
  'font-size': each((t) => t === 'inherit' || len(t, { px: 96, pt: 72, em: 6, rem: 6, '%': 600 }), 1),
  'font-weight': word('normal', 'bold', 'bolder', 'lighter', '100', '200', '300', '400', '500', '600', '700', '800', '900'),
  'font-style': word('normal', 'italic', 'oblique'),
  height: size, width: size, 'max-width': size, 'min-width': size,
  'line-height': each((t) => oneOf('normal', 'inherit')(t) || len(t, { '': 4, px: 120, '%': 400, em: 4, rem: 4 }), 1),
  'letter-spacing': each((t) => t === 'normal' || len(t, { px: 10, em: 1 }, -2), 1),
  'word-spacing': each((t) => t === 'normal' || len(t, { px: 10, em: 1 }, -2), 1),
  'list-style-type': word('disc', 'circle', 'square', 'decimal', 'none', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman'),
  outline: word('none', '0'),
  'table-layout': word('auto', 'fixed'),
  'text-align': word('left', 'right', 'center', 'justify', 'start', 'end'),
  'text-decoration': each(oneOf('none', 'underline', 'line-through'), 2),
  'text-transform': word('none', 'uppercase', 'lowercase', 'capitalize'),
  'vertical-align': word('top', 'middle', 'bottom', 'baseline', 'text-top', 'text-bottom', 'sub', 'super'),
  'white-space': word('normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line'),
  'word-break': word('normal', 'break-all', 'keep-all', 'break-word'),
  'word-wrap': word('normal', 'break-word', 'anywhere'),
  'overflow-wrap': word('normal', 'break-word', 'anywhere'),
  '-webkit-text-size-adjust': word('100%', 'none', 'auto'),
  '-ms-text-size-adjust': word('100%', 'none', 'auto'),
  '-ms-interpolation-mode': word('bicubic', 'nearest-neighbor'),
  'mso-line-height-rule': word('exactly', 'at-least'),
  'mso-table-lspace': word('0pt', '0'),
  'mso-table-rspace': word('0pt', '0'),
};

/** Every `url(…)` of a value, read char by char (quotes of either kind, unquoted); null if malformed. */
function urlsOf(value: string): string[] | null {
  const out: string[] = [];
  const lower = value.toLowerCase();
  let i = lower.indexOf('url(');
  while (i >= 0) {
    let j = i + 4;
    while (j < value.length && /\s/.test(value[j])) j++;
    let target = '';
    const q = value[j];
    if (q === '"' || q === "'") {
      const end = value.indexOf(q, j + 1);
      if (end < 0) return null;
      target = value.slice(j + 1, end);
      j = end + 1;
      while (j < value.length && /\s/.test(value[j])) j++;
      if (value[j] !== ')') return null;
    } else {
      const end = value.indexOf(')', j);
      if (end < 0) return null;
      target = value.slice(j, end).trim();
      if (/["'\s(]/.test(target)) return null;
      j = end;
    }
    out.push(target);
    i = lower.indexOf('url(', j + 1);
  }
  return out;
}

/** Una declaración `prop:valor` si la propiedad está en la lista y el valor cabe en lo suyo; si no, null. */
function cleanDecl(decl: string, workspaceId: string | null): string | null {
  const i = decl.indexOf(':');
  if (i <= 0) return null;
  const prop = decl.slice(0, i).trim().toLowerCase();
  let value = decl.slice(i + 1).trim();
  const important = /!\s*important$/i.test(value);
  value = value.replace(/!\s*important$/i, '').trim();
  if (!value || value.length > 300 || /[<>@\\{};]/.test(value)) return null;
  if (prop === 'font-family') {
    // Font names may be quoted; nothing else, and no address.
    if (!/^[a-zA-Z0-9 ,'"-]+$/.test(value)) return null;
    return `${prop}:${value}${important ? '!important' : ''}`;
  }
  const check = CHECKS[prop];
  const toks = tokens(value);
  if (!check || !toks) return null;
  // Functions: only url() of Hour and rgb()/rgba(); quotes only inside url(); no `//` outside it.
  for (const t of toks) {
    // A url() token is that and nothing more: no text glued after its parenthesis.
    if (/^url\(/i.test(t)) {
      if (!/^url\([^()]*\)$/i.test(t)) return null;
      continue;
    }
    if (/["']|\/\//.test(t)) return null;
    if (t.includes('(') && !/^rgba?\(/i.test(t)) return null;
  }
  if (!check(toks, workspaceId)) return null;
  return `${prop}:${value}${important ? '!important' : ''}`;
}

function cleanDecls(block: string, workspaceId: string | null, only?: Set<string>): string {
  return block
    .split(';')
    .map((d) => cleanDecl(d, workspaceId))
    .filter((d): d is string => d !== null && (!only || only.has(d.slice(0, d.indexOf(':')))))
    .join(';');
}

/** Un `style=`: declaración a declaración, por lista. */
export function cleanInline(css: string, workspaceId?: string | null): string {
  return cleanDecls(css.replace(/\/\*[\s\S]*?(\*\/|$)/g, ''), workspaceId ?? null);
}

/** The index of the brace that closes the one at `open`, skipping quoted text; -1 if none. */
function closing(css: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let k = open; k < css.length; k++) {
    const c = css[k];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return k;
  }
  return -1;
}

/**
 * The selectors a design's sheet may use: the classes MJML and Templatical
 * write (`mj-…`, `tpl-…`, `moz-text-html`), nothing else. No element types,
 * no combinators over them, no `:last-child`: the sheet cannot reach the
 * footer. MJML's own reset (`body`, `p`, `img`, `table, td`) Hour puts back
 * itself (`MJML_RESET`, `mail-design.ts`).
 */
const SELECTOR_PART = [
  /^\.mj-[a-z0-9-]{1,40}$/,
  /^\.moz-text-html \.mj-[a-z0-9-]{1,40}$/,
  /^(table|td)\.mj-[a-z0-9-]{1,40}$/,
  /^\.tpl-[a-z0-9-]{1,40}$/,
  /^#outlook a$/,
];
/** Links may take the design's colour, and nothing else, from a bare `a`. */
const LINK_PROPS = new Set(['color', 'text-decoration']);
const MEDIA = /^[a-zA-Z0-9\s():,.-]+$/;

function cleanRules(css: string, workspaceId: string | null, nested: boolean): string {
  const out: string[] = [];
  let k = 0;
  while (k < css.length) {
    const open = css.indexOf('{', k);
    if (open < 0) break;
    const head = css.slice(k, open).trim();
    const close = closing(css, open);
    if (close < 0) break;
    const inner = css.slice(open + 1, close);
    k = close + 1;
    // A statement at-rule (`@import …;`) before the rule goes with it.
    const prelude = head.replace(/^[\s\S]*;/, '').trim().replace(/\s+/g, ' ');
    if (prelude.startsWith('@')) {
      const media = /^@media\s+([\s\S]+)$/i.exec(prelude);
      if (!nested && media && MEDIA.test(media[1])) {
        const rules = cleanRules(inner, workspaceId, true);
        if (rules) out.push(`@media ${media[1].trim()}{${rules}}`);
      }
      continue;
    }
    if (prelude === 'a') {
      const decls = cleanDecls(inner, workspaceId, LINK_PROPS);
      if (decls) out.push(`a{${decls}}`);
      continue;
    }
    const parts = prelude.split(',').map((x) => x.trim());
    if (!parts.length || !parts.every((x) => SELECTOR_PART.some((re) => re.test(x)))) continue;
    const decls = cleanDecls(inner, workspaceId);
    if (decls) out.push(`${parts.join(', ')}{${decls}}`);
  }
  return out.join('\n');
}

/** Una hoja de `<style>`: reglas y `@media`, por lista. */
export function cleanSheet(css: string, workspaceId?: string | null): string {
  const flat = css.replace(/\/\*[\s\S]*?(\*\/|$)/g, '').replace(/\\/g, '').replace(/<!--|-->/g, '');
  return cleanRules(flat, workspaceId ?? null, false);
}

// ── Comentarios de Outlook ─────────────────────────────────────────────────

const MSO_TAGS = new Set(['table', 'tr', 'td', 'tbody', 'div', 'p', 'noscript', 'xml', 'style', 'o:officedocumentsettings', 'o:allowpng', 'o:pixelsperinch']);
const MSO_ATTRS = new Set(['align', 'border', 'cellpadding', 'cellspacing', 'class', 'role', 'style', 'width', 'height', 'valign', 'bgcolor', 'type']);
/** El texto que MJML deja entre esas etiquetas: espacios, el 96 de PixelsPerInch, el &nbsp; del separador. */
const MSO_TEXT = /^(?:\s|\d|&nbsp;)*$/;
/** La única hoja que MJML pone dentro de un condicional. */
const MSO_SHEET = /^\s*\.mj-outlook-group-fix\s*\{\s*width:\s*100%\s*!important;\s*\}\s*$/;

type MsoTag = { name: string; close: boolean; self: boolean };

/** Las etiquetas de dentro de un condicional, si todo es de MJML; si no, null. */
function msoTags(inner: string, workspaceId: string | null): MsoTag[] | null {
  const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9:]*)((?:\s+[a-zA-Z:-]+(?:\s*=\s*"[^"<>]*")?)*)\s*(\/?)>/g;
  const tags: MsoTag[] = [];
  let last = 0;
  let inStyle = false;
  for (const m of inner.matchAll(TAG)) {
    const text = inner.slice(last, m.index);
    if (inStyle ? !MSO_SHEET.test(text) : !MSO_TEXT.test(text)) return null;
    last = (m.index ?? 0) + m[0].length;
    const name = m[2].toLowerCase();
    if (!MSO_TAGS.has(name)) return null;
    inStyle = name === 'style' && m[1] !== '/';
    for (const a of m[3].matchAll(/([a-zA-Z:-]+)(?:\s*=\s*"([^"<>]*)")?/g)) {
      const attr = a[1].toLowerCase();
      if (!MSO_ATTRS.has(attr)) return null;
      if (attr === 'style' && a[2] !== undefined) {
        const decls = a[2].split(';').map((d) => d.trim()).filter(Boolean);
        if (decls.some((d) => cleanDecl(d, workspaceId) === null)) return null;
      }
    }
    tags.push({ name, close: m[1] === '/', self: m[4] === '/' });
  }
  return MSO_TEXT.test(inner.slice(last)) ? tags : null;
}

type Kept = { data: string; kind: 'reveal-open' | 'reveal-close' | 'mso'; tags: MsoTag[] };

function msoComment(data: string, workspaceId: string | null): Kept | null {
  if (data === '[if !mso]><!') return { data, kind: 'reveal-open', tags: [] };
  if (data === '<![endif]') return { data, kind: 'reveal-close', tags: [] };
  const m = /^\[if (mso(?: \| IE)?|(?:lte|lt|gte|gt) mso \d{1,2}|IE)\]>([\s\S]*)<!\[endif\]$/.exec(data);
  if (!m) return null;
  const tags = msoTags(m[2], workspaceId);
  return tags ? { data, kind: 'mso', tags } : null;
}

/** The kept comments, in document order: paired, and their tags balanced across them. */
function commentsHold(kept: Kept[]): boolean {
  let revealed = false;
  const stack: string[] = [];
  for (const c of kept) {
    if (c.kind === 'reveal-open') {
      if (revealed) return false;
      revealed = true;
    } else if (c.kind === 'reveal-close') {
      if (!revealed) return false;
      revealed = false;
    } else {
      for (const t of c.tags) {
        if (t.self) continue;
        if (!t.close) stack.push(t.name);
        else if (stack.pop() !== t.name) return false;
      }
    }
  }
  return !revealed && stack.length === 0;
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
  const kept: Kept[] = [];
  let htmlAttrs = '';
  let bodyAttrs = '';
  let titled = false;

  const attrsOf = (el: Element): string => {
    const out: string[] = [];
    for (const [rawName, value] of Object.entries(el.attribs)) {
      const name = rawName.toLowerCase();
      if (name === 'href') {
        if (el.name !== 'a') continue;
        const href = safeHref(value, ws);
        if (href) out.push(`href="${escapeAttr(href)}"`);
      } else if (name === 'src' || name === 'background') {
        const src = compact(value);
        if (isHourMailImage(src, ws)) out.push(`${name}="${escapeAttr(src)}"`);
      } else if (name === 'target') {
        if (el.name === 'a' && value === '_blank') out.push('target="_blank" rel="noopener"');
      } else if (name === 'style') {
        const css = cleanInline(value, ws);
        if (css) out.push(`style="${escapeAttr(css)}"`);
      } else if (name === 'class') {
        // The footer's classes are Hour's (`hour-…`): the design cannot wear them.
        const cls = value.split(/\s+/).filter((c) => c && !/^hour-/i.test(c) && /^[a-zA-Z0-9_-]+$/.test(c));
        if (cls.length) out.push(`class="${escapeAttr(cls.join(' '))}"`);
      } else if (name === 'type') {
        if (el.name === 'style' && /^text\/css$/i.test(value.trim())) out.push('type="text/css"');
        if ((el.name === 'ol' || el.name === 'ul') && /^([1aAiI]|disc|circle|square)$/.test(value.trim())) out.push(`type="${escapeAttr(value.trim())}"`);
      } else if (ATTRS.has(name)) {
        out.push(`${name}="${escapeAttr(value)}"`);
      } else if (name === 'media' && el.name === 'style') {
        if (MEDIA.test(value)) out.push(`media="${escapeAttr(value)}"`);
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
      'x-apple-disable-message-reformatting': /^[a-z0-9 ]*$/i,
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
          const c = msoComment(node.data, ws);
          if (c) {
            out.push(`${MARK}${kept.length}${MARK}`);
            kept.push(c);
          }
          break;
        }
        case 'tag':
        case 'script':
        case 'style': {
          const el = node as Element;
          const name = el.name.toLowerCase();
          if (DROP_WITH_CONTENT.has(name)) break;
          if (name === 'html') {
            if (!htmlAttrs) {
              htmlAttrs = Object.entries(el.attribs)
                .filter(([k]) => HTML_ATTRS.has(k))
                .map(([k, v]) => (k.startsWith('xmlns') ? `${k}="${XMLNS[k]}"` : `${k}="${escapeAttr(v)}"`))
                .join(' ');
            }
            write(el.children, out, inHead);
            break;
          }
          if (name === 'head') {
            write(el.children, head, true);
            break;
          }
          if (name === 'body') {
            if (!bodyAttrs) {
              bodyAttrs = cleanInline(el.attribs.style ?? '', ws)
                .split(';')
                .filter((d) => /^(background-color|background|word-spacing):/.test(d))
                .join(';');
            }
            write(el.children, body, false);
            break;
          }
          if (name === 'style') {
            const css = el.children.map((c) => (c.type === 'text' ? c.data : '')).join('');
            const sheet = cleanSheet(css, ws);
            if (sheet) head.push(`<style${attrsOf(el)}>${sheet}</style>`);
            break;
          }
          if (name === 'title') {
            if (!titled) {
              titled = true;
              head.push(`<title>${escapeText(el.children.map((c) => (c.type === 'text' ? c.data : '')).join(''))}</title>`);
            }
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
  const raw = [
    '<!doctype html>',
    `<html${htmlAttrs ? ` ${htmlAttrs}` : ''}>`,
    `<head>${head.join('')}</head>`,
    `<body${bodyAttrs ? ` style="${escapeAttr(bodyAttrs)}"` : ''}>`,
    body.join(''),
    '</body>',
    '</html>',
  ].join('');
  // Comments only if they all hold together, in the order they come.
  const PLACE = new RegExp(`${MARK}(\\d+)${MARK}`, 'g');
  const keep = commentsHold([...raw.matchAll(PLACE)].map((m) => kept[Number(m[1])]));
  return raw.replace(PLACE, (_w, n: string) => (keep ? `<!--${kept[Number(n)].data}-->` : ''));
}
