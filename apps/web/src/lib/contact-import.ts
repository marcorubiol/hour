/**
 * Importar contactos desde una hoja (tarea 138). Todo lo puro: leer la hoja
 * (CSV, TSV pegado, las filas de un .xlsx), proponer qué es cada columna,
 * convertir cada fila en un contacto, unir las repetidas, comparar con lo que
 * ya está en Hour y preparar las tandas para `import_contacts`.
 *
 * Una fila guarda contactos y nada más: una persona, su organización y el
 * vínculo entre ambas, o una sola de las dos. Nunca una conversación. Lo que
 * no tiene campo en Hour va a la nota privada de quien importa (ADR-093),
 * como «Cabecera: valor».
 */

import * as v from 'valibot';
import { parseCsv, plain } from '$lib/audience';

/** Filas de datos por importación (sin la cabecera). */
export const CONTACT_IMPORT_MAX_ROWS = 2000;
/** Filas por llamada a `import_contacts`. */
export const CONTACT_IMPORT_BATCH = 500;

/** Lo que puede ser una columna en Hour. */
export const IMPORT_FIELDS = [
  'person_name',
  'first_name',
  'last_name',
  'title',
  'org_name',
  'org_kind',
  'email',
  'phone',
  'city',
  'country',
  'website',
  'last_contact',
  'note',
  'skip',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Los campos que sólo una columna puede ocupar; `note` y `skip` admiten varias. */
const SINGLE: ReadonlySet<ImportField> = new Set(IMPORT_FIELDS.filter((f) => f !== 'note' && f !== 'skip'));

/** Las cabeceras de cada campo en las cuatro lenguas, sin acentos ni puntos. */
const HEADER_WORDS: Record<Exclude<ImportField, 'note' | 'skip'>, readonly string[]> = {
  person_name: [
    'nombre', 'name', 'nom', 'full name', 'nombre completo', 'nom complet', 'nombre y apellidos',
    'nom i cognoms', 'nom et prenom', 'prenom et nom', 'contacto', 'contacte', 'contact', 'persona', 'person', 'personne',
  ],
  first_name: ['nombre de pila', 'first name', 'firstname', 'given name', 'prenom'],
  last_name: ['apellidos', 'apellido', 'cognoms', 'cognom', 'last name', 'lastname', 'surname', 'family name', 'nom de famille'],
  title: ['cargo', 'carrec', 'puesto', 'title', 'job title', 'job', 'role', 'rol', 'fonction', 'poste', 'position'],
  org_name: [
    'organizacion', 'organizacio', 'organization', 'organisation', 'entidad', 'entitat', 'empresa', 'company',
    'compania', 'companyia', 'compagnie', 'sala', 'venue', 'teatro', 'teatre', 'theatre', 'espacio', 'espai',
    'lieu', 'structure', 'institucion', 'institucio', 'institution',
  ],
  org_kind: ['tipo', 'tipus', 'type', 'kind', 'categoria', 'category', 'categorie', 'tipo de organizacion'],
  email: [
    'email', 'e-mail', 'e mail', 'emails', 'correo', 'correo electronico', 'correu', 'correu electronic', 'mail',
    'adresse e-mail', 'adresse mail', 'courriel',
  ],
  phone: ['telefono', 'tel', 'telefon', 'phone', 'telephone', 'movil', 'mobil', 'mobile', 'celular', 'portable', 'whatsapp'],
  city: ['ciudad', 'ciutat', 'city', 'ville', 'localidad', 'poblacion', 'poblacio', 'municipio', 'municipi', 'town', 'commune'],
  country: ['pais', 'country', 'pays'],
  website: ['web', 'website', 'sitio web', 'pagina web', 'url', 'site', 'site web', 'lloc web', 'pagina'],
  last_contact: [
    'ultimo contacto', 'ult contacto', 'ultim contacte', 'last contact', 'last contacted', 'dernier contact',
    'ultima vez', 'fecha contacto', 'fecha de contacto', 'data contacte', 'ultima conversacion',
  ],
};

/** Una cabecera, lista para casar: sin acentos, sin puntos ni signos. */
export function headerKey(s: string): string {
  return plain(s)
    .replace(/[.:#()*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** El campo que una cabecera nombra, si nombra alguno. */
export function fieldForHeader(header: string): Exclude<ImportField, 'note' | 'skip'> | null {
  const key = headerKey(header);
  if (!key) return null;
  for (const [field, words] of Object.entries(HEADER_WORDS) as [Exclude<ImportField, 'note' | 'skip'>, readonly string[]][]) {
    if (words.includes(key)) return field;
  }
  return null;
}

// ── La hoja ────────────────────────────────────────────────────────────────

export interface Sheet {
  /** La primera fila, la cabecera. */
  header: string[];
  /** Las filas de datos, todas con el ancho de la cabecera. */
  rows: string[][];
}

/**
 * La hoja a partir de sus celdas: la primera fila con algo es la cabecera;
 * las filas vacías no cuentan. Las columnas sin cabecera se llaman por su
 * letra («Col. J»), como en el boceto.
 */
export function sheetFromCells(cells: readonly (readonly string[])[], columnWord = 'Col.'): Sheet {
  const filled = cells.filter((r) => r.some((c) => (c ?? '').trim()));
  if (filled.length === 0) return { header: [], rows: [] };
  const width = Math.max(...filled.map((r) => r.length));
  const header = Array.from({ length: width }, (_, i) => (filled[0][i] ?? '').trim() || `${columnWord} ${columnLetter(i)}`);
  const rows = filled.slice(1).map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? '').trim()));
  return { header, rows };
}

/** 0 → «A», 27 → «AB». */
export function columnLetter(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Un CSV o lo pegado desde la hoja (tabuladores): el mismo lector que el público. */
export function sheetFromText(text: string, columnWord?: string): Sheet {
  return sheetFromCells(parseCsv(text), columnWord);
}

/**
 * El texto de un fichero que no es un zip: UTF-8 si lo es entero; si no, el
 * Windows-1252 con que Excel guarda un CSV en castellano, catalán o francés.
 */
export function decodeText(buf: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

// ── Las columnas ──────────────────────────────────────────────────────────

/**
 * Qué propone Hour para cada columna: el campo que su cabecera nombra (la
 * primera que lo nombra; las siguientes van a la nota), «A la nota» si tiene
 * algún valor y «No importar» si está vacía. Perder datos de la hoja es peor
 * que una nota larga.
 */
export function proposeColumns(sheet: Sheet): ImportField[] {
  const taken = new Set<ImportField>();
  return sheet.header.map((h, i) => {
    const field = fieldForHeader(h);
    if (field && !taken.has(field)) {
      taken.add(field);
      return field;
    }
    return sheet.rows.some((r) => r[i]) ? 'note' : 'skip';
  });
}

/** Elegir un campo para una columna: si otra lo tenía, esa pasa a la nota. */
export function assignColumn(mapping: readonly ImportField[], index: number, field: ImportField): ImportField[] {
  return mapping.map((f, i) => (i === index ? field : SINGLE.has(field) && f === field ? 'note' : f));
}

/** Correo o nombre (de persona u organización): sin uno de ellos no hay a quién guardar. */
export function mappingReady(mapping: readonly ImportField[]): boolean {
  return mapping.some((f) => f === 'person_name' || f === 'first_name' || f === 'last_name' || f === 'org_name' || f === 'email');
}

/** Los primeros valores no vacíos de una columna, para reconocerla. */
export function columnSample(sheet: Sheet, index: number, n = 3): string[] {
  const out: string[] = [];
  for (const r of sheet.rows) {
    if (r[index]) out.push(r[index]);
    if (out.length >= n) break;
  }
  return out;
}

// ── Las filas ─────────────────────────────────────────────────────────────

export const ORG_KINDS = ['company', 'festival', 'theatre', 'presenter', 'agency', 'institution', 'solo', 'other'] as const;
export type OrgKind = (typeof ORG_KINDS)[number];

/** Palabras de tipo, sin acentos ni puntos, por tipo de Hour. */
const KIND_WORDS: Record<OrgKind, readonly string[]> = {
  theatre: ['teatro', 'teatre', 'theatre', 'theater', 'sala', 'auditorio', 'auditori', 'auditorium', 'venue', 'espacio escenico', 'scene', 'salle', 'centro cultural', 'centre cultural', 'casa de cultura'],
  festival: ['festival', 'festivales', 'fira', 'feria', 'mostra', 'muestra', 'encuentro', 'trobada'],
  institution: [
    'ayuntamiento', 'ayto', 'ajuntament', 'aj', 'mairie', 'institucion', 'institucio', 'institution', 'ministerio',
    'ministeri', 'diputacion', 'diputacio', 'consell', 'cabildo', 'generalitat', 'gobierno', 'govern', 'council', 'public',
  ],
  presenter: ['programador', 'programadora', 'programacion', 'programacio', 'presenter', 'programmateur', 'programmatrice', 'red', 'xarxa', 'reseau', 'circuito', 'circuit'],
  agency: ['agencia', 'agency', 'agence', 'distribuidora', 'distribucion', 'distribucio', 'distribution', 'management', 'productora'],
  company: ['compania', 'companyia', 'compagnie', 'company', 'cia', 'grupo', 'collectif', 'colectivo'],
  solo: ['por libre', 'freelance', 'autonomo', 'autonoma', 'independiente', 'independent', 'solo'],
  other: ['otro', 'otra', 'otros', 'altre', 'altres', 'other', 'autre'],
};

/** El tipo de Hour de un texto de la hoja, o null si no se lee. */
export function kindFromText(text: string): OrgKind | null {
  const key = headerKey(text);
  if (!key) return null;
  if ((ORG_KINDS as readonly string[]).includes(key)) return key as OrgKind;
  for (const kind of ORG_KINDS) if (KIND_WORDS[kind].includes(key)) return kind;
  return null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Un número de serie de fecha de Excel (días desde 1899-12-30) como
 * día/mes/año; cualquier otro texto, igual. Sólo para «Último contacto», que
 * va a la nota tal cual se lee.
 */
export function excelDate(value: string): string {
  if (!/^\d{4,5}(\.\d+)?$/.test(value)) return value;
  const serial = Math.floor(Number(value));
  if (serial < 20000 || serial > 80000) return value;
  const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** Lo que va a una persona (en el dossier del espacio). */
export interface PersonPart {
  full_name: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  phone?: string;
  city?: string;
  country?: string;
  website?: string;
}

/** Lo que va a una organización. */
export interface OrgPart {
  name: string;
  kind?: OrgKind;
  email?: string;
  phone?: string;
  city?: string;
  country?: string;
  website?: string;
}

/** Por qué una fila no entra. */
export type RowError = 'no_name' | 'too_long';
/** Lo que entra distinto de como venía. */
export type RowIssue = 'bad_email' | 'kind_unread' | 'note_without_person' | 'other_org';

/** Una fila de la hoja, leída. */
export interface ContactRow {
  /** El número de fila en la hoja (la cabecera es la 1). */
  line: number;
  person: PersonPart | null;
  org: OrgPart | null;
  /** «Cabecera: valor», una por línea. */
  note: string[];
  error: RowError | null;
  issues: RowIssue[];
  /** El texto que no se ha podido leer como tipo de Hour. */
  rawKind?: string;
}

const LIMITS: Partial<Record<keyof PersonPart | keyof OrgPart, number>> = {
  title: 200,
  phone: 60,
  city: 120,
  website: 500,
  first_name: 200,
  last_name: 200,
};

/** Una fila de la hoja con las columnas elegidas. */
export function readRow(sheet: Sheet, mapping: readonly ImportField[], index: number): ContactRow {
  const cells = sheet.rows[index];
  const get = (f: ImportField) => {
    const i = mapping.indexOf(f);
    return i >= 0 ? (cells[i] ?? '').trim() : '';
  };
  const note: string[] = [];
  const issues: RowIssue[] = [];
  const toNote = (i: number, value: string) => {
    if (value) note.push(`${sheet.header[i]}: ${value}`);
  };
  const toNoteField = (f: ImportField, value: string) => toNote(mapping.indexOf(f), value);

  const first = get('first_name');
  const last = get('last_name');
  const fullName = get('person_name') || [first, last].filter(Boolean).join(' ');
  const orgName = get('org_name');

  let email = get('email').toLowerCase();
  if (email && !(EMAIL_RE.test(email) && email.length <= 320)) {
    issues.push('bad_email');
    toNoteField('email', get('email'));
    email = '';
  }
  let country = get('country').toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) {
    toNoteField('country', get('country'));
    country = '';
  }
  const kindText = get('org_kind');
  let kind: OrgKind | undefined;
  let rawKind: string | undefined;
  if (kindText) {
    const k = kindFromText(kindText);
    if (k) kind = k;
    else {
      issues.push('kind_unread');
      rawKind = kindText;
      toNoteField('org_kind', kindText);
    }
  }
  // Lo que no cabe en su campo se guarda entero en la nota.
  const fit = (f: ImportField, key: keyof typeof LIMITS) => {
    const value = get(f);
    if (value.length > (LIMITS[key] ?? Infinity)) {
      toNoteField(f, value);
      return '';
    }
    return value;
  };
  const title = fit('title', 'title');
  const phone = fit('phone', 'phone');
  const city = fit('city', 'city');
  const website = fit('website', 'website');
  const firstFit = fit('first_name', 'first_name');
  const lastFit = fit('last_name', 'last_name');

  mapping.forEach((f, i) => {
    if (f === 'note') toNote(i, cells[i] ?? '');
    if (f === 'last_contact') toNote(i, excelDate(cells[i] ?? ''));
  });

  const line = index + 2;
  if (!fullName && !orgName) {
    return { line, person: null, org: null, note, error: 'no_name', issues };
  }
  if (fullName.length > 200 || orgName.length > 200) {
    return { line, person: null, org: null, note, error: 'too_long', issues };
  }

  const compact = <T extends object>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([, x]) => x !== '' && x !== undefined)) as T;

  // Con persona, el correo, el teléfono, la web y el lugar son suyos; sin ella, de la organización.
  const person: PersonPart | null = fullName
    ? compact({ full_name: fullName, first_name: firstFit, last_name: lastFit, title, email, phone, city, country, website })
    : null;
  const org: OrgPart | null = orgName
    ? compact(person ? { name: orgName, kind } : { name: orgName, kind, email, phone, city, country, website })
    : null;
  if (!person && title) toNoteField('title', title);
  if (!person && note.length > 0) issues.push('note_without_person');
  return { line, person, org, note, error: null, issues, ...(rawKind ? { rawKind } : {}) };
}

/** Todas las filas de la hoja. */
export function readRows(sheet: Sheet, mapping: readonly ImportField[]): ContactRow[] {
  return sheet.rows.map((_, i) => readRow(sheet, mapping, i));
}

// ── Las repetidas dentro de la hoja ───────────────────────────────────────

/** Un contacto de la hoja: una o varias filas unidas. */
export interface SheetContact extends ContactRow {
  /** Todas sus filas, la primera la que manda. */
  lines: number[];
}

function rowKey(r: ContactRow): string {
  if (r.person?.email) return `e:${r.person.email}`;
  if (r.person) return `n:${plain(r.person.full_name)}|${plain(r.org?.name ?? '')}`;
  return `o:${plain(r.org?.name ?? '')}`;
}

function fillEmpty<T extends object>(into: T, from: T): T {
  const out = { ...into } as Record<string, unknown>;
  for (const [k, val] of Object.entries(from)) if (out[k] === undefined || out[k] === '') out[k] = val;
  return out as T;
}

/**
 * Une las filas que son el mismo contacto: mismo correo, o mismo nombre en
 * la misma organización (o la misma organización sola). Los campos se suman
 * (gana el primero que lo trae) y las notas se juntan. Una persona tiene una
 * organización (ADR-177): si otra fila trae otra, se dice y va a la nota.
 * Las filas que no entran no se unen con nada.
 */
export function mergeRows(rows: readonly ContactRow[], orgHeader = ''): SheetContact[] {
  const out: SheetContact[] = [];
  const byKey = new Map<string, SheetContact>();
  for (const r of rows) {
    if (r.error) {
      out.push({ ...r, lines: [r.line] });
      continue;
    }
    const key = rowKey(r);
    const seen = byKey.get(key);
    if (!seen) {
      const c: SheetContact = { ...r, note: [...r.note], issues: [...r.issues], lines: [r.line] };
      byKey.set(key, c);
      out.push(c);
      continue;
    }
    seen.lines.push(r.line);
    if (r.person) seen.person = seen.person ? fillEmpty(seen.person, r.person) : r.person;
    if (r.org) {
      if (!seen.org) seen.org = r.org;
      else if (plain(seen.org.name) === plain(r.org.name)) seen.org = fillEmpty(seen.org, r.org);
      else {
        if (!seen.issues.includes('other_org')) seen.issues.push('other_org');
        seen.note.push(`${orgHeader || 'Organización'}: ${r.org.name}`);
      }
    }
    for (const n of r.note) if (!seen.note.includes(n)) seen.note.push(n);
    for (const i of r.issues) if (!seen.issues.includes(i)) seen.issues.push(i);
  }
  return out;
}

// ── Lo que ya está en Hour ────────────────────────────────────────────────

/** Una persona que ya está (`contact_import_lookup`). */
export interface KnownPerson {
  person_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  organization_id: string | null;
  organization_name: string | null;
}

/** Una organización que ya está. */
export interface KnownOrg {
  id: string;
  name: string;
  kind: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
}

export interface ImportLookup {
  persons: KnownPerson[];
  organizations: KnownOrg[];
}

/** Lo que se pregunta a Hour: correos, nombres y organizaciones de la hoja. */
export function lookupRequest(contacts: readonly SheetContact[]): { emails: string[]; names: string[]; organizations: string[] } {
  const emails = new Set<string>();
  const names = new Set<string>();
  const orgs = new Set<string>();
  for (const c of contacts) {
    if (c.error) continue;
    if (c.person?.email) emails.add(c.person.email);
    if (c.person) names.add(c.person.full_name);
    if (c.org) orgs.add(c.org.name);
  }
  return { emails: [...emails], names: [...names], organizations: [...orgs] };
}

/** Qué pasa con un contacto de la hoja. */
export type ContactStatus = 'new' | 'fill' | 'same' | 'ask' | 'error';

/** Un contacto ya comparado con Hour. */
export interface PlannedContact extends SheetContact {
  status: ContactStatus;
  /** La persona de Hour con el mismo correo (completa su ficha). */
  existing: KnownPerson | null;
  /** Con el mismo nombre y sin el mismo correo: se pregunta. */
  candidate: KnownPerson | null;
  /** Lo que la propuesta hace con la pregunta: la misma o otra persona. */
  proposal: 'same' | 'other' | null;
  /** La organización de Hour con el mismo nombre. */
  knownOrg: KnownOrg | null;
  /** Los campos de la persona que se completan (vacíos en Hour). */
  personFills: (keyof PersonPart)[];
  /** Los de la organización. */
  orgFills: (keyof OrgPart)[];
}

const PERSON_FILLABLE: (keyof PersonPart)[] = ['title', 'phone', 'city', 'country', 'website'];
const ORG_FILLABLE: (keyof OrgPart)[] = ['kind', 'email', 'phone', 'city', 'country', 'website'];

function personFills(p: PersonPart, k: KnownPerson): (keyof PersonPart)[] {
  return PERSON_FILLABLE.filter((f) => p[f] && !k[f as keyof KnownPerson]);
}

function orgFills(o: OrgPart, k: KnownOrg): (keyof OrgPart)[] {
  return ORG_FILLABLE.filter((f) =>
    f === 'kind' ? Boolean(o.kind && o.kind !== 'other' && k.kind === 'other') : Boolean(o[f]) && !k[f as keyof KnownOrg],
  );
}

/**
 * Compara cada contacto con lo que ya está: mismo correo, la misma persona
 * (completa lo vacío); mismo nombre sin el correo, se pregunta, y la
 * propuesta es «la misma» si está en la misma organización; mismo nombre de
 * organización, la misma.
 */
export function planContacts(contacts: readonly SheetContact[], lookup: ImportLookup): PlannedContact[] {
  const byEmail = new Map(lookup.persons.filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p]));
  const byName = new Map<string, KnownPerson[]>();
  for (const p of lookup.persons) {
    const k = plain(p.full_name);
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }
  const orgByName = new Map(lookup.organizations.map((o) => [plain(o.name), o]));

  return contacts.map((c) => {
    const base: PlannedContact = {
      ...c,
      status: 'new',
      existing: null,
      candidate: null,
      proposal: null,
      knownOrg: c.org ? (orgByName.get(plain(c.org.name)) ?? null) : null,
      personFills: [],
      orgFills: [],
    };
    if (c.error) return { ...base, status: 'error', knownOrg: null };
    if (c.org && base.knownOrg) base.orgFills = orgFills(c.org, base.knownOrg);
    if (c.person) {
      const existing = c.person.email ? byEmail.get(c.person.email) : undefined;
      if (existing) {
        base.existing = existing;
        base.personFills = personFills(c.person, existing);
        const linksOrg = Boolean(c.org && !existing.organization_id);
        base.status = base.personFills.length > 0 || linksOrg || base.orgFills.length > 0 ? 'fill' : 'same';
        return base;
      }
      const named = (byName.get(plain(c.person.full_name)) ?? []).filter((p) => !p.email || !c.person!.email || p.email !== c.person!.email);
      if (named.length > 0) {
        const orgKey = plain(c.org?.name ?? '');
        const sameOrg = named.find((p) => orgKey && plain(p.organization_name ?? '') === orgKey);
        base.candidate = sameOrg ?? named[0];
        base.proposal = sameOrg ? 'same' : 'other';
        base.status = 'ask';
        return base;
      }
      return base;
    }
    // Sólo organización.
    if (base.knownOrg) base.status = base.orgFills.length > 0 ? 'fill' : 'same';
    return base;
  });
}

