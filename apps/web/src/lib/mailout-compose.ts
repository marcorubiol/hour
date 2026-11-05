/**
 * Montar el correo de un envío (plan § 3.4, ADR-115). Puro y compartido: la
 * vista previa de la pantalla y la cola del Worker llaman a lo mismo, así que
 * lo que se ve es lo que sale.
 *
 *   · Campos: `{nombre}`, `{sala}`, `{ciudad}`, `{obra}`, `{fecha}`, `{fecha_completa}`, `{hora}`. Un campo que no tiene valor
 *     para un destinatario se marca y ese correo no sale (nunca vacío).
 *     `{nombre}` de una dirección genérica es «equipo de {sala}».
 *   · Origen (ADR-173 § 10): lo dice la fila, no el envío. Una persona del
 *     público (`audience_subscription_id`) lleva su pie («te apuntaste a…») y,
 *     sin nombre, el saludo cae a «Hola» en vez de bloquear. Un profesional,
 *     el pie de la difusión según su base, también en una invitación.
 *   · En una invitación, `{sala}` y `{ciudad}` son los de la función a la que
 *     se invita, para los dos orígenes (plan del público § 4.7).
 *   · `{obra}`, `{fecha}` y `{hora}` (102): la obra del envío (o la de la
 *     función), el día de la función y su hora de inicio, en el idioma del
 *     correo y con el reloj de la sala (o el del espacio, si no tiene). La
 *     pantalla ofrece `{fecha}` y `{hora}` solo en una invitación.
 *   · Firma: la de la compañía (el remitente es la compañía, ADR-110 § 3): la
 *     guardada o la que propone Hour, como el buzón común (ADR-099).
 *   · Pie (no se puede quitar): quién escribe, por qué le llega según su base,
 *     la baja en un clic y la política de privacidad si la hay. En el idioma
 *     del correo, no en el de la pantalla.
 *   · Idioma del correo (104, Marco 2026-11-03): el de la suscripción de una
 *     persona del público (en el que se dio de alta o entró importada); el del
 *     envío para un profesional o si la fila no lo trae. Cambia lo que pone
 *     Hour (pie, baja, `{nombre}` de un equipo, fecha, `lang` del HTML); el
 *     asunto y el cuerpo los escribe quien envía y no se traducen.
 *   · Cabeceras de baja de RFC 8058.
 * Al historial de la conversación va el cuerpo con los campos y la firma, sin
 * el pie: el enlace de baja es de la sala, no del equipo.
 *
 * El texto plano es el correo. El HTML lleva el mismo texto vestido por la
 * plantilla del espacio (logo, imagen del espectáculo; `mail-template.ts`,
 * ADR-172), que es una pieza aparte: aquí solo se le pasan las piezas.
 */

import { proposedSignature, withSignature, displayWebsite } from './mail';
import { mailHtml, NO_TEMPLATE, type MailEvent, type MailFooter, type MailTemplate } from './mail-template';

export const MAILOUT_LANGUAGES = ['es', 'ca', 'en', 'fr'] as const;
type MailoutLanguage = (typeof MAILOUT_LANGUAGES)[number];

export const MERGE_FIELDS = ['nombre', 'sala', 'ciudad', 'obra', 'fecha', 'fecha_completa', 'hora'] as const;
type MergeField = (typeof MERGE_FIELDS)[number];

/** Los campos que la pantalla ofrece: `{fecha}`, `{fecha_completa}` y `{hora}` son de la función de una invitación. */
export function mergeFieldsFor(kind: 'outreach' | 'invitation'): readonly MergeField[] {
  return kind === 'invitation' ? MERGE_FIELDS : MERGE_FIELDS.filter((f) => f !== 'fecha' && f !== 'fecha_completa' && f !== 'hora');
}

export type MailBasisKind = 'consent' | 'relationship' | 'generic' | 'sector';

/** Lo que devuelven `mailout_compose_preview` y `mailout_send_context`. */
export interface ComposeContext {
  recipient_id: string;
  address_kind: 'contact' | 'organization' | 'subscriber' | null;
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
  mailout_kind: 'outreach' | 'invitation';
  /** Puesta: el destinatario es una persona del público, no una conversación. */
  audience_subscription_id: string | null;
  audience_name: string | null;
  subscriber_name: string | null;
  /** Cuándo confirmó (o entró importada): la fecha del pie del público. */
  subscribed_at: string | null;
  /** La función de la invitación: `{sala}` y `{ciudad}`. */
  venue_name: string | null;
  venue_city: string | null;
  /**
   * El idioma de la suscripción (104); null para un profesional. Opcional:
   * una base sin la migración 20261103100000 no lo trae y se cae al del envío.
   */
  subscriber_language?: string | null;
  /**
   * 102: la obra (`{obra}`), el día de la función (`YYYY-MM-DD`, `{fecha}`), su
   * franja de inicio (`{hora}`) y el reloj en que se lee (la sala, si no el
   * espacio). Opcionales: una base sin la migración 20261104140000 no los trae
   * y esos campos faltan (el correo que los use no sale).
   */
  project_name?: string | null;
  performed_at?: string | null;
  performance_start_at?: string | null;
  performance_timezone?: string | null;
}

