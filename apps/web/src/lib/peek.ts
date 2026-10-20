/**
 * El vistazo (ADR-139 p1 A): mirar cualquier cosa sin salir de la lente.
 *
 * What the vistazo has open is written in the address bar, `?peek=…`, so a
 * link to it can be shared and Back closes it. This module is the pure half:
 * the vocabulary of what can be peeked, how it is spelled in the URL, which
 * link opens which peek, and where its full page lives. Navigation (push,
 * close) is `$lib/peek.svelte`.
 *
 *   ?peek=date/<id>                  a rehearsal, a trip, a day off… (no page of its own)
 *   ?peek=bolo/<project>/<id>        the money unit (its home is a row of Cuentas)
 *   ?peek=performance/<space>/<slug>
 *   ?peek=conversation/<space>/<slug or id>
 *   ?peek=person/<space>/<slug>
 *
 * A bolo carries its project because the money feed is read by project
 * (`list_money_bolos` takes no id), and a shared link must be enough.
 */

import { booksHref, type BooksHere } from '$lib/bolo-pick';

export type PeekTarget =
  | { kind: 'date'; id: string }
  | { kind: 'bolo'; projectId: string; id: string }
  | { kind: 'performance'; ws: string; slug: string }
  | { kind: 'conversation'; ws: string; slug: string }
  | { kind: 'person'; ws: string; slug: string };

export type PeekKind = PeekTarget['kind'];

export const PEEK_PARAM = 'peek';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** One path segment: what a space slug or a record slug can be. */
const SEGMENT = /^[^/?#\s]+$/;

const RECORD_KINDS = ['performance', 'conversation', 'person'] as const;
type RecordKind = (typeof RECORD_KINDS)[number];

function isRecordKind(k: string): k is RecordKind {
  return (RECORD_KINDS as readonly string[]).includes(k);
}

/** How a target is spelled in `?peek=`. */
export function formatPeek(t: PeekTarget): string {
  switch (t.kind) {
    case 'date':
      return `date/${t.id}`;
    case 'bolo':
      return `bolo/${t.projectId}/${t.id}`;
    default:
      return `${t.kind}/${t.ws}/${t.slug}`;
  }
}

/** The target a `?peek=` value names, or null when it names nothing valid. */
export function parsePeek(raw: string | null | undefined): PeekTarget | null {
  if (!raw) return null;
  const parts = raw.split('/');
  const [kind, a, b] = parts;
  if (kind === 'date') return parts.length === 2 && UUID.test(a ?? '') ? { kind, id: a!.toLowerCase() } : null;
  if (kind === 'bolo') {
    return parts.length === 3 && UUID.test(a ?? '') && UUID.test(b ?? '')
      ? { kind, projectId: a!.toLowerCase(), id: b!.toLowerCase() }
      : null;
  }
  if (kind && isRecordKind(kind) && parts.length === 3 && SEGMENT.test(a ?? '') && SEGMENT.test(b ?? '')) {
    return { kind, ws: a!, slug: b! };
  }
  return null;
}

export function samePeek(a: PeekTarget | null, b: PeekTarget | null): boolean {
  if (!a || !b) return a === b;
  return formatPeek(a) === formatPeek(b);
}

/** The same address with this peek open (or none, with `null`). */
export function withPeek(url: URL, t: PeekTarget | null): URL {
  const next = new URL(url);
  if (t) next.searchParams.set(PEEK_PARAM, formatPeek(t));
  else next.searchParams.delete(PEEK_PARAM);
  // A hash belongs to the page under the peek (a Books row, a block): a peek
  // that opens or closes does not move it.
  return next;
}

/** A link that opens this peek over the page it is on (keeps its search). */
export function peekHref(t: PeekTarget, here: URL): string {
  const url = withPeek(here, t);
  return `${url.pathname}${url.search}`;
}

/**
 * Where the whole thing lives, «abrir completa». A date has no page (its
 * edit is the dialog); a bolo's home is its row in Cuentas, and `here` (your
 * pins, the project's space) keeps that link off your scope when the scope
 * already shows it (`booksHref`).
 */
export function fullHref(t: PeekTarget, here?: BooksHere): string | null {
  switch (t.kind) {
    case 'date':
      return null;
    case 'bolo':
      return booksHref(t.projectId, { boloId: t.id, here });
    default:
      return `/h/${t.ws}/${t.kind}/${t.slug}`;
  }
}

/** A record's page: `/h/<space>/<kind>/<slug>`, with nothing after it. */
const RECORD_PATH = /^\/h\/([^/]+)\/(performance|conversation|person)\/([^/]+)\/?$/;
/** The lens portadas: the four lenses, also inside one space. */
const LENS_PATH = /^\/h\/(?:[^/]+\/)?(?:desk|planner|conversations|books|money)\/?$/;

export function isLensPath(pathname: string): boolean {
  return LENS_PATH.test(pathname);
}

/**
 * The peek a link points to, read from the link alone: an explicit
 * `?peek=` on the page you are on, a record's page, or a bolo's row in
 * Cuentas. Null for everything else (a road sheet, Settings, a project).
 * `here` is the page the click happens on.
 */
export function peekFromLink(href: URL, here: URL): PeekTarget | null {
  if (href.origin !== here.origin) return null;
  if (href.searchParams.has(PEEK_PARAM)) {
    return href.pathname === here.pathname ? parsePeek(href.searchParams.get(PEEK_PARAM)) : null;
  }
  const record = RECORD_PATH.exec(href.pathname);
  // A link to a block of a page (`#board`, `#team`, `#who-goes`) names a
  // place in the page: it goes there, where the block has its room.
  if (record && !href.hash) {
    const [, ws, kind, slug] = record;
    return parsePeek(`${kind}/${decodeURIComponent(ws!)}/${decodeURIComponent(slug!)}`);
  }
  // Cuentas' own rows unfold in place: only a bolo link from elsewhere peeks.
  if (href.pathname.replace(/\/$/, '') === '/h/books' && here.pathname.replace(/\/$/, '') !== '/h/books') {
    const bolo = /^#bolo-(.+)$/.exec(href.hash);
    const scope = /^p:(.+)$/.exec(href.searchParams.get('scope') ?? '');
    // A link with a verb (`act`: cobrar, facturar…) asks Cuentas to DO it:
    // it goes there, even from inside the bolo's own peek.
    if (bolo && scope && !href.searchParams.has('act')) return parsePeek(`bolo/${scope[1]}/${bolo[1]}`);
  }
  return null;
}

/**
 * Whether a click on a link to `t` opens the peek instead of the page.
 * From a lens, always: that is the point (you stay where you were). From
 * inside a peek, always: the panel follows the link. From a record's page,
 * only what has no page of its own (a date, a bolo): a page links to pages.
 */
export function peekOpensFrom(t: PeekTarget, herePath: string, insidePeek: boolean): boolean {
  if (insidePeek) return true;
  if (t.kind === 'date' || t.kind === 'bolo') return true;
  return isLensPath(herePath);
}