/** Las cifras de la revisión. */
export interface ImportTally {
  /** Filas de la hoja. */
  rows: number;
  newPersons: number;
  newOrgs: number;
  fills: number;
  same: number;
  /** Filas que se han unido a otra de la hoja. */
  merged: number;
  ask: number;
  errors: number;
  notes: number;
  /** Contactos que viajan a Hour. */
  toImport: number;
}

/** Las cifras, con las decisiones tomadas («la misma» no crea persona). */
export function tallyPlan(plan: readonly PlannedContact[], decisions: Readonly<Record<number, 'same' | 'other'>> = {}): ImportTally {
  const newOrgs = new Set<string>();
  const t: ImportTally = { rows: 0, newPersons: 0, newOrgs: 0, fills: 0, same: 0, merged: 0, ask: 0, errors: 0, notes: 0, toImport: 0 };
  for (const c of plan) {
    t.rows += c.lines.length;
    t.merged += c.lines.length - 1;
    if (c.status === 'error') {
      t.errors += 1;
      continue;
    }
    t.toImport += 1;
    if (c.org && !c.knownOrg) newOrgs.add(plain(c.org.name));
    if (c.status === 'ask') t.ask += 1;
    const decided = c.status === 'ask' ? (decisions[c.lines[0]] ?? c.proposal) : null;
    if (c.status === 'new' && c.person) t.newPersons += 1;
    if (c.status === 'ask' && decided === 'other') t.newPersons += 1;
    if (c.status === 'fill') t.fills += 1;
    if (c.status === 'same') t.same += 1;
    if (c.person && c.note.length > 0) t.notes += 1;
  }
  t.newOrgs = newOrgs.size;
  return t;
}

