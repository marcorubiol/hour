/**
 * El alta pública del público (punto 98, fase 2; plan 2026-11-01-audience
 * § 3.2 y § 3.3, ADR-173): lo que hace el Worker con un formulario enviado y
 * con un enlace de confirmación.
 *
 *   · `signup`: comprueba el formulario, el campo trampa y el limitador por
 *     IP, llama a `audience_subscribe` con la IP y el agente que pone el
 *     Worker (por eso es de máquina, no anon) y, si hay token, manda el
 *     correo de confirmación sin cola. La respuesta a la persona es siempre
 *     la misma: no revela si la dirección ya estaba.
 *   · `sendConfirmation`: el correo, por el adaptador y con la identidad del
 *     público (`audience_confirmation_context`), vestido con la plantilla del
 *     97 (ADR-172). Sin dominio del público verificado no sale nada.
 *   · `confirmSubscription`: el POST de /c/<token>.
 * El cron diario de purga está en worker-cron.ts (lo empaqueta wrangler).
 *
 * Frontera (ADR-110, ampliada por ADR-173 § 4): la clave de servicio solo por
 * `serviceRpc`.
 */

import type { MailSendingProvider } from '$lib/mailout';
import { mailHtml, mailTemplate } from '$lib/mail-template';
import { detectLocale, t, type Locale } from '$lib/i18n';
import { allowRequest } from '$lib/server/rate-limit';
import { mailoutLinkOrigin, sendingProvider, type MailoutEnv } from './index';
import { serviceRpc } from './db';
import type { SendingProvider, SentEmail } from './provider';

/** `audience.form_key`: 16 bytes en hexadecimal. */
export const FORM_KEY_RE = /^[0-9a-f]{32}$/;
/** El token de confirmación: 32 bytes en hexadecimal (solo su hash está en la base). */
export const CONFIRM_TOKEN_RE = /^[0-9a-f]{64}$/;
/** Mismo formato que la base (`audience_subscription_address_format`). */
const ADDRESS_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Altas por IP: de sobra para una familia detrás de un router, poco para un script. */
export const SIGNUP_RULE = { limit: 10, windowSec: 600 };
/** Confirmaciones por IP: un escáner de enlaces no llega, un script sí. */
export const CONFIRM_RULE = { limit: 30, windowSec: 600 };

/**
 * La clave del limitador para una IP: una IPv4 tal cual; una IPv6, su /64,
 * que es lo que suele tener una sola conexión (cambiar de dirección dentro de
 * él no da otra cuota).
 */
