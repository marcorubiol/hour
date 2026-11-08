/**
 * El correo diseñado de una invitación (tarea 99, ADR-190). El diseño se hace
 * en el editor de Templatical (`MailDesignEditor.svelte`), que guarda un JSON
 * (la fuente) y lo compila a HTML en el navegador; aquí está lo que la base,
 * el Worker y la pantalla hacen con eso, sin depender de Templatical:
 *
 *   · `checkDesign`: el JSON solo lleva los bloques que la pantalla ofrece, y
 *     sus imágenes son de Hour (la ruta pública de ADR-172, de ese espacio).
 *   · `sanitizeDesignHtml`: el HTML que llega del navegador pierde lo que un
 *     correo no debe llevar (scripts, marcos, formularios, `on*`, `javascript:`).
 *   · `designText`: el texto plano se deriva del JSON. Es el `body` del envío,
 *     así que la versión de texto, los campos que faltan y el historial salen
 *     de lo mismo que en una carta.
 *   · `designedHtml`: el HTML compilado con lo que pone Hour: `lang`, imágenes
 *     absolutas, texto de previsualización y el pie (por qué le llega y la
 *     baja), que no está en el diseño ni se puede quitar.
 *
 * Solo imports relativos: lo empaqueta también wrangler (la cola).
 */

import { escapeHtml, footerTable, type MailFooter } from './mail-template';
import { isHourMailImage, sanitizeMailHtml } from './mail-sanitize';

/** Los bloques que se pueden usar (la paleta del editor y lo que acepta el servidor). */
export const DESIGN_BLOCKS = ['section', 'title', 'paragraph', 'image', 'button', 'divider', 'spacer'] as const;

/**
 * Tope del JSON guardado, en bytes UTF-8 de su texto. La base admite 256 KB de
 * `jsonb::text`, que escribe espacios que `JSON.stringify` no: queda margen.
 */
export const DESIGN_MAX_BYTES = 200_000;
/** Tope del cuerpo entero de un PATCH con diseño, antes de leerlo como JSON. */
export const DESIGN_REQUEST_MAX_BYTES = 400_000;
/**
 * Tope del HTML compilado. Gmail recorta hacia los 102 KB; el pie y el texto
 * de previsualización que añade Hour caben en lo que queda.
 */
export const DESIGN_HTML_MAX = 90_000;
const MAX_BLOCKS = 120;

type Json = Record<string, unknown>;

/** Lo que guarda la base: el JSON de Templatical, sin tiparlo entero. */
export interface DesignContent {
  blocks: Json[];
  settings: Json;
}

export type DesignError =
  | 'design_shape'
  | 'design_block'
  | 'design_image'
  | 'design_link'
  | 'design_too_large'
  | 'design_empty'
  | 'design_html';

const isObject = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): string => (typeof x === 'string' ? x : '');

/** Bytes UTF-8 de un texto: la base cuenta bytes, no unidades de JavaScript. */
export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Una imagen de envío de Hour, de este espacio (ADR-172). */
export function isOwnMailImage(src: string, workspaceId: string): boolean {
  return isHourMailImage(src, workspaceId);
}

/** Un enlace que un correo puede llevar: vacío, http(s) o mailto. */
export function isSafeLink(url: string): boolean {
  const u = url.trim();
  return u === '' || /^https?:\/\/[^\s<>"]+$/i.test(u) || /^mailto:[^\s<>"]+$/i.test(u);
}

/** El JSON cumple lo que la pantalla ofrece. null si vale; si no, por qué. */
export function checkDesign(content: unknown, workspaceId: string): DesignError | null {
  if (!isObject(content) || !Array.isArray(content.blocks) || !isObject(content.settings)) return 'design_shape';
  if (byteLength(JSON.stringify(content)) > DESIGN_MAX_BYTES) return 'design_too_large';
  let count = 0;
  const image = (src: unknown) => str(src) === '' || isOwnMailImage(str(src), workspaceId);
  const background = (bg: unknown) => bg === undefined || bg === null || (isObject(bg) && image(bg.url));
  const visit = (block: unknown, nested: boolean): DesignError | null => {
    if (!isObject(block) || typeof block.type !== 'string') return 'design_shape';
    if (++count > MAX_BLOCKS) return 'design_too_large';
    if (!(DESIGN_BLOCKS as readonly string[]).includes(block.type)) return 'design_block';
    switch (block.type) {
      case 'section': {
        if (nested || !Array.isArray(block.children)) return 'design_block';
        if (!background(block.backgroundImage)) return 'design_image';
        if (isObject(block.wrapper) && !background(block.wrapper.backgroundImage)) return 'design_image';
        for (const column of block.children) {
          if (!Array.isArray(column)) return 'design_shape';
          for (const child of column) {
            const e = visit(child, true);
            if (e) return e;
          }
        }
        return null;
      }
      case 'image':
        if (!image(block.src) || !image(block.placeholderUrl)) return 'design_image';
        return isSafeLink(str(block.linkUrl)) ? null : 'design_link';
      case 'button':
        return isSafeLink(str(block.url)) ? null : 'design_link';
      default:
        return null;
    }
  };
  for (const block of content.blocks) {
    const e = visit(block, false);
    if (e) return e;
  }
  return null;
}