// ── Lo que viaja ──────────────────────────────────────────────────────────

/** Una fila para `import_contacts`. */
export interface ImportRowPayload {
  line: number;
  person?: PersonPart & { match_person_id?: string };
  organization?: OrgPart;
  note?: string;
}

/** Las filas que entran, con lo decidido: «la misma» lleva la persona de Hour. */
export function payloadRows(plan: readonly PlannedContact[], decisions: Readonly<Record<number, 'same' | 'other'>> = {}): ImportRowPayload[] {
  return plan
    .filter((c) => c.status !== 'error')
    .map((c) => {
      const row: ImportRowPayload = { line: c.lines[0] };
      if (c.person) {
        const decided = c.status === 'ask' ? (decisions[c.lines[0]] ?? c.proposal) : null;
        row.person = decided === 'same' && c.candidate ? { ...c.person, match_person_id: c.candidate.person_id } : { ...c.person };
      }
      if (c.org) row.organization = { ...c.org };
      if (c.note.length > 0 && c.person) row.note = c.note.join('\n').slice(0, 4000);
      return row;
    });
}

/** Trocea en tandas de envío. */
export function batches<T>(items: readonly T[], size = CONTACT_IMPORT_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Las filas que no han entrado, como TSV con su cabecera, para arreglarlas en la hoja. */
export function failedAsTsv(sheet: Sheet, lines: readonly number[]): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ');
  const wanted = [...new Set(lines)].sort((a, b) => a - b);
  return [sheet.header, ...wanted.map((l) => sheet.rows[l - 2]).filter(Boolean)].map((r) => r.map(clean).join('\t')).join('\n');
}

