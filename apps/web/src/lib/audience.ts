/**
 * El público de una compañía (ADR-173; plan `build/plans/2026-11-01-audience.md`
 * § 2, § 3.6, § 6): tipos y esquemas que comparten el Worker y la pantalla, el
 * CSV de una importación y los enlaces del formulario. Aquí no hay nada de
 * servidor.
 *
 * Una lista es un propósito con su texto de consentimiento; una persona
 * apuntada es una suscripción. Escribe la base por RPC; esto solo da forma.
 */

import * as v from 'valibot';

export const AUDIENCE_LANGUAGES = ['es', 'ca', 'en', 'fr'] as const;
export type AudienceLanguage = (typeof AUDIENCE_LANGUAGES)[number];

export type AudienceStatus = 'draft' | 'open' | 'closed' | 'archived';
export type SubscriptionStatus = 'pending' | 'confirmed' | 'unsubscribed';
export type AudienceSource = 'form' | 'embed' | 'import' | 'manual';
export type ImportBasis = 'consent' | 'relationship';
export type ImportStatus = 'review' | 'done' | 'rejected';

export interface AudienceItem {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  form_key: string;
  languages: AudienceLanguage[];
  default_language: AudienceLanguage;
  status: AudienceStatus;
  current_text_version: number | null;
  created_at: string;
  updated_at: string;
}

export const AUDIENCE_SELECT =
  'id,workspace_id,name,description,form_key,languages,default_language,status,current_text_version,created_at,updated_at';

/** Cuántas hay en cada estado. */
export type AudienceCounts = Record<SubscriptionStatus, number>;

/** Una fila de `audience_counts` (106): los recuentos de una lista con alguien. */
export interface AudienceCountsRow extends AudienceCounts {
  audience_id: string;
}

/**
 * Los recuentos de cada lista, de las filas de `audience_counts`. Una lista
 * sin nadie no tiene fila: ceros. PostgREST da `bigint` como número.
 */
export function countsByAudience(ids: readonly string[], rows: readonly AudienceCountsRow[]): Map<string, AudienceCounts> {
  const byId = new Map(rows.map((r) => [r.audience_id, r]));
  return new Map(
    ids.map((id) => {
      const r = byId.get(id);
      return [id, { confirmed: Number(r?.confirmed ?? 0), pending: Number(r?.pending ?? 0), unsubscribed: Number(r?.unsubscribed ?? 0) }];
    }),
  );
}

/** Lo que pide quien entra: ver, editar y, solo admin, la prueba y borrar. */
export interface AudienceAccess {
  read: boolean;
  edit: boolean;
  admin: boolean;
}

/** Una lista en la vista Público, con sus recuentos. */
export interface AudienceSummary extends AudienceItem {
  counts: AudienceCounts;
}

/** GET /api/audience. */
export interface AudienceListResponse {
  items: AudienceSummary[];
  /** Por espacio: quien no lleva el público de ninguno no ve la vista. */
  access: Record<string, AudienceAccess>;
}

export interface ConsentTextRow {
  id: string;
  version: number;
  language: AudienceLanguage;
  consent_text: string;
  info_text: string | null;
  privacy_url: string | null;
  created_at: string;
}

export interface SubscriptionRow {
  id: string;
  address: string;
  name: string | null;
  language: AudienceLanguage;
  status: SubscriptionStatus;
  basis_kind: ImportBasis;
  source: AudienceSource;
  import_id: string | null;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  created_at: string;
}

export const SUBSCRIPTION_SELECT =
  'id,address,name,language,status,basis_kind,source,import_id,confirmed_at,unsubscribed_at,created_at';

export interface ImportRow {
  id: string;
  filename: string | null;
  basis_kind: ImportBasis;
  source_note: string;
  declared_at: string;
  row_count: number;
  imported_count: number;
  skipped: Partial<Record<ImportSkip, number>>;
  status: ImportStatus;
  reviewed_at: string | null;
}

export const IMPORT_SELECT =
  'id,filename,basis_kind,source_note,declared_at,row_count,imported_count,skipped,status,reviewed_at';

export type ImportSkip = 'invalid' | 'duplicate' | 'suppressed' | 'unsubscribed' | 'existing';

/** GET /api/audience/[id]. */
export interface AudienceDetail {
  audience: AudienceItem;
  workspace: { id: string; slug: string; name: string; privacy_url: string | null };
  access: AudienceAccess;
  /** Los textos vigentes, uno por idioma de la lista. */
  texts: ConsentTextRow[];
  /** Las más recientes, hasta 5000. */
  subscriptions: SubscriptionRow[];
  /** Cuántas hay en total: si son más que las traídas, la página lo dice. */
  subscriptions_total: number;
  imports: ImportRow[];
  /** Mientras el envío sea simulado, la lista no se abre a gente real (plan § 5.4). */
  simulated: boolean;
}

/** Una invitación que recibió una persona apuntada (su ficha). */
export interface SubscriptionInvitation {
  recipient_id: string;
  mailout_id: string;
  subject: string | null;
  status: string;
  sent_at: string | null;
}

