/**
 * /u/<token>: la baja de los envíos de una compañía (plan § 7.1, RFC 8058).
 *
 *   · GET: la página, con un botón «Darme de baja». El GET no da de baja:
 *     los escáneres de enlaces de los servidores de correo abren los enlaces
 *     antes que la persona.
 *   · POST (acción por defecto): da de baja. Es también lo que manda Gmail o
 *     Yahoo por `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, sin
 *     cookies, sin JavaScript y sin cabecera Origin (por eso
 *     `csrf.checkOrigin` está apagado en svelte.config.js: el token es el
 *     secreto, y hooks.server.ts sigue cortando cualquier Origin ajeno).
 *   · POST ?/resubscribe: «¿Ha sido un error? Volver a recibirlos».
 * Sin sesión: las RPC por token corren como anon. Un token que no existe no
 * hace nada y la página no lo distingue de uno caducado. En el idioma del
 * envío, no en el del navegador.
 */

import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { allowRequest, clientIp } from '$lib/server/rate-limit';
import { detectLocale, type Locale } from '$lib/i18n';

/** 24 bytes en hexadecimal (`mailout_recipient.unsubscribe_token`). */
const TOKEN_RE = /^[0-9a-f]{48}$/;
const RULE = { limit: 30, windowSec: 300 };

interface Info {
  company_name: string;
  language: string;
  unsubscribed: boolean;
}

function pageLocale(info: Info | null, request: Request): Locale {
  return detectLocale(info?.language ?? request.headers.get('accept-language'));
}

async function readInfo(env: SupabaseEnv | undefined, token: string): Promise<Info | null> {
  if (!env || !TOKEN_RE.test(token)) return null;
  const r = await pgPostRpc<Info>(env, 'mailout_unsubscribe_info', null, { p_token: token });
  return r.data[0] ?? null;
}

export const load: PageServerLoad = async ({ params, platform, request }) => {
  const info = await readInfo(platform?.env as SupabaseEnv | undefined, params.token);
  return {
    found: info !== null,
    company: info?.company_name ?? null,
    unsubscribed: info?.unsubscribed ?? false,
    locale: pageLocale(info, request),
  };
};

async function act(
  rpc: 'mailout_unsubscribe' | 'mailout_resubscribe',
  { params, platform, request }: Parameters<Actions[string]>[0],
) {
  const env = platform?.env as (SupabaseEnv & { RATE_LIMIT?: KVNamespace }) | undefined;
  if (!env) return fail(500, { error: 'unavailable' });
  if (!(await allowRequest(env.RATE_LIMIT, `unsub:${clientIp(request)}`, RULE))) return fail(429, { error: 'busy' });
  if (TOKEN_RE.test(params.token)) await pgPostRpc(env, rpc, null, { p_token: params.token });
  return { done: rpc === 'mailout_unsubscribe' ? 'unsubscribed' : 'resubscribed' };
}

export const actions: Actions = {
  default: (event) => act('mailout_unsubscribe', event),
  resubscribe: (event) => act('mailout_resubscribe', event),
};