// ── Lo que la API valida ──────────────────────────────────────────────────

const Uuid = v.pipe(v.string(), v.uuid());
const text = (max: number) => v.optional(v.pipe(v.string(), v.trim(), v.maxLength(max)));

const PersonSchema = v.object({
  match_person_id: v.optional(Uuid),
  full_name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
  first_name: text(200),
  last_name: text(200),
  title: text(200),
  email: text(320),
  phone: text(60),
  city: text(120),
  country: v.optional(v.pipe(v.string(), v.regex(/^[A-Z]{2}$/))),
  website: text(500),
});

const OrgSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
  kind: v.optional(v.picklist(ORG_KINDS)),
  email: text(320),
  phone: text(60),
  city: text(120),
  country: v.optional(v.pipe(v.string(), v.regex(/^[A-Z]{2}$/))),
  website: text(500),
});

export const ContactImportRowSchema = v.object({
  line: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100000)),
  person: v.optional(PersonSchema),
  organization: v.optional(OrgSchema),
  note: v.optional(v.pipe(v.string(), v.maxLength(4000))),
});

export const ContactImportRequestSchema = v.object({
  workspace_id: Uuid,
  filename: v.nullish(v.pipe(v.string(), v.maxLength(255))),
  rows: v.pipe(v.array(ContactImportRowSchema), v.minLength(1), v.maxLength(CONTACT_IMPORT_MAX_ROWS)),
});