// ── Limpiar el HTML compilado ──────────────────────────────────────────────

/**
 * El HTML limpio (ADR-190, `mail-sanitize.ts`): parser y listas blancas. Al
 * guardar se pasa el espacio, y solo valen sus imágenes; al montar el correo
 * se vuelve a limpiar lo que diga la base, con cualquier imagen de Hour.
 */
export function sanitizeDesignHtml(html: string, workspaceId?: string | null): string {
  return sanitizeMailHtml(html, { workspaceId });
}

// ── Texto plano ────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (whole, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[e.toLowerCase()] ?? whole;
  });
}

/** El HTML de un bloque de texto (TipTap) → texto: párrafos, listas y enlaces «texto (url)». */
export function htmlToText(html: string): string {
  const text = html
    // A merge field is a chip in the editor: its token is the attribute, not the label.
    .replace(/<span\b[^>]*\bdata-merge-tag\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/span>/gi, '$1')
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_w, href: string, inner: string) => {
      const label = decode(inner.replace(/<[^>]+>/g, '')).trim();
      const url = decode(href).trim();
      return !url || url === label || url === `mailto:${label}` ? label || url : label ? `${label} (${url})` : url;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n· ')
    .replace(/<\/(p|h[1-6]|div|ul|ol|blockquote)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  return decode(text)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * El texto plano del diseño: lo que dice, en el orden en que se lee. Un
 * botón es «texto: url»; una imagen enlazada, «alt: url»; una sin enlace o
 * decorativa no deja línea (su texto alternativo es para quien no la ve, no
 * una frase de la carta). Las columnas de una sección, una tras otra.
 */
export function designText(content: DesignContent): string {
  const out: string[] = [];
  const visit = (b: Json) => {
    switch (b.type) {
      case 'section':
        for (const column of (b.children as unknown[]) ?? []) {
          if (Array.isArray(column)) for (const child of column) if (isObject(child)) visit(child);
        }
        return;
      case 'title':
      case 'paragraph': {
        const t = htmlToText(str(b.content));
        if (t) out.push(t);
        return;
      }
      case 'button': {
        const label = htmlToText(str(b.text));
        const url = str(b.url).trim();
        if (label || url) out.push(url ? `${label}${label ? ': ' : ''}${url}` : label);
        return;
      }
      case 'image': {
        const url = str(b.linkUrl).trim();
        if (url && b.decorative !== true) out.push(`${str(b.alt).trim() ? `${str(b.alt).trim()}: ` : ''}${url}`);
        return;
      }
      default:
        return;
    }
  };
  for (const b of content.blocks) if (isObject(b)) visit(b);
  return out.join('\n\n').trim();
}

// ── El HTML que sale ───────────────────────────────────────────────────────

export interface DesignedParts {
  language: string;
  /** El origen de la app: las imágenes de Hour (`/m/…`) se hacen absolutas con él. */
  origin: string | null;
  preheader: string | null;
  footer: string[];
  footerHtml: MailFooter | null;
}

/**
 * Lo que blinda lo que pone Hour frente a la hoja del diseño (ADR-190): un
 * estilo en línea con `!important` gana a cualquier `!important` de una hoja,
 * y la hoja ya solo admite propiedades de una lista (`mail-sanitize.ts`). Así
 * el pie y sus antepasados (`html`, `body`) no se pueden esconder, encoger,
 * recortar ni teñir del color del fondo.
 */
const SHOWN = 'display:block!important;visibility:visible!important;opacity:1!important;height:auto!important;max-height:none!important;overflow:visible!important;zoom:1!important;transform:none!important;filter:none!important;clip-path:none!important';

/** The margin of Templatical's blocks (10px each side): the footer starts where the text does. */
const DESIGN_GUTTER = 10;

const FOOT_DISPLAY: Record<string, string> = { table: 'table', tbody: 'table-row-group', tr: 'table-row', td: 'table-cell', p: 'block', a: 'inline' };
const FOOT_INK = '#767676';
const FOOT_PAPER = '#ffffff';

/** What every footer element is pinned to, unless it states its own value. */
function footerPins(tag: string): [string, string][] {
  const pins: [string, string][] = [
    ['display', FOOT_DISPLAY[tag]],
    ['visibility', 'visible'],
    ['opacity', '1'],
    ['position', 'static'],
    ['max-height', 'none'],
    ['max-width', 'none'],
    ['min-width', '0'],
    ['overflow', 'visible'],
    ['zoom', '1'],
    ['transform', 'none'],
    ['filter', 'none'],
    ['clip', 'auto'],
    ['clip-path', 'none'],
    ['text-indent', '0'],
    ['letter-spacing', 'normal'],
    ['word-spacing', 'normal'],
    ['white-space', 'normal'],
    ['text-transform', 'none'],
    ['direction', 'ltr'],
    ['margin', tag === 'p' ? '0 0 4px' : '0'],
  ];
  if (tag !== 'tr' && tag !== 'tbody') pins.push(['color', FOOT_INK]);
  if (tag === 'p' || tag === 'a' || tag === 'td') pins.push(['font-size', '12px'], ['line-height', '1.5']);
  if (tag === 'table') pins.push(['background-color', FOOT_PAPER]);
  return pins;
}

/** Every element of the footer: its own declarations made `!important`, and pinned; its classes, Hour's. */
function hardenFooter(html: string): string {
  return html.replace(/<([a-z]+)([^>]*)>/g, (whole, tag: string, attrs: string) => {
    if (!FOOT_DISPLAY[tag]) return whole;
    const own = (/\sstyle="([^"]*)"/.exec(attrs)?.[1] ?? '')
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean);
    const named = new Set(own.map((d) => d.split(':')[0].trim().toLowerCase()));
    const decls = [
      ...own.map((d) => (/!important$/.test(d) ? d : `${d}!important`)),
      ...footerPins(tag)
        .filter(([k]) => !named.has(k))
        .map(([k, v]) => `${k}:${v}!important`),
    ];
    // Classes the design cannot name: the sanitizer drops any selector or class with `hour-`.
    const rest = attrs.replace(/\sstyle="[^"]*"/, '').replace(/\sclass="m-([a-z]+)"/, ' class="hour-foot-$1"');
    return `<${tag}${rest} style="${decls.join(';')}">`;
  });
}

