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

/** Los bloques que se pueden usar (la paleta del editor y lo que acepta el servidor). */
export const DESIGN_BLOCKS = ['section', 'title', 'paragraph', 'image', 'button', 'divider', 'spacer'] as const;

/** Tope del JSON guardado (bytes de su texto). */
export const DESIGN_MAX_BYTES = 262_144;
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

/** Una imagen de envío de Hour, de este espacio (ADR-172). */
export function isOwnMailImage(src: string, workspaceId: string): boolean {
  return /^\/m\/ws\/[0-9a-f-]{36}\/mail\/[A-Za-z0-9._-]+$/.test(src) && src.startsWith(`/m/ws/${workspaceId}/mail/`);
}

/** Un enlace que un correo puede llevar: vacío, http(s) o mailto. */
export function isSafeLink(url: string): boolean {
  const u = url.trim();
  return u === '' || /^https?:\/\/[^\s<>"]+$/i.test(u) || /^mailto:[^\s<>"]+$/i.test(u);
}

/** El JSON cumple lo que la pantalla ofrece. null si vale; si no, por qué. */
export function checkDesign(content: unknown, workspaceId: string): DesignError | null {
  if (!isObject(content) || !Array.isArray(content.blocks) || !isObject(content.settings)) return 'design_shape';
  if (JSON.stringify(content).length > DESIGN_MAX_BYTES) return 'design_too_large';
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

const DROP_WITH_CONTENT = /<(script|iframe|object|embed|form|textarea|select|svg|math|noscript|template)\b[\s\S]*?<\/\1\s*>/gi;
const DROP_TAG = /<\/?(script|iframe|object|embed|form|input|button|textarea|select|option|svg|math|noscript|template|base|link|frame|frameset|applet)\b[^>]*>/gi;
const META_REFRESH = /<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi;
const ON_ATTR = /\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const BAD_URL_ATTR = /\s+(href|src|background|action|formaction|xlink:href)\s*=\s*("\s*(?:javascript|vbscript|data):[^"]*"|'\s*(?:javascript|vbscript|data):[^']*'|(?:javascript|vbscript|data):[^\s>]*)/gi;
const CSS_EXPR = /expression\s*\(|url\s*\(\s*["']?\s*(?:javascript|vbscript):/gi;
const STYLE_BLOCK = /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi;
const STYLE_ATTR = /(\sstyle\s*=\s*)("[^"]*"|'[^']*')/gi;
const CSS_IMPORT = /@import\b[^;]*;?/gi;
const CSS_URL = /url\(\s*(["']?)([^"')]*)\1\s*\)/gi;

/**
 * Inside CSS only Hour's own images (`/m/…`, made absolute later) may load:
 * an `@import` or a `url()` elsewhere would fetch from outside when the mail
 * is opened (ADR-190).
 */
function cleanCss(css: string): string {
  return css
    .replace(CSS_IMPORT, '')
    .replace(CSS_URL, (whole, _q: string, target: string) => (/^\/m\//.test(target.trim()) ? whole : 'none'));
}

/**
 * Lo que un correo no debe llevar, fuera. Es una segunda capa: el HTML lo
 * compila el editor de alguien con permiso de editar el envío, y los
 * clientes de correo y la vista previa (iframe sin scripts) ya lo neutralizan.
 */
export function sanitizeDesignHtml(html: string): string {
  return html
    .replace(DROP_WITH_CONTENT, '')
    .replace(DROP_TAG, '')
    .replace(META_REFRESH, '')
    .replace(ON_ATTR, '')
    .replace(BAD_URL_ATTR, '')
    .replace(CSS_EXPR, 'invalid(')
    .replace(STYLE_BLOCK, (_w, open: string, css: string, close: string) => `${open}${cleanCss(css)}${close}`)
    .replace(STYLE_ATTR, (_w, attr: string, value: string) => `${attr}${cleanCss(value)}`);
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
 * El HTML compilado (con los campos ya puestos) más lo que pone Hour. El
 * diseño no lleva pie: lo añade esto, al final del cuerpo, con la misma
 * forma que en una carta.
 */
export function designedHtml(html: string, parts: DesignedParts): string {
  const lang = escapeHtml(parts.language || 'es');
  let out = html;
  if (parts.origin) {
    const origin = parts.origin.replace(/\/+$/, '');
    out = out.replace(/(\s(?:src|href|background)\s*=\s*["'])\/m\//gi, `$1${origin}/m/`);
    out = out.replace(/(url\(\s*["']?)\/m\//gi, `$1${origin}/m/`);
  }
  out = /<html\b[^>]*\blang\s*=/i.test(out)
    ? out.replace(/(<html\b[^>]*\blang\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${lang}"`)
    : out.replace(/<html\b/i, `<html lang="${lang}"`);
  const preheader = parts.preheader?.trim()
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;">${escapeHtml(parts.preheader.trim())}</div>`
    : '';
  const footer = footerTable({ footer: parts.footer, footerHtml: parts.footerHtml });
  if (/<body\b[^>]*>/i.test(out)) out = out.replace(/<body\b[^>]*>/i, (b) => `${b}${preheader}`);
  else out = `${preheader}${out}`;
  return /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${footer}</body>`) : `${out}${footer}`;
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
  const html = sanitizeDesignHtml(design.html);
  if (!html.trim() || html.length > DESIGN_HTML_MAX) return { error: 'design_html' };
  const body = designText(content);
  if (!body) return { error: 'design_empty' };
  if (body.length > maxBody) return { error: 'design_too_large' };
  return { content, html, body };
}