export type ContactImportRequest = v.InferOutput<typeof ContactImportRequestSchema>;

export const ContactLookupRequestSchema = v.object({
  workspace_id: Uuid,
  emails: v.pipe(v.array(v.pipe(v.string(), v.maxLength(320))), v.maxLength(CONTACT_IMPORT_MAX_ROWS)),
  names: v.pipe(v.array(v.pipe(v.string(), v.maxLength(200))), v.maxLength(CONTACT_IMPORT_MAX_ROWS)),
  organizations: v.pipe(v.array(v.pipe(v.string(), v.maxLength(200))), v.maxLength(CONTACT_IMPORT_MAX_ROWS)),
});

/** Por qué no ha entrado una fila, según la base. */
export type FailReason = 'no_name' | 'invalid' | 'hidden' | 'error';
export type WarnReason = 'organization_hidden' | 'other_organization' | 'note_without_person';

/** Lo que devuelve `POST /api/contact-imports`, sumadas las tandas. */
export interface ContactImportResult {
  import_id: string | null;
  persons_created: number;
  persons_filled: number;
  organizations_created: number;
  organizations_filled: number;
  notes_created: number;
  failed: { line: number | null; reason: FailReason }[];
  warnings: { line: number | null; reason: WarnReason }[];
  /** Una tanda no llegó a escribirse: las anteriores se quedan. */
  partial: boolean;
}