/** Una persona del público, no una conversación (ADR-173 § 10). */
export function isAudienceRecipient(ctx: Pick<ComposeContext, 'audience_subscription_id'>): boolean {
  return ctx.audience_subscription_id !== null;
}

interface MailoutDraft {
  subject: string;
  body: string;
  language: string;
}

interface ComposedMail {
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
  sector: string;
  unsubscribe: (company: string, url: string) => string;
  /** El público (plan § 6.2): por qué le llega y su baja, de tú. */
  audienceConsent: (list: string, company: string, date: string | null) => string;
  audienceRelationship: (company: string) => string;
  audienceUnsubscribe: (url: string) => string;
  privacy: (url: string) => string;
  test: string;
  /** El pie en HTML (ADR-180): la baja y la privacidad como enlaces con palabras. */
  unsubscribeLink: string;
  audienceUnsubscribeLink: string;
  unsubscribeTail: string;
  privacyLink: string;
  /** El bloque de la función de una invitación (ADR-180), en el idioma del texto. */
  when: string;
  where: string;
  rsvp: string;
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
    sector: 'Os escribimos porque trabajáis en programación o difusión de artes en vivo.',
    unsubscribe: (c, u) => `Si no queréis recibir más envíos de ${c}, daos de baja aquí: ${u} Un clic basta.`,
    audienceConsent: (l, c, d) => `Te llega porque te apuntaste a «${l}» de ${c}${d ? ` el ${d}` : ''}.`,
    audienceRelationship: (c) => `Te llega porque has sido cliente de ${c}.`,
    audienceUnsubscribe: (u) => `Darte de baja: ${u} Un clic basta.`,
    privacy: (u) => `Política de privacidad: ${u}`,
    test: '[Prueba]',
    unsubscribeLink: 'Daros de baja',
    audienceUnsubscribeLink: 'Darte de baja',
    unsubscribeTail: ' en un clic',
    privacyLink: 'Privacidad',
    when: 'Cuándo',
    where: 'Dónde',
    rsvp: 'Se confirma respondiendo a este correo.',
  },
  ca: {
    team: (s) => (s ? `equip de ${s}` : 'equip'),
    consent: 'Us escrivim perquè ens vau demanar rebre les nostres propostes.',
    relationship: 'Us escrivim perquè ja hem treballat junts.',
    generic: (s) =>
      s
        ? `Us escrivim perquè és l'adreça de programació de ${s}.`
        : 'Us escrivim perquè és la vostra adreça pública de programació.',
    sector: "Us escrivim perquè treballeu en programació o difusió d'arts en viu.",
    unsubscribe: (c, u) =>
      `Si no voleu rebre més enviaments de ${c}, doneu-vos de baixa aquí: ${u} N'hi ha prou amb un clic.`,
    audienceConsent: (l, c, d) => `Et arriba perquè et vas apuntar a «${l}» de ${c}${d ? ` el ${d}` : ''}.`,
    audienceRelationship: (c) => `Et arriba perquè has estat client de ${c}.`,
    audienceUnsubscribe: (u) => `Donar-te de baixa: ${u} N'hi ha prou amb un clic.`,
    privacy: (u) => `Política de privacitat: ${u}`,
    test: '[Prova]',
    unsubscribeLink: 'Doneu-vos de baixa',
    audienceUnsubscribeLink: 'Donar-te de baixa',
    unsubscribeTail: ' amb un clic',
    privacyLink: 'Privacitat',
    when: 'Quan',
    where: 'On',
    rsvp: 'Es confirma responent aquest correu.',
  },
  en: {
    team: (s) => (s ? `${s} team` : 'team'),
    consent: 'We are writing because you asked to receive our proposals.',
    relationship: 'We are writing because we have worked together before.',
    generic: (s) =>
      s
        ? `We are writing because this is the programming address of ${s}.`
        : 'We are writing because this is your public programming address.',
    sector: 'We are writing because you work in programming or promoting live performing arts.',
    unsubscribe: (c, u) =>
      `If you would rather not receive more mailouts from ${c}, unsubscribe here: ${u} One click is enough.`,
    audienceConsent: (l, c, d) => `You're getting this because you signed up to "${l}" from ${c}${d ? ` on ${d}` : ''}.`,
    audienceRelationship: (c) => `You're getting this because you have been a customer of ${c}.`,
    audienceUnsubscribe: (u) => `Unsubscribe: ${u} One click is enough.`,
    privacy: (u) => `Privacy policy: ${u}`,
    test: '[Test]',
    unsubscribeLink: 'Unsubscribe',
    audienceUnsubscribeLink: 'Unsubscribe',
    unsubscribeTail: ' in one click',
    privacyLink: 'Privacy',
    when: 'When',
    where: 'Where',
    rsvp: 'Reply to this email to confirm.',
  },
  fr: {
    team: (s) => (s ? `l'équipe de ${s}` : "l'équipe"),
    consent: 'Nous vous écrivons parce que vous nous avez demandé de recevoir nos propositions.',
    relationship: 'Nous vous écrivons parce que nous avons déjà travaillé ensemble.',
    generic: (s) =>
      s
        ? `Nous vous écrivons parce que c'est l'adresse de programmation de ${s}.`
        : "Nous vous écrivons parce que c'est votre adresse publique de programmation.",
    sector: "Nous vous écrivons parce que vous travaillez dans la programmation ou la diffusion du spectacle vivant.",
    unsubscribe: (c, u) =>
      `Si vous ne souhaitez plus recevoir d'envois de ${c}, désinscrivez-vous ici : ${u} Un clic suffit.`,
    audienceConsent: (l, c, d) =>
      `Vous recevez ce message car vous vous êtes inscrit à « ${l} » de ${c}${d ? ` le ${d}` : ''}.`,
    audienceRelationship: (c) => `Vous recevez ce message car vous avez été client de ${c}.`,
    audienceUnsubscribe: (u) => `Se désinscrire : ${u} Un clic suffit.`,
    privacy: (u) => `Politique de confidentialité : ${u}`,
    test: '[Test]',
    unsubscribeLink: 'Se désinscrire',
    audienceUnsubscribeLink: 'Se désinscrire',
    unsubscribeTail: ' en un clic',
    privacyLink: 'Confidentialité',
    when: 'Quand',
    where: 'Où',
    rsvp: 'Confirmez en répondant à ce message.',
  },
};

