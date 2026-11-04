/**
 * El original de un correo (punto 111): entero, tal como llegó, con lo
 * citado, el HTML y los adjuntos. La sincronización guarda sólo el texto
 * nuevo (`trimQuoted`); el original no se guarda: se trae del buzón al
 * abrirlo (GET /api/conversations/:id/events/:eventId/original) y vive sólo
 * en la memoria de la pestaña (la consulta no se guarda en el dispositivo).
 *
 * Cómo se pinta el HTML de fuera, que es de quien lo escribió y no nuestro:
 *  1. en un iframe `sandbox` sin `allow-scripts` ni `allow-same-origin`
 *     (origen opaco: ni scripts, ni cookies, ni formularios, ni salir del
 *     marco; los enlaces abren pestaña nueva y fuera de la caja);
 *  2. con su propia CSP (`default-src 'none'`): sin imágenes remotas, hojas
 *     de estilo, fuentes ni conexiones; además el documento hereda la CSP de
 *     la app, que tampoco las deja. Las imágenes remotas (los píxeles de
 *     seguimiento) se ven sólo al abrirlo aparte y pedirlo
 *     (`/original/view?images=1`, un documento con su CSP y `sandbox`);
 *  3. y limpio de lo que no debe ni intentarse (scripts, `<meta>` que
 *     redirige, `<base>`, marcos, manejadores `on…`, `javascript:`), por si
 *     una de las dos capas de arriba fallara.
 */

export interface MailAttachment {
  /** El `partId` de la parte en Gmail: estable, a diferencia de su attachmentId. */
  part_id: string;
  filename: string;
  mime_type: string;
  size: number;
  /** Va dentro del cuerpo (`cid:`) más que como adjunto. */
  inline: boolean;
}

export interface MailOriginal {
  subject: string | null;
  from: string;
  to: string;
  cc: string;
  date: string | null;
  text: string | null;
  html: string | null;
  attachments: MailAttachment[];
  /** El texto o el HTML pasaban del tope y se cortaron. */
  truncated: boolean;
}

/** La URL del original y de lo que cuelga de él. */
export function originalUrl(conversationId: string, eventId: string, tail = ''): string {
  return `/api/conversations/${encodeURIComponent(conversationId)}/events/${encodeURIComponent(eventId)}/original${tail}`;
}

export function attachmentUrl(conversationId: string, eventId: string, partId: string): string {
  return originalUrl(conversationId, eventId, `/attachments/${encodeURIComponent(partId)}`);
}

/** Lo que no debe ni intentarse dentro del marco. */
export function sanitizeMailHtml(html: string): string {
  return (
    html
      // Elementos que ejecutan, cargan otro documento o cambian a dónde apunta.
      .replace(/<(script|noscript|iframe|frame|frameset|object|embed|applet|template)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<\/?(script|noscript|iframe|frame|frameset|object|embed|applet|template|meta|base|link)\b[^>]*>/gi, '')
      // Manejadores de evento, con o sin comillas.
      .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      // javascript:, vbscript: y data:text/html en enlaces y orígenes.
      .replace(
        /\s(href|src|action|formaction|xlink:href)\s*=\s*("\s*(?:javascript|vbscript|data:text\/html)[^"]*"|'\s*(?:javascript|vbscript|data:text\/html)[^']*'|(?:javascript|vbscript|data:text\/html)[^\s>]*)/gi,
        ' $1="#"',
      )
  );
}

/** ¿Pide imágenes de fuera? Entonces vale la pena ofrecer verlas. */
export function hasRemoteImages(html: string): boolean {
  return (
    /<img\b[^>]*\ssrc\s*=\s*["']?\s*(https?:)?\/\//i.test(html) ||
    /url\(\s*["']?\s*(https?:)?\/\//i.test(html) ||
    /\sbackground\s*=\s*["']?\s*(https?:)?\/\//i.test(html)
  );
}

/** La CSP del documento del correo: nada de fuera salvo, si se pide, imágenes. */
export function mailDocumentCsp(images: boolean): string {
  return [
    "default-src 'none'",
    `img-src data:${images ? ' https: http:' : ''}`,
    "style-src 'unsafe-inline'",
    'font-src data:',
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/**
 * El documento que pinta el iframe (`srcdoc`) o la vista aparte. El correo
 * trae a menudo su propio `<html><head><body>`: dentro de nuestro `<body>`
 * el analizador del navegador los ignora y conserva su contenido y estilos.
 * Los estilos de aquí son del documento de fuera, no de Hour: el correo se
 * diseñó sobre papel claro y se respeta.
 */
export function mailDocument(html: string, opts: { images?: boolean } = {}): string {
  const csp = mailDocumentCsp(opts.images ?? false).replace(/"/g, '&quot;');
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    '<meta name="referrer" content="no-referrer">' +
    '<base target="_blank">' +
    '<style>:root{color-scheme:light}body{margin:0;padding:0.75rem;background:Canvas;color:CanvasText;' +
    'font:0.875rem/1.5 system-ui,sans-serif;overflow-wrap:anywhere}img{max-inline-size:100%;block-size:auto}</style>' +
    `</head><body>${sanitizeMailHtml(html)}</body></html>`
  );
}

/** «12 KB», «1,4 MB»: el tamaño de un adjunto. */
export function attachmentSize(bytes: number, locale: string): string {
  const nf = (n: number, digits: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);
  if (bytes < 1024) return `${nf(bytes, 0)} B`;
  if (bytes < 1024 * 1024) return `${nf(bytes / 1024, 0)} KB`;
  return `${nf(bytes / (1024 * 1024), 1)} MB`;
}
