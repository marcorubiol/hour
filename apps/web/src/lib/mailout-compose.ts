/**
 * Montar el correo de un envío (plan § 3.4, ADR-115). Puro y compartido: la
 * vista previa de la pantalla y la cola del Worker llaman a lo mismo, así que
 * lo que se ve es lo que sale.
 *
 *   · Campos: `{nombre}`, `{sala}`, `{ciudad}`. Un campo que no tiene valor
 *     para un destinatario se marca y ese correo no sale (nunca vacío).
 *     `{nombre}` de una dirección genérica es «equipo de {sala}».
 *   · Firma: la de la compañía (el remitente es la compañía, ADR-110 § 3): la
 *     guardada o la que propone Hour, como el buzón común (ADR-099).
 *   · Pie (no se puede quitar): quién escribe, por qué le llega según su base,
 *     la baja en un clic y la política de privacidad si la hay. En el idioma
 *     del envío, no en el de la pantalla.
 *   · Cabeceras de baja de RFC 8058.
 * Al historial de la conversación va el cuerpo con los campos y la firma, sin
 * el pie: el enlace de baja es de la sala, no del equipo.
 */

import { proposedSignature, withSignature, displayWebsite } from './mail';

export const MAILOUT_LANGUAGES = ['es', 'ca', 'en', 'fr'] as const;
export type MailoutLanguage = (typeof MAILOUT_LANGUAGES)[number];

export const MERGE_FIELDS = ['nombre', 'sala', 'ciudad'] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

export type MailBasisKind = 'consent' | 'relationship' | 'generic';

/** Lo que devuelven `mailout_compose_preview` y `mailout_send_context`. */
export interface ComposeContext {
  recipient_id: string;
  address_kind: 'contact' | 'organization' | null;
  basis_kind: MailBasisKind | null;
  contact_first_name: string | null;
  contact_name: string | null;
  organization_name: string | null;
  city: string | null;
  company_name: string;
  company_city: string | null;
  company_website: string | null;
  company_phone: string | null;
  company_signature: string | null;
  privacy_url: string | null;
}

export interface MailoutDraft {
  subject: string;
  body: string;
  language: string;
}

export interface ComposedMail {
  subject: string;
  text: string;
  html: string;
  /** Lo que queda en el historial de la conversación: sin el pie. */
  recordBody: string;
  /** Campos usados sin valor para este destinatario: no sale. */
  missing: MergeField[];
}

type Copy = {
  team: (sala: string | null) => string;
  consent: string;
  relationship: string;
  generic: (sala: string | null) => string;
  unsubscribe: (company: string, url: string) => string;
  privacy: (url: string) => string;
  test: string;
};

const COPY: Record<MailoutLanguage, Copy> = {
  es: {
    team: (s) => (s ? `equipo de ${s}` : 'equipo'),
    consent: 'Os escribimos porque nos pedisteis recibir nuestras propuestas.',
    relationship: 'Os escribimos porque ya hemos trabajado juntos.',
    generic: (s) =>
      s
        ? `Os escribimos porque es la dirección de programación de ${s}.`
        : 'Os escribimos porque es vuestra dirección pública de programación.',
    unsubscribe: (c, u) => `Si no queréis recibir más envíos de ${c}, daos de baja aquí: ${u} Un clic basta.`,
    privacy: (u) => `Política de privacidad: ${u}`,
    test: '[Prueba]',
  },
  ca: {
    team: (s) => (s ? `equip de ${s}` : 'equip'),
    consent: 'Us escrivim perquè ens vau demanar rebre les nostres propostes.',
    relationship: 'Us escrivim perquè ja hem treballat junts.',
    generic: (s) =>
      s
        ? `Us escrivim perquè és l'adreça de programació de ${s}.`
        : 'Us escrivim perquè és la vostra adreça pública de programació.',
    unsubscribe: (c, u) =>
      `Si no voleu rebre més enviaments de ${c}, doneu-vos de baixa aquí: ${u} N'hi ha prou amb un clic.`,
    privacy: (u) => `Política de privacitat: ${u}`,
    test: '[Prova]',
  },
  en: {
    team: (s) => (s ? `${s} team` : 'team'),
    consent: 'We are writing because you asked to receive our proposals.',
    relationship: 'We are writing because we have worked together before.',
    generic: (s) =>
      s
        ? `We are writing because this is the programming address of ${s}.`
        : 'We are writing because this is your public programming address.',
    unsubscribe: (c, u) =>
      `If you would rather not receive more mailouts from ${c}, unsubscribe here: ${u} One click is enough.`,
    privacy: (u) => `Privacy policy: ${u}`,
    test: '[Test]',
  },
  fr: {
    team: (s) => (s ? `l'équipe de ${s}` : "l'équipe"),
    consent: 'Nous vous écrivons parce que vous nous avez demandé de recevoir nos propositions.',
    relationship: 'Nous vous écrivons parce que nous avons déjà travaillé ensemble.',
    generic: (s) =>
      s
        ? `Nous vous écrivons parce que c'est l'adresse de programmation de ${s}.`
        : "Nous vous écrivons parce que c'est votre adresse publique de programmation.",
    unsubscribe: (c, u) =>
      `Si vous ne souhaitez plus recevoir d'envois de ${c}, désinscrivez-vous ici : ${u} Un clic suffit.`,
    privacy: (u) => `Politique de confidentialité : ${u}`,
    test: '[Test]',
  },
};