export function mailoutLanguage(raw: string | null | undefined): MailoutLanguage {
  return (MAILOUT_LANGUAGES as readonly string[]).includes(raw ?? '') ? (raw as MailoutLanguage) : 'es';
}

/**
 * El idioma en que sale el correo de un destinatario (104): el de su
 * suscripción si es del público y es uno de los cuatro; si no, el del envío.
 */
export function recipientLanguage(
  mailoutLang: string | null | undefined,
  ctx: Pick<ComposeContext, 'audience_subscription_id' | 'subscriber_language'>,
): MailoutLanguage {
  const own = isAudienceRecipient(ctx) ? ctx.subscriber_language : null;
  return (MAILOUT_LANGUAGES as readonly string[]).includes(own ?? '') ? (own as MailoutLanguage) : mailoutLanguage(mailoutLang);
}

const FIELD_RE = /\{(nombre|sala|ciudad|obra|fecha_completa|fecha|hora)\}/g;

/** Los campos que usa un texto, sin repetir, en el orden de MERGE_FIELDS. */
export function fieldsUsed(...texts: string[]): MergeField[] {
  const found = new Set<string>();
  for (const text of texts) for (const m of text.matchAll(FIELD_RE)) found.add(m[1]);
  return MERGE_FIELDS.filter((f) => found.has(f));
}

/** El nombre de pila de quien se apuntó, si lo dio. */
function subscriberFirstName(name: string | null): string | null {
  return name?.trim().split(/\s+/)[0] || null;
}

/** El valor de cada campo para un destinatario; null si no lo tiene. */
function mergeValues(ctx: ComposeContext, language: MailoutLanguage): Record<MergeField, string | null> {
  const org = ctx.organization_name?.trim() || null;
  const nombre = isAudienceRecipient(ctx)
    ? subscriberFirstName(ctx.subscriber_name)
    : ctx.address_kind === 'organization'
      ? org
        ? COPY[language].team(org)
        : null
      : ctx.contact_first_name?.trim() || null;
  const show = {
    obra: ctx.project_name?.trim() || null,
    fecha: performanceDate(ctx.performed_at ?? null, language),
    fecha_completa: performanceDate(ctx.performed_at ?? null, language, true),
    hora: performanceTime(ctx.performance_start_at ?? null, ctx.performance_timezone ?? null, language),
  };
  if (ctx.mailout_kind === 'invitation') {
    return { nombre, sala: ctx.venue_name?.trim() || null, ciudad: ctx.venue_city?.trim() || null, ...show };
  }
  return { nombre, sala: org, ciudad: ctx.city?.trim() || null, ...show };
}