export function ipBucket(ip: string | null): string {
  if (!ip) return 'unknown';
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(Math.max(8 - left.length - right.length, 0)).fill('0'), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/** El campo trampa: oculto para una persona, lo rellena un robot. */
export const HONEYPOT_FIELD = 'website';

export type SignupChannel = 'form' | 'embed';

export interface SignupInput {
  key: string;
  email: string;
  name: string;
  language: string;
  textId: string | null;
  consent: boolean;
  age: boolean;
  honeypot: string;
  channel: SignupChannel;
  ip: string | null;
  userAgent: string | null;
  pageUrl: string | null;
}

export type SignupResult = { ok: true } | { ok: false; error: 'email' | 'consent' | 'age' | 'busy' };

export interface SignupEnv extends MailoutEnv {
  RATE_LIMIT?: KVNamespace;
}

/** Lo que devuelve `audience_confirmation_context`. */
export interface ConfirmationContext {
  address: string;
  name: string | null;
  language: string;
  audience_name: string;
  company_name: string;
  logo_url: string | null;
  form_key: string;
  provider: MailSendingProvider | null;
  from_address: string | null;
  from_name: string | null;
  tenant_name: string | null;
  configuration_set: string | null;
}

export function confirmUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/c/${token}`;
}

export function formUrl(origin: string, key: string): string {
  return `${origin.replace(/\/$/, '')}/public/audience/${key}`;
}

/** El correo de confirmación en el idioma de la suscripción (§ 6.2). */
export function composeConfirmation(ctx: ConfirmationContext, link: string, origin: string) {
  const locale: Locale = detectLocale(ctx.language);
  const vars = { company: ctx.company_name, list: ctx.audience_name, link };
  const subject = t('audience.confirm_subject', locale, vars);
  const text = t('audience.confirm_body', locale, vars);
  const template = mailTemplate(
    { company_name: ctx.company_name, logo_url: ctx.logo_url, image_url: null, image_alt: null, image_link_url: null },
    origin,
  );
  const html = mailHtml({ language: locale, subject, body: text, signature: '', footer: [] }, template);
  return { subject, text, html };
}

/**
 * Manda el correo de confirmación de una suscripción con su token. Apunta el
 * id del proveedor (para casar un rebote o una queja) y, con el simulador, los
 * eventos que daría el servicio. false si no salió (sin ruta de entrega); si
 * no salió, o el proveedor no lo aceptó, el cupo de la persona vuelve
 * (`audience_confirmation_failed`).
 */
export async function sendConfirmation(
  env: Partial<MailoutEnv>,
  subscriptionId: string,
  token: string,
  opts: { fetchFn?: typeof fetch; providerFor?: (kind: MailSendingProvider) => SendingProvider } = {},
): Promise<boolean> {
  const fetchFn = opts.fetchFn ?? fetch;
  const rows = await serviceRpc<ConfirmationContext[]>(
    env,
    'audience_confirmation_context',
    { p_subscription_id: subscriptionId },
    fetchFn,
  );
  const ctx = rows?.[0];
  // Sin ruta (sin dominio del público verificado, o un espacio solo-simulador
  // y una dirección real): no sale nada y el cupo vuelve. audience_subscribe
  // ya no da token en ese caso; esto cubre un dominio quitado entre medias.
  const giveBack = () =>
    serviceRpc(env, 'audience_confirmation_failed', { p_subscription_id: subscriptionId }, fetchFn);
  if (!ctx?.provider || !ctx.from_address) {
    console.warn(JSON.stringify({ level: 'warn', kind: 'audience_confirmation_no_route', subscription: subscriptionId }));
    await giveBack();
    return false;
  }
  const origin = mailoutLinkOrigin(env);
  const mail = composeConfirmation(ctx, confirmUrl(origin, token), origin);
  const provider = (opts.providerFor ?? ((k: MailSendingProvider) => sendingProvider(k, env)))(ctx.provider);
  let sent: SentEmail;
  try {
    sent = await provider.sendEmail({
      from: ctx.from_address,
      fromName: ctx.from_name,
      to: ctx.address,
      toName: ctx.name,
      replyTo: null,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      headers: {},
      tenantName: ctx.tenant_name,
      configurationSet: ctx.configuration_set,
      tags: { subscription: subscriptionId },
    });
  } catch (err) {
    // El proveedor no lo aceptó: la persona puede volver a pedirlo ya.
    await giveBack().catch(() => undefined);
    throw err;
  }
  await serviceRpc(
    env,
    'audience_confirmation_sent',
    { p_subscription_id: subscriptionId, p_provider_message_id: sent.providerMessageId },
    fetchFn,
  );
  for (const e of sent.events) {
    await serviceRpc(
      env,
      'mailout_record_event',
      {
        p_payload: {
          provider_event_id: `${sent.providerMessageId}:${e.type}`,
          provider_message_id: sent.providerMessageId,
          type: e.type,
          bounce_type: e.bounceType ?? null,
          detail: { simulated: true },
        },
      },
      fetchFn,
    );
  }
  return true;
}

/** Lo que el formulario manda, sin tocar la base. */
export function checkSignup(input: SignupInput): SignupResult | null {
  const email = input.email.trim();
  if (!ADDRESS_RE.test(email) || email.length > 254) return { ok: false, error: 'email' };
  if (!input.consent) return { ok: false, error: 'consent' };
  if (!input.age) return { ok: false, error: 'age' };
  return null;
}

/**
 * Un alta del formulario. `defer` es `ctx.waitUntil`: el correo sale sin hacer
 * esperar la respuesta. Una clave desconocida, una lista cerrada, una
 * dirección ya confirmada o pasada de límites dan la misma respuesta que un
 * alta nueva, y el campo trampa también: un robot no aprende nada.
 */
export async function signup(
  env: SignupEnv,
  input: SignupInput,
  defer: (p: Promise<unknown>) => void,
  fetchFn: typeof fetch = fetch,
  providerFor?: (kind: MailSendingProvider) => SendingProvider,
): Promise<SignupResult> {
  const invalid = checkSignup(input);
  if (invalid) return invalid;
  if (input.honeypot.trim() || !FORM_KEY_RE.test(input.key)) return { ok: true };
  if (!(await allowRequest(env.RATE_LIMIT, `aud-signup:${ipBucket(input.ip)}`, SIGNUP_RULE))) {
    return { ok: false, error: 'busy' };
  }
  const rows = await serviceRpc<{ subscription_id: string | null; token: string | null }[]>(
    env,
    'audience_subscribe',
    {
      p_key: input.key,
      p_address: input.email.trim(),
      p_name: input.name.trim() || null,
      p_language: input.language,
      p_text_id: input.textId,
      p_age_confirmed: true,
      p_ip: input.ip,
      p_user_agent: input.userAgent,
      p_channel: input.channel,
      p_page_url: input.pageUrl,
    },
    fetchFn,
  );
  const row = rows?.[0];
  if (row?.subscription_id && row.token) {
    const id = row.subscription_id;
    defer(
      sendConfirmation(env, id, row.token, { fetchFn, providerFor }).catch((err: unknown) => {
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'audience_confirmation_failed',
            subscription: id,
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }),
    );
  }
  return { ok: true };
}

/** El POST de /c/<token>: true si queda confirmada (o ya lo estaba). */
export async function confirmSubscription(
  env: SignupEnv,
  token: string,
  ip: string | null,
  userAgent: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<boolean | 'busy'> {
  if (!CONFIRM_TOKEN_RE.test(token)) return false;
  if (!(await allowRequest(env.RATE_LIMIT, `aud-confirm:${ipBucket(ip)}`, CONFIRM_RULE))) return 'busy';
  const ok = await serviceRpc<boolean>(
    env,
    'audience_confirm',
    { p_token: token, p_ip: ip, p_user_agent: userAgent },
    fetchFn,
  );
  return ok === true;
}

