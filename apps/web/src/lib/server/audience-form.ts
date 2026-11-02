/**
 * El formulario público de una lista (plan 2026-11-01-audience § 3.2), para
 * /public/audience/<clave> y su versión para iframe, /…/embed. Las dos rutas
 * son la misma página con otro canal: lo que cambia es la prueba (`form` o
 * `embed`) y, en el iframe, la página que lo enmarca (el Referer del GET, que
 * vuelve en un campo oculto: el POST lleva el Referer de Hour).
 *
 * Sin sesión. La lectura va por la RPC anon `audience_form_info`; el alta, por
 * la de máquina (`signup`, $lib/server/mailout/audience). Funciona sin
 * JavaScript: un <form> normal contra la acción por defecto.
 */

import { fail, type Actions, type ServerLoad } from '@sveltejs/kit';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { detectLocale, LOCALES, type Locale } from '$lib/i18n';
import { FORM_KEY_RE, HONEYPOT_FIELD, signup, type SignupChannel, type SignupEnv } from '$lib/server/mailout/audience';

interface FormInfo {
  company_name: string;
  logo_url: string | null;
  audience_name: string;
  description: string | null;
  language: string | null;
  languages: string[];
  consent_text_id: string | null;
  consent_text: string | null;
  info_text: string | null;
  privacy_url: string | null;
  open: boolean;
}

export interface AudienceFormData {
  key: string;
  channel: SignupChannel;
  found: boolean;
  open: boolean;
  locale: Locale;
  languages: Locale[];
  company: string;
  logoUrl: string | null;
  list: string;
  description: string | null;
  textId: string | null;
  consentText: string | null;
  infoText: string | null;
  privacyUrl: string | null;
  pageUrl: string | null;
}

/** El idioma pedido (`?lang=`), si no el del navegador. La lista decide si lo tiene. */
export function requestedLocale(url: URL, acceptLanguage: string | null): Locale {
  const lang = url.searchParams.get('lang');
  return LOCALES.includes(lang as Locale) ? (lang as Locale) : detectLocale(acceptLanguage);
}

/** Una URL de página para la prueba: http(s) y no más de 2.048 caracteres; si no, nada. */
export function pageUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  return /^https?:\/\//i.test(v) && v.length <= 2048 ? v : null;
}

function asLocales(values: string[] | null | undefined): Locale[] {
  return (values ?? []).filter((l): l is Locale => LOCALES.includes(l as Locale));
}

async function readInfo(env: SupabaseEnv | undefined, key: string, locale: Locale): Promise<FormInfo | null> {
  if (!env || !FORM_KEY_RE.test(key)) return null;
  const r = await pgPostRpc<FormInfo>(env, 'audience_form_info', null, { p_key: key, p_language: locale });
  return r.data[0] ?? null;
}

export function audienceFormLoad(channel: SignupChannel): ServerLoad<{ key: string }, Record<string, unknown>, AudienceFormData> {
  return async ({ params, platform, request, url }) => {
    const key = params.key;
    const asked = requestedLocale(url, request.headers.get('accept-language'));
    const info = await readInfo(platform?.env as SupabaseEnv | undefined, key, asked);
    const data: AudienceFormData = {
      key,
      channel,
      found: info !== null,
      open: info?.open === true && info.consent_text_id !== null,
      locale: info?.language ? detectLocale(info.language) : asked,
      languages: asLocales(info?.languages),
      company: info?.company_name ?? '',
      logoUrl: info?.logo_url ?? null,
      list: info?.audience_name ?? '',
      description: info?.description ?? null,
      textId: info?.consent_text_id ?? null,
      consentText: info?.consent_text ?? null,
      infoText: info?.info_text ?? null,
      privacyUrl: info?.privacy_url ?? null,
      pageUrl: channel === 'embed' ? pageUrl(request.headers.get('referer')) : null,
    };
    return data;
  };
}

export function audienceFormActions(channel: SignupChannel): Actions {
  return {
    default: async ({ params, platform, request }) => {
      const env = platform?.env as SignupEnv | undefined;
      if (!env) return fail(500, { error: 'unavailable' as const });
      const form = await request.formData().catch(() => null);
      const field = (name: string) => String(form?.get(name) ?? '');
      const email = field('email');
      const name = field('name');
      try {
        const result = await signup(
          env,
          {
            key: params.key ?? '',
            email,
            name,
            language: field('language'),
            textId: field('consent_text_id') || null,
            consent: form?.get('consent') === 'on',
            age: form?.get('age') === 'on',
            honeypot: field(HONEYPOT_FIELD),
            channel,
            ip: request.headers.get('cf-connecting-ip'),
            userAgent: request.headers.get('user-agent'),
            pageUrl: channel === 'embed' ? pageUrl(field('page_url')) : null,
          },
          (p) => platform?.ctx?.waitUntil(p),
        );
        if (!result.ok) return fail(result.error === 'busy' ? 429 : 400, { error: result.error, email, name });
        return { sent: true as const };
      } catch (err) {
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'audience_signup_failed',
            message: err instanceof Error ? err.message : String(err),
          }),
        );
        return fail(500, { error: 'unavailable' as const, email, name });
      }
    },
  };
}