/**
 * Sin nombre, una persona del público recibe el saludo sin él («Hola, {nombre}:»
 * → «Hola:»): quien se apunta no siempre lo da (plan § 6.1).
 */
function dropName(text: string): string {
  return text
    .replace(/,[ \t]*\{nombre\}[ \t]*,[ \t]*/g, ' ')
    .replace(/^\{nombre\}[ \t]*,?[ \t]*/gm, '')
    .replace(/,?[ \t]*\{nombre\}/g, '');
}

function fillFields(text: string, values: Record<MergeField, string | null>, nameless: boolean): string {
  return (nameless ? dropName(text) : text).replace(FIELD_RE, (whole, f: MergeField) => values[f] ?? whole);
}

const DATE_LOCALE: Record<MailoutLanguage, string> = { es: 'es-ES', ca: 'ca-ES', en: 'en-GB', fr: 'fr-FR' };

/** «3 de noviembre de 2026», en el idioma del correo y la hora de la compañía. */
function footerDate(iso: string | null, language: MailoutLanguage): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(DATE_LOCALE[language], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Madrid',
  }).format(d);
}

/**
 * `{fecha}`: «sábado, 14 de noviembre», en el idioma del correo; `{fecha_completa}`
 * le añade el año, para lo que no es de las próximas semanas (Marco, 2026-11-05).
 * Es un día del calendario (`performance.performed_at`), no un instante: no se
 * mueve de zona.
 */
export function performanceDate(day: string | null, language: MailoutLanguage, withYear = false): string | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(DATE_LOCALE[language], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  }).format(d);
}

/** `{hora}`: «20:30», la hora de inicio en el reloj de la sala (o del espacio). */
export function performanceTime(at: string | null, timeZone: string | null, language: MailoutLanguage): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const format = (zone: string) =>
    new Intl.DateTimeFormat(DATE_LOCALE[language], {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: zone,
    }).format(d);
  try {
    return format(timeZone?.trim() || 'Europe/Madrid');
  } catch {
    // Una zona que el motor no conoce: la de la compañía por defecto, como el pie.
    return format('Europe/Madrid');
  }
}