/** El resultado de `import_audience`. */
export interface ImportResult {
  import_id: string;
  status: ImportStatus;
  row_count: number;
  imported_count: number;
  skipped: Partial<Record<ImportSkip, number>>;
}

// ── Esquemas de lo que escribe una persona ─────────────────────────────────

const uuid = v.pipe(v.string(), v.uuid());
const languages = v.pipe(v.array(v.picklist(AUDIENCE_LANGUAGES)), v.minLength(1), v.maxLength(4));
const name = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100));

export const AudienceCreateSchema = v.object({
  workspace_id: uuid,
  name,
  languages: v.optional(languages, ['es']),
  default_language: v.optional(v.picklist(AUDIENCE_LANGUAGES)),
});

const TextSchema = v.object({
  consent_text: v.pipe(v.string(), v.trim(), v.minLength(10), v.maxLength(500)),
  info_text: v.nullish(v.pipe(v.string(), v.trim(), v.maxLength(1500))),
});

/** PATCH /api/audience/[id]: una cosa por vez. */
export const AudienceUpdateSchema = v.variant('action', [
  v.object({
    action: v.literal('details'),
    name,
    description: v.nullish(v.pipe(v.string(), v.trim(), v.maxLength(500))),
    languages,
    default_language: v.picklist(AUDIENCE_LANGUAGES),
  }),
  v.object({ action: v.literal('texts'), texts: v.record(v.picklist(AUDIENCE_LANGUAGES), TextSchema) }),
  v.object({ action: v.literal('status'), status: v.picklist(['draft', 'open', 'closed', 'archived']) }),
  v.object({ action: v.literal('key') }),
]);

/** Filas por importación: el tope de `import_audience`. */
export const IMPORT_MAX_ROWS = 5000;

export const ImportSchema = v.object({
  filename: v.nullish(v.pipe(v.string(), v.maxLength(255))),
  rows: v.pipe(
    v.array(
      v.object({
        email: v.pipe(v.string(), v.maxLength(320)),
        name: v.nullish(v.pipe(v.string(), v.maxLength(400))),
        language: v.nullish(v.pipe(v.string(), v.maxLength(10))),
      }),
    ),
    v.minLength(1),
    v.maxLength(IMPORT_MAX_ROWS),
  ),
  basis_kind: v.picklist(['consent', 'relationship']),
  source_note: v.pipe(v.string(), v.trim(), v.minLength(10), v.maxLength(1000)),
  /** La declaración aceptada: sin ella no se importa (plan § 3.6). */
  statement_accepted: v.literal(true),
  statement_language: v.picklist(AUDIENCE_LANGUAGES),
});

export const InvitationCreateSchema = v.object({
  workspace_id: uuid,
  audience_id: v.nullish(uuid),
  conversation_ids: v.optional(v.pipe(v.array(uuid), v.maxLength(2000)), []),
  project_id: v.nullish(uuid),
  performance_id: v.nullish(uuid),
});

export const InvitationAudienceSchema = v.object({ audience_id: v.nullable(uuid) });

/** Alta a mano (tarea 101; `add_audience_subscription`): la persona lo pidió en persona; la confirmación lo prueba. */
export const AudienceAddSchema = v.object({
  address: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.maxLength(254), v.regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)),
  name: v.nullish(v.pipe(v.string(), v.trim(), v.maxLength(200))),
  language: v.nullish(v.picklist(AUDIENCE_LANGUAGES)),
});

/**
 * Qué pasó con un alta a mano, para la pantalla:
 *   · `sent`: queda sin confirmar y le ha salido el correo de confirmación.
 *   · `no_route`: queda sin confirmar, pero no hay por dónde mandarlo (sin
 *     dominio del público verificado, o un espacio de prueba y una dirección real).
 *   · `failed`: el proveedor no aceptó el correo; puede volver a intentarse.
 *   · `confirmed`: ya estaba confirmada; no se le manda nada.
 *   · `recent`: ya se le mandó una hace menos de 24 horas, o tres en total.
 */
export type AddPersonOutcome = 'sent' | 'no_route' | 'failed' | 'confirmed' | 'recent';

/** POST /api/audience/[id]/people. */
export interface AddPersonResult {
  subscription_id: string;
  outcome: AddPersonOutcome;
}

/**
 * El resultado a partir de lo que dijo la base: si `add_audience_subscription`
 * pidió confirmación, lo que pasó al mandarla; si no, por qué no (ya
 * confirmada, o el cupo de la persona).
 */
export function addPersonOutcome(
  askedConfirmation: boolean,
  send: 'sent' | 'no_route' | 'failed' | null,
  status: SubscriptionStatus | null,
): AddPersonOutcome {
  if (askedConfirmation) return send ?? 'no_route';
  return status === 'confirmed' ? 'confirmed' : 'recent';
}

/** Otra lista del mismo espacio en la que está la misma dirección (ADR-173 § 7). */
export interface AudienceAlso {
  audience_id: string;
  name: string;
  status: Exclude<SubscriptionStatus, 'unsubscribed'>;
}