/** Suma el resultado de una tanda al total. */
export function addBatchResult(total: ContactImportResult, batch: Omit<ContactImportResult, 'partial'>): ContactImportResult {
  return {
    import_id: batch.import_id ?? total.import_id,
    persons_created: total.persons_created + batch.persons_created,
    persons_filled: total.persons_filled + batch.persons_filled,
    organizations_created: total.organizations_created + batch.organizations_created,
    organizations_filled: total.organizations_filled + batch.organizations_filled,
    notes_created: total.notes_created + batch.notes_created,
    failed: [...total.failed, ...batch.failed],
    warnings: [...total.warnings, ...batch.warnings],
    partial: total.partial,
  };
}

export const EMPTY_RESULT: ContactImportResult = {
  import_id: null,
  persons_created: 0,
  persons_filled: 0,
  organizations_created: 0,
  organizations_filled: 0,
  notes_created: 0,
  failed: [],
  warnings: [],
  partial: false,
};

/** Una importación en el historial (Ajustes). */
export interface ContactImportItem {
  id: string;
  workspace_id: string;
  created_by: string | null;
  created_by_name: string | null;
  filename: string | null;
  row_count: number;
  rows_failed: number;
  persons_created: number;
  persons_filled: number;
  organizations_created: number;
  organizations_filled: number;
  notes_created: number;
  status: 'importing' | 'done' | 'undone';
  undone_at: string | null;
  created_at: string;
}

export const CONTACT_IMPORT_SELECT =
  'id,workspace_id,created_by,filename,row_count,rows_failed,persons_created,persons_filled,organizations_created,organizations_filled,notes_created,status,undone_at,created_at';

/** Días para deshacer una importación. */
export const UNDO_DAYS = 7;

/** Los días que quedan para deshacerla (0: ya no se deshace). */
export function undoDaysLeft(item: Pick<ContactImportItem, 'created_at' | 'status'>, now = Date.now()): number {
  if (item.status === 'undone') return 0;
  const left = Date.parse(item.created_at) + UNDO_DAYS * 86_400_000 - now;
  return left > 0 ? Math.ceil(left / 86_400_000) : 0;
}

/** Lo que devuelve `undo_contact_import`. */
export interface UndoResult {
  persons_removed: number;
  organizations_removed: number;
  notes_removed: number;
  fields_restored: number;
  persons_kept: number;
  organizations_kept: number;
}