/**
 * El HTML del diseño, limpio (`sanitizeDesignHtml`: un solo `<head>` y un
 * solo `<body>`, todo cerrado, sin `<` en el CSS ni en comentarios fuera de
 * los de Outlook) y con los campos ya puestos y escapados, más lo que pone
 * Hour: `lang`, imágenes absolutas, texto de previsualización y el pie como
 * último hijo de `<body>`, fuera de todo lo del diseño.
 */
export function designedHtml(html: string, parts: DesignedParts): string {
  const lang = escapeHtml(parts.language || 'es');
  let out = html;
  if (parts.origin) {
    const origin = parts.origin.replace(/\/+$/, '');
    out = out.replace(/(\s(?:src|href|background)=")\/m\//g, `$1${origin}/m/`);
    out = out.replace(/(url\(\s*["']?)\/m\//gi, `$1${origin}/m/`);
  }
  // Anchored on what the sanitizer writes: the opening tags are the first ones,
  // and `</head><body` appears once.
  out = out.replace(/^(<!doctype html>)?<html([^>]*)>/i, (_w, doctype: string | undefined, attrs: string) => {
    const rest = attrs.replace(/\slang="[^"]*"/, '');
    return `${doctype ?? ''}<html lang="${lang}"${rest} style="${SHOWN}">`;
  });
  const preheader = parts.preheader?.trim()
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;">${escapeHtml(parts.preheader.trim())}</div>`
    : '';
  out = out.replace(/<\/head><body(?: style="([^"]*)")?>/, (_w, css: string | undefined) =>
    `</head><body style="${css ? `${css};` : ''}${SHOWN};margin:0!important;padding:0!important">${preheader}`,
  );
  const footer = hardenFooter(footerTable({ footer: parts.footer, footerHtml: parts.footerHtml }, DESIGN_GUTTER));
  const at = out.lastIndexOf('</body>');
  return at < 0 ? `${out}${footer}` : `${out.slice(0, at)}${footer}${out.slice(at)}`;
}

/**
 * Lo que guarda el servidor de un diseño que llega del editor: el JSON
 * comprobado, el HTML limpio y el texto plano que pasa a ser el `body`.
 */
export function prepareDesign(
  design: { content: unknown; html: string },
  workspaceId: string,
  maxBody = 20_000,
): { content: DesignContent; html: string; body: string } | { error: DesignError } {
  const why = checkDesign(design.content, workspaceId);
  if (why) return { error: why };
  const content = design.content as DesignContent;
  const html = sanitizeDesignHtml(design.html, workspaceId);
  if (!/<body[^>]*>\s*\S/.test(html) || byteLength(html) > DESIGN_HTML_MAX) return { error: 'design_html' };
  const body = designText(content);
  if (!body) return { error: 'design_empty' };
  if (body.length > maxBody) return { error: 'design_too_large' };
  return { content, html, body };
}
