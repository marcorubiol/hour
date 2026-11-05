/**
 * La plantilla del correo de difusión (ADR-172): una capa fija alrededor del
 * texto. No es un editor ni sabe de campos, bases o envíos: recibe el texto ya
 * montado (cuerpo, firma y pie, lo mismo que la versión de texto plano) y lo
 * viste. El compositor (`mailout-compose.ts`) decide QUÉ dice el correo; esto
 * solo decide CÓMO se pinta en HTML. Un editor de correos «bonitos» futuro
 * sería otra plantilla con la misma entrada, no un cambio aquí.
 *
 * HTML de correo, no de la app: tablas, estilos en línea, 600 px de ancho
 * máximo, cada imagen con `alt`, ancho y alto, y nada que dependa de una
 * imagen para leerse (sin imagen-cartel: el texto es texto). Los valores
 * literales (colores, px) son de aquí a propósito: un cliente de correo no
 * lee tokens.css, y la guarda de tokens solo mira componentes y hojas de la
 * app.
 *
 * Las imágenes las sirve Hour por URL pública y estable (`/m/…`, R2): el
 * nombre lleva su tamaño (`<hash>-<ancho>x<alto>.<ext>`), así el HTML lo
 * declara sin leer la imagen. Solo imports relativos: lo empaqueta también
 * wrangler (la cola).
 */