export function mailoutLanguage(raw: string | null | undefined): MailoutLanguage {
  return (MAILOUT_LANGUAGES as readonly string[]).includes(raw ?? '') ? (raw as MailoutLanguage) : 'es';
}

const FIELD_RE = /\{(nombre|sala|ciudad)\}/g;

/** Los campos que usa un texto, sin repetir, en el orden de MERGE_FIELDS. */
export function fieldsUsed(...texts: string[]): MergeField[] {
  const found = new Set<string>();
  for (const text of texts) for (const m of text.matchAll(FIELD_RE)) found.add(m[1]);
  return MERGE_FIELDS.filter((f) => found.has(f));
}

/** El valor de cada campo para un destinatario; null si no lo tiene. */
export function mergeValues(ctx: ComposeContext, language: MailoutLanguage): Record<MergeField, string | null> {
  const sala = ctx.organization_name?.trim() || null;
  const nombre =
    ctx.address_kind === 'organization' ? (sala ? COPY[language].team(sala) : null) : ctx.contact_first_name?.trim() || null;
  return { nombre, sala, ciudad: ctx.city?.trim() || null };
}

export function fillFields(text: string, values: Record<MergeField, string | null>): string {
  return text.replace(FIELD_RE, (whole, f: MergeField) => values[f] ?? whole);
}

/** La firma de la compañía: la guardada, o la que propone Hour. */
export function companySignature(ctx: ComposeContext): string {
  return (
    ctx.company_signature?.trim() ||
    proposedSignature(
      {
        full_name: null,
        title: null,
        company_name: ctx.company_name,
        company_website: ctx.company_website,
        company_phone: ctx.company_phone,
        signature: null,
        company_signature: null,
      },
      'workspace',
    )
  );
}

/** El pie: quién escribe, por qué le llega, la baja y la privacidad. */
export function footerLines(ctx: ComposeContext, language: MailoutLanguage, unsubscribeUrl: string): string[] {
  const copy = COPY[language];
  const who = [ctx.company_name, ctx.company_city, displayWebsite(ctx.company_website)].filter(Boolean).join(' · ');
  const sala = ctx.organization_name?.trim() || null;
  const why =
    ctx.basis_kind === 'consent'
      ? copy.consent
      : ctx.basis_kind === 'relationship'
        ? copy.relationship
        : ctx.basis_kind === 'generic'
          ? copy.generic(sala)
          : null;
  return [
    who,
    why,
    copy.unsubscribe(ctx.company_name, unsubscribeUrl),
    ctx.privacy_url ? copy.privacy(ctx.privacy_url) : null,
  ].filter((l): l is string => Boolean(l));
}

export function composeMailout(draft: MailoutDraft, ctx: ComposeContext, unsubscribeUrl: string): ComposedMail {
  const language = mailoutLanguage(draft.language);
  const values = mergeValues(ctx, language);
  const missing = fieldsUsed(draft.subject, draft.body).filter((f) => values[f] === null);
  const subject = fillFields(draft.subject.trim(), values);
  const recordBody = withSignature(fillFields(draft.body.trim(), values), companySignature(ctx));
  const text = `${recordBody}\n\n${footerLines(ctx, language, unsubscribeUrl).join('\n')}\n`;
  return { subject, text, html: textToHtml(text), recordBody, missing };
}

export function testSubject(subject: string, language: string): string {
  return `${COPY[mailoutLanguage(language)].test} ${subject}`;
}

/** El enlace de baja del pie y de la cabecera (ruta corta, plan § 7.1). */
export function unsubscribeUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/u/${token}`;
}

/** Baja en un clic (RFC 8058): las dos cabeceras van siempre juntas. */
export function unsubscribeHeaders(url: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const URL_RE = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)]/g;

/** El HTML gemelo mínimo: párrafos, saltos y enlaces; sin estilos ni imágenes. */
export function textToHtml(text: string): string {
  const paragraphs = text
    .trim()
    .split(/\n{2,}/)
    .map((p) => {
      const linked = escapeHtml(p).replace(URL_RE, (u) => `<a href="${u}">${u}</a>`);
      return `<p>${linked.replace(/\n/g, '<br>')}</p>`;
    });
  return `<!doctype html><html><body>${paragraphs.join('')}</body></html>`;
}