/** La firma de la compañía: la guardada, o la que propone Hour. */
function companySignature(ctx: ComposeContext): string {
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

/**
 * La base que la pantalla propone al apuntar la de una dirección. Nunca `sector`:
 * esa la declara quien envía y Hour no la propone (ADR-174).
 */
export function suggestedBasis(addressKind: 'contact' | 'organization' | null): MailBasisKind {
  return addressKind === 'organization' ? 'generic' : 'relationship';
}

/**
 * Quién escribe, en el pie, sólo si la firma no lo dice ya (ADR-180): la firma
 * de la compañía lleva su nombre, y repetirlo debajo eran tres líneas de lo
 * mismo. Una firma guardada sin el nombre lo devuelve al pie.
 */
function footerWho(ctx: ComposeContext): string | null {
  const company = ctx.company_name.trim();
  if (company && companySignature(ctx).toLowerCase().includes(company.toLowerCase())) return null;
  return [ctx.company_name, ctx.company_city, displayWebsite(ctx.company_website)].filter(Boolean).join(' · ') || null;
}

/** Por qué le llega: la frase del pie según su base y su origen. */
function footerWhy(ctx: ComposeContext, language: MailoutLanguage): string | null {
  const copy = COPY[language];
  if (isAudienceRecipient(ctx)) {
    return ctx.basis_kind === 'relationship'
      ? copy.audienceRelationship(ctx.company_name)
      : copy.audienceConsent(ctx.audience_name ?? '', ctx.company_name, footerDate(ctx.subscribed_at, language));
  }
  const sala = ctx.organization_name?.trim() || null;
  return ctx.basis_kind === 'consent'
    ? copy.consent
    : ctx.basis_kind === 'relationship'
      ? copy.relationship
      : ctx.basis_kind === 'generic'
        ? copy.generic(sala)
        : ctx.basis_kind === 'sector'
          ? copy.sector
          : null;
}

/**
 * El pie en HTML (ADR-180): quién (si la firma no lo dice) y por qué le llega,
 * y en una línea «Darse de baja en un clic · Privacidad», con palabras en el
 * enlace. El texto plano sigue llevando la URL: allí no hay enlaces.
 */
export function footerHtml(ctx: ComposeContext, language: MailoutLanguage, unsubscribeUrl: string): MailFooter {
  const copy = COPY[language];
  const why = [footerWho(ctx), footerWhy(ctx, language)].filter((l): l is string => Boolean(l));
  const links: MailFooter['links'] = [
    {
      label: isAudienceRecipient(ctx) ? copy.audienceUnsubscribeLink : copy.unsubscribeLink,
      url: unsubscribeUrl,
      tail: copy.unsubscribeTail,
    },
  ];
  if (ctx.privacy_url) links.push({ label: copy.privacyLink, url: ctx.privacy_url });
  return { why, links };
}

/**
 * La función de una invitación (ADR-180), montada de los datos y en el idioma
 * del texto: la obra, cuándo, dónde y cómo confirmar. Sin día, no hay bloque.
 */
export function invitationEvent(ctx: ComposeContext, language: MailoutLanguage): MailEvent | null {
  if (ctx.mailout_kind !== 'invitation') return null;
  const copy = COPY[language];
  const day = performanceDate(ctx.performed_at ?? null, language, true);
  if (!day) return null;
  const time = performanceTime(ctx.performance_start_at ?? null, ctx.performance_timezone ?? null, language);
  const place = [ctx.venue_name?.trim(), ctx.venue_city?.trim()].filter(Boolean).join(', ');
  const rows = [{ label: copy.when, value: time ? `${day}, ${time}` : day }];
  if (place) rows.push({ label: copy.where, value: place });
  return { title: ctx.project_name?.trim() || null, rows, note: copy.rsvp };
}

/** El bloque de la función en texto plano: lo mismo, en líneas. */
function eventText(ev: MailEvent): string {
  return [ev.title, ...ev.rows.map((r) => `${r.label}: ${r.value}`), ev.note].filter(Boolean).join('\n');
}

/** Lo que la bandeja enseña antes de abrir: la primera frase tras el saludo, corta. */
export function preheaderOf(body: string): string | null {
  const paras = body.trim().split(/\n{2,}/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const first = paras[0] && /:$/.test(paras[0]) && paras[0].length < 60 ? paras[1] : paras[0];
  if (!first) return null;
  return first.length > 110 ? `${first.slice(0, 109).trimEnd()}…` : first;
}

/** El pie: quién escribe, por qué le llega, la baja y la privacidad. */
export function footerLines(ctx: ComposeContext, language: MailoutLanguage, unsubscribeUrl: string): string[] {
  const copy = COPY[language];
  const who = footerWho(ctx);
  const why = footerWhy(ctx, language);
  return [
    who,
    why,
    isAudienceRecipient(ctx) ? copy.audienceUnsubscribe(unsubscribeUrl) : copy.unsubscribe(ctx.company_name, unsubscribeUrl),
    ctx.privacy_url ? copy.privacy(ctx.privacy_url) : null,
  ].filter((l): l is string => Boolean(l));
}

export function composeMailout(
  draft: MailoutDraft,
  ctx: ComposeContext,
  unsubscribeUrl: string,
  template: MailTemplate = NO_TEMPLATE,
): ComposedMail {
  // Two languages (ADR-180): what sits inside the text (its fields, the
  // invitation's block) speaks the text's; the footer, the recipient's (104).
  const language = recipientLanguage(draft.language, ctx);
  const textLanguage = mailoutLanguage(draft.language);
  const values = mergeValues(ctx, textLanguage);
  // Al público sin nombre se le saluda sin él: no bloquea.
  const nameless = isAudienceRecipient(ctx) && values.nombre === null;
  const missing = fieldsUsed(draft.subject, draft.body).filter((f) => values[f] === null && !(nameless && f === 'nombre'));
  const subject = fillFields(draft.subject.trim(), values, nameless);
  const body = fillFields(draft.body.trim(), values, nameless);
  const signature = companySignature(ctx);
  const footer = footerLines(ctx, language, unsubscribeUrl);
  const event = invitationEvent(ctx, textLanguage);
  const recordBody = withSignature(event ? `${body}\n\n${eventText(event)}` : body, signature);
  const text = `${recordBody}\n\n${footer.join('\n')}\n`;
  const html = mailHtml(
    {
      language: textLanguage,
      subject,
      body,
      signature,
      footer,
      event,
      footerHtml: footerHtml(ctx, language, unsubscribeUrl),
      preheader: preheaderOf(body),
    },
    template,
  );
  return { subject, text, html, recordBody, missing };
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
