/**
 * /c/<token>: la confirmación de un alta del público (plan
 * 2026-11-01-audience § 3.3).
 *
 *   · GET: la página, con el botón «Sí, quiero recibirlas». El GET no
 *     confirma: los escáneres de enlaces abren los enlaces antes que la
 *     persona (como /u/<token>).
 *   · POST: confirma con la IP y el agente, que pone el Worker
 *     (`audience_confirm`, de máquina). Idempotente.
 * Sin sesión. Un token que no existe se pinta como uno caducado. En el idioma
 * de la suscripción.
 */

import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { detectLocale } from '$lib/i18n';
import { CONFIRM_TOKEN_RE, confirmSubscription, type SignupEnv } from '$lib/server/mailout/audience';

interface Info {
  company_name: string;
  audience_name: string;
  language: string;
  valid: boolean;
  confirmed: boolean;
}

async function readInfo(env: SupabaseEnv | undefined, token: string): Promise<Info | null> {
  if (!env || !CONFIRM_TOKEN_RE.test(token)) return null;
  const r = await pgPostRpc<Info>(env, 'audience_confirm_info', null, { p_token: token });
  return r.data[0] ?? null;
}

export const load: PageServerLoad = async ({ params, platform, request }) => {
  const info = await readInfo(platform?.env as SupabaseEnv | undefined, params.token);
  return {
    valid: info?.valid === true,
    confirmed: info?.confirmed === true,
    company: info?.company_name ?? '',
    list: info?.audience_name ?? '',
    locale: detectLocale(info?.language ?? request.headers.get('accept-language')),
  };
};

export const actions: Actions = {
  default: async ({ params, platform, request }) => {
    const env = platform?.env as SignupEnv | undefined;
    if (!env) return fail(500, { error: 'unavailable' as const });
    try {
      const done = await confirmSubscription(
        env,
        params.token,
        request.headers.get('cf-connecting-ip'),
        request.headers.get('user-agent'),
      );
      if (done === 'busy') return fail(429, { error: 'busy' as const });
      return done ? { confirmed: true as const } : fail(410, { error: 'expired' as const });
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'audience_confirm_failed',
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      return fail(500, { error: 'unavailable' as const });
    }
  },
};