/**
 * Las otras listas en las que está apuntada una dirección: sin la baja (de
 * baja ya no está apuntada), sin la lista desde la que se mira, una vez por
 * lista y por nombre.
 */
export function alsoSubscribed(
  rows: { audience_id: string; status: SubscriptionStatus; audience: { name: string } | null }[],
  exceptAudienceId: string | null = null,
): AudienceAlso[] {
  const seen = new Set<string>();
  const out: AudienceAlso[] = [];
  for (const r of rows) {
    if (r.status === 'unsubscribed' || !r.audience || r.audience_id === exceptAudienceId || seen.has(r.audience_id)) continue;
    seen.add(r.audience_id);
    out.push({ audience_id: r.audience_id, name: r.audience.name, status: r.status });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Una invitación en borrador a la que se puede poner una lista (tarea 103). */
export interface InvitationDraft {
  id: string;
  subject: string | null;
  created_at: string;
  /** La lista que ya lleva, si lleva una: una invitación tiene una sola. */
  audience: { id: string; name: string } | null;
}

/** Los borradores que se ofrecen: sin el que ya lleva esta lista; lo último arriba. */
export function draftChoices(drafts: readonly InvitationDraft[], audienceId: string): InvitationDraft[] {
  return drafts.filter((d) => d.audience?.id !== audienceId).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// ── El CSV de una importación ──────────────────────────────────────────────

/** Una fila reconocida del fichero. */
export interface CsvPerson {
  email: string;
  name: string | null;
  language: string | null;
}

export interface CsvRead {
  rows: CsvPerson[];
  /** Las columnas que se han reconocido, por su nombre en el fichero. */
  columns: { email: string | null; name: string | null; language: string | null };
  /** Filas del fichero sin contar la cabecera. */
  total: number;
}

const HEADER_WORDS: Record<keyof CsvRead['columns'], string[]> = {
  email: ['email', 'e-mail', 'correo', 'correo electronico', 'correu', 'correu electronic', 'mail', 'adresse e-mail', 'courriel'],
  name: ['name', 'nombre', 'nom', 'full name', 'nombre completo', 'nom complet', 'first name', 'prenom'],
  language: ['language', 'idioma', 'lang', 'langue', 'llengua'],
};

function plain(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_\s]+/g, ' ');
}

/** Coma, punto y coma o tabulador: el que más sale en la primera línea. */
function delimiterOf(firstLine: string): string {
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

/** Las celdas de un CSV con comillas (RFC 4180), sin dependencias. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const d = delimiter ?? delimiterOf(src.split(/\r?\n/, 1)[0] ?? '');
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === d) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out.filter((r) => r.some((x) => x.trim()));
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Las personas de un CSV: la columna del correo por su cabecera o, sin
 * cabecera reconocible, la primera que lleva direcciones. Nombre e idioma solo
 * si su cabecera se reconoce. Lo que la base salta (mal formadas, repetidas,
 * excluidas) lo decide `import_audience`; aquí no se descarta nada.
 */
export function readAudienceCsv(text: string): CsvRead {
  const cells = parseCsv(text);
  const columns: CsvRead['columns'] = { email: null, name: null, language: null };
  if (cells.length === 0) return { rows: [], columns, total: 0 };
  const head = cells[0].map(plain);
  const find = (k: keyof CsvRead['columns']) => head.findIndex((h) => HEADER_WORDS[k].includes(h));
  let emailAt = find('email');
  let body = cells.slice(1);
  if (emailAt < 0) {
    // Sin cabecera: la primera columna con una dirección en la primera fila.
    emailAt = cells[0].findIndex((c) => EMAIL_RE.test(c.trim()));
    body = cells;
  } else columns.email = cells[0][emailAt].trim();
  const nameAt = emailAt >= 0 && body !== cells ? find('name') : -1;
  const langAt = emailAt >= 0 && body !== cells ? find('language') : -1;
  if (nameAt >= 0) columns.name = cells[0][nameAt].trim();
  if (langAt >= 0) columns.language = cells[0][langAt].trim();
  if (emailAt < 0) return { rows: [], columns, total: body.length };
  return {
    rows: body.map((r) => ({
      email: (r[emailAt] ?? '').trim().toLowerCase(),
      name: nameAt >= 0 ? (r[nameAt] ?? '').trim() || null : null,
      language: langAt >= 0 ? (r[langAt] ?? '').trim().toLowerCase() || null : null,
    })),
    columns,
    total: body.length,
  };
}

// ── Enlaces del formulario (plan § 3.2) ────────────────────────────────────

export function formUrl(origin: string, key: string): string {
  return `${origin.replace(/\/+$/, '')}/public/audience/${key}`;
}

/** El código para pegar en la web de la compañía. */
export function embedCode(origin: string, key: string, title: string): string {
  const safe = title.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<iframe src="${formUrl(origin, key)}/embed" title="${safe}" width="100%" height="560" loading="lazy" style="border:0"></iframe>`;
}