/** Una imagen ya resuelta: URL absoluta y su texto alternativo. */
export interface MailImage {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

/** Lo que la plantilla añade alrededor del texto. Todo opcional. */
export interface MailTemplate {
  /** El logo de la compañía, en la cabecera. */
  logo: MailImage | null;
  /** La imagen del espectáculo, tras el cuerpo; enlaza al dossier si lo hay. */
  image: (MailImage & { href: string | null }) | null;
}

export const NO_TEMPLATE: MailTemplate = { logo: null, image: null };

/** El texto del correo por piezas: lo mismo que lleva la versión de texto plano. */
export interface MailParts {
  language: string;
  subject: string;
  body: string;
  signature: string;
  footer: string[];
  /**
   * La función de una invitación (ADR-180): la obra y unas filas («Cuándo»,
   * «Dónde»), con la línea de cómo confirmar. Va tras el cuerpo.
   */
  event?: MailEvent | null;
  /**
   * El pie en HTML (ADR-180): por qué le llega, y la baja y la privacidad como
   * enlaces con palabras en vez de la URL entera. Sin él, las líneas de `footer`.
   */
  footerHtml?: MailFooter | null;
  /** Lo que la bandeja enseña antes de abrir: la primera frase tras el saludo. */
  preheader?: string | null;
}

export interface MailEvent {
  title: string | null;
  rows: { label: string; value: string }[];
  note: string | null;
}

export interface MailFooter {
  why: string[];
  links: { label: string; url: string; tail?: string }[];
}

/** Lo que guarda la base (`mailout_template`, o la pantalla con sus lecturas). */
export interface MailTemplateRow {
  company_name: string | null;
  logo_url: string | null;
  image_url: string | null;
  image_alt: string | null;
  image_link_url: string | null;
}

// ── Medidas ────────────────────────────────────────────────────────────────

const WIDTH = 600;
/** El logo se pinta a lo sumo así (px CSS); el fichero es el doble, para pantallas densas. */
const LOGO_MAX = { width: 240, height: 64 };

const SIZE_RE = /-(\d{1,5})x(\d{1,5})\.(?:png|jpe?g|gif)(?:[?#].*)?$/i;

/** El tamaño que declara el nombre de una imagen de Hour (`…-1200x800.jpg`), o null. */
export function imageSize(url: string): { width: number; height: number } | null {
  const m = SIZE_RE.exec(url);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Una URL de imagen o enlace que el correo puede llevar: absoluta http(s), o
 * una ruta de Hour (`/…`) resuelta contra el origen de la app. Lo demás
 * (`javascript:`, `data:`, relativas raras), null.
 */
export function mailUrl(raw: string | null | undefined, origin: string): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return `${origin.replace(/\/+$/, '')}${value}`;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Lo que guarda la base → la plantilla, con las URL ya absolutas. */
export function mailTemplate(row: MailTemplateRow | null | undefined, origin: string): MailTemplate {
  if (!row) return NO_TEMPLATE;
  const company = row.company_name?.trim() || '';
  const logoUrl = mailUrl(row.logo_url, origin);
  const imageUrl = mailUrl(row.image_url, origin);
  const sized = (url: string) => imageSize(url) ?? { width: null, height: null };
  return {
    logo: logoUrl ? { url: logoUrl, alt: company, ...sized(logoUrl) } : null,
    image: imageUrl
      ? { url: imageUrl, alt: row.image_alt?.trim() || company, href: mailUrl(row.image_link_url, origin), ...sized(imageUrl) }
      : null,
  };
}

/**
 * El tamaño con que se pinta, dentro del máximo y sin pasar de `density`
 * (0.5: el fichero es el doble, para pantallas densas). Sin tamaño conocido,
 * el ancho máximo y el alto que salga.
 */
function displaySize(
  img: MailImage,
  max: { width: number; height: number },
  density: number,
): { width: number; height: number | null } {
  if (!img.width || !img.height) return { width: max.width, height: null };
  const scale = Math.min(max.width / img.width, max.height / img.height, density);
  return { width: Math.round(img.width * scale), height: Math.round(img.height * scale) };
}

// ── HTML ───────────────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const URL_RE = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)]/g;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const INK = '#1f1f1f';
const MUTED = '#5c5c5c';
const FAINT = '#767676';
const RULE = '#e2e2e2';
const LINK = '#1f1f1f';

/**
 * El modo oscuro de los clientes que lo leen (ADR-180; Apple Mail, entre
 * otros): una hoja corta con clases, porque un estilo en línea no sabe del
 * tema. Los que no la leen pintan el claro de los estilos en línea; las apps
 * que invierten por su cuenta invierten un fondo blanco y tinta casi negra.
 * El logo lleva un fondo claro propio en oscuro: uno transparente con trazo
 * oscuro se perdería.
 */
const DARK_SHEET = [
  '<style>',
  ':root{color-scheme:light dark;supported-color-schemes:light dark;}',
  '@media (prefers-color-scheme:dark){',
  '.m-bg{background:#1c1c1e !important;}',
  '.m-ink,.m-ink a{color:#ececec !important;}',
  '.m-muted,.m-muted a{color:#a8a8ad !important;}',
  '.m-faint,.m-faint a{color:#8e8e93 !important;}',
  '.m-rule{border-color:#3a3a3c !important;}',
  '.m-logo{background:#f2f2f2 !important;border-radius:4px;padding:6px 8px;}',
  '}',
  '</style>',
].join('');

/** Un texto con saltos → párrafos con `<br>` y enlaces; todo escapado. */
function paragraphs(text: string, style: string, linkStyle: string, cls = 'm-ink'): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => {
      const linked = escapeHtml(p).replace(URL_RE, (u) => `<a href="${u}" style="${linkStyle}">${u}</a>`);
      return `<p class="${cls}" style="${style}">${linked.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

function img(image: MailImage, size: { width: number; height: number | null }, extra = '', cls = ''): string {
  const height = size.height ? ` height="${size.height}"` : '';
  const style = `display:block;border:0;outline:none;text-decoration:none;max-width:100%;height:auto;${extra}`;
  return `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" width="${size.width}"${height}${cls ? ` class="${cls}"` : ''} style="${style}">`;
}

function row(content: string, style: string, cls = ''): string {
  return `<tr><td${cls ? ` class="${cls}"` : ''} style="${style}">${content}</td></tr>`;
}

/** La función de una invitación: la obra en cursiva y unas filas cortas, en una caja con raya. */
function eventBlock(ev: MailEvent, link: string): string {
  const title = ev.title
    ? `<p class="m-ink" style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:20px;line-height:1.25;color:${INK};">${escapeHtml(ev.title)}</p>`
    : '';
  const rows = ev.rows
    .map(
      (r) =>
        `<tr><td class="m-faint" style="padding:2px 14px 2px 0;font-family:${FONT};font-size:15px;line-height:1.5;color:${FAINT};vertical-align:top;white-space:nowrap;">${escapeHtml(r.label)}</td>` +
        `<td class="m-ink" style="padding:2px 0;font-family:${FONT};font-size:15px;line-height:1.5;color:${INK};">${escapeHtml(r.value)}</td></tr>`,
    )
    .join('');
  const note = ev.note
    ? paragraphs(ev.note, `margin:12px 0 0;font-family:${FONT};font-size:14px;line-height:1.5;color:${MUTED};`, link, 'm-muted')
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="m-rule" style="border:1px solid ${RULE};border-radius:6px;"><tr><td style="padding:14px 16px;">${title}<table role="presentation" cellpadding="0" cellspacing="0" border="0">${rows}</table>${note}</td></tr></table>`;
}

/**
 * El HTML del correo. El texto es el de la versión plana, por piezas: cuerpo,
 * firma y pie. La plantilla pone el logo arriba y la imagen del espectáculo
 * tras el cuerpo; sin ellas queda el mismo texto en la misma caja.
 */
export function mailHtml(parts: MailParts, template: MailTemplate = NO_TEMPLATE): string {
  const lang = escapeHtml(parts.language || 'es');
  const text = `margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.5;color:${INK};`;
  const link = `color:${LINK};text-decoration:underline;`;
  const out: string[] = [];

  if (template.logo) {
    out.push(row(img(template.logo, displaySize(template.logo, LOGO_MAX, 0.5), '', 'm-logo'), 'padding:0 0 28px;'));
  }

  out.push(row(paragraphs(parts.body, text, link), 'padding:0;'));

  if (parts.event && (parts.event.title || parts.event.rows.length > 0)) {
    out.push(row(eventBlock(parts.event, link), 'padding:4px 0 20px;'));
  }

  if (parts.signature.trim()) {
    const sig = `margin:0;font-family:${FONT};font-size:14px;line-height:1.5;color:${MUTED};`;
    out.push(row(paragraphs(parts.signature, sig, `color:${MUTED};text-decoration:underline;`, 'm-muted'), 'padding:12px 0 0;'));
  }

  // The image after the signature (ADR-180): the letter ends where it was
  // signed, and the picture follows as its postscript, linked to the dossier.
  if (template.image) {
    const size = displaySize(template.image, { width: WIDTH, height: Number.POSITIVE_INFINITY }, 1);
    // A todo el ancho solo si llena la caja: una imagen más estrecha no se estira.
    const picture = img(template.image, size, size.width === WIDTH ? 'width:100%;' : '');
    const href = template.image.href;
    // Con la imagen bloqueada se lee su `alt`, y sigue siendo el enlace.
    const linked = href
      ? `<a href="${escapeHtml(href)}" style="${link}font-family:${FONT};font-size:14px;">${picture}</a>`
      : picture;
    out.push(row(linked, 'padding:24px 0 0;'));
  }

  const foot = `margin:0 0 4px;font-family:${FONT};font-size:12px;line-height:1.5;color:${FAINT};`;
  // Air above the footer's rule: a cell's padding sits inside its border.
  const spacer = row('&nbsp;', 'height:28px;line-height:28px;font-size:0;padding:0;');
  const footLink = `color:${FAINT};text-decoration:underline;`;
  if (parts.footerHtml) {
    const why = parts.footerHtml.why.map((l) => paragraphs(l, foot, footLink, 'm-faint')).join('');
    const links = parts.footerHtml.links
      .map((l) => `<a href="${escapeHtml(l.url)}" style="${footLink}">${escapeHtml(l.label)}</a>${escapeHtml(l.tail ?? '')}`)
      .join(' · ');
    const linkLine = links ? `<p class="m-faint" style="${foot}">${links}</p>` : '';
    out.push(spacer);
    out.push(row(why + linkLine, `padding:16px 0 0;border-top:1px solid ${RULE};`, 'm-rule'));
  } else if (parts.footer.length) {
    const lines = parts.footer.map((l) => paragraphs(l, foot, footLink, 'm-faint')).join('');
    out.push(spacer);
    out.push(row(lines, `padding:16px 0 0;border-top:1px solid ${RULE};`, 'm-rule'));
  }

  // What the inbox shows before opening: hidden in the message itself.
  const preheader = parts.preheader?.trim()
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#ffffff;">${escapeHtml(parts.preheader.trim())}</div>`
    : '';

  return [
    '<!doctype html>',
    `<html lang="${lang}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="x-apple-disable-message-reformatting">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="supported-color-schemes" content="light dark">',
    `<title>${escapeHtml(parts.subject)}</title>`,
    DARK_SHEET,
    '</head>',
    '<body class="m-bg" style="margin:0;padding:0;background:#ffffff;">',
    preheader,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="m-bg" style="background:#ffffff;">',
    '<tr><td align="center" style="padding:24px 16px;">',
    `<table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${WIDTH}px;">`,
    ...out,
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');
}
