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
 *   · POST con `undo=1`: «¿Ha sido un error? Volver a recibirlos». Una sola
 *     acción (SvelteKit no deja una por defecto junto a otras con nombre); el
 *     POST de Gmail lleva `List-Unsubscribe=One-Click` y nunca `undo`.
 *   · POST con `everything=1`: «No recibir nada más de {compañía}», solo en la
 *     rama del público (`mailout_unsubscribe_everything`).
 * Rama del público (plan 2026-11-01-audience § 3.5): la baja es de la lista,
 * no del espacio; «volver a apuntarme» es un consentimiento nuevo y va por la
 * RPC de máquina `audience_resubscribe`, con la IP y el agente que pone el
 * Worker. Un profesional, como siempre.
 * Sin sesión: las RPC por token corren como anon. Un token que no existe no
 * hace nada y la página no lo distingue de uno caducado. En el idioma del
 * envío, no en el del navegador.
 */

import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { allowRequest, clientIp } from '$lib/server/rate-limit';
import { detectLocale, type Locale } from '$lib/i18n';
import { serviceRpc } from '$lib/server/mailout/db';
import type { MailoutEnv } from '$lib/server/mailout';

/** 24 bytes en hexadecimal (`mailout_recipient.unsubscribe_token`). */
const TOKEN_RE = /^[0-9a-f]{48}$/;
const RULE = { limit: 30, windowSec: 300 };

interface Info {
  company_name: string;
  language: string;
  unsubscribed: boolean;
  /** La lista, si el destinatario es del público. */
  audience_name: string | null;
  /** Excluida de todo el espacio. */
  suppressed: boolean;
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
    list: info?.audience_name ?? null,
    suppressed: info?.suppressed ?? false,
    locale: pageLocale(info, request),
  };
};

type Done = 'unsubscribed' | 'resubscribed' | 'everything' | 'not_resubscribed';

async function act(asked: Done, { params, platform, request }: Parameters<Actions[string]>[0]) {
  const env = platform?.env as (SupabaseEnv & MailoutEnv & { RATE_LIMIT?: KVNamespace }) | undefined;
  if (!env) return fail(500, { error: 'unavailable' });
  if (!(await allowRequest(env.RATE_LIMIT, `unsub:${clientIp(request)}`, RULE))) return fail(429, { error: 'busy' });
  if (!TOKEN_RE.test(params.token)) return { done: asked, suppressed: false };
  const p_token = params.token;
  try {
    let done = asked;
    if (asked === 'unsubscribed') await pgPostRpc(env, 'mailout_unsubscribe', null, { p_token });
    else if (asked === 'everything') await pgPostRpc(env, 'mailout_unsubscribe_everything', null, { p_token });
    else if ((await readInfo(env, p_token))?.audience_name) {
      // Volver a la lista es un consentimiento nuevo, con IP y agente (de máquina).
      const ok = await serviceRpc<boolean>(env, 'audience_resubscribe', {
        p_token,
        p_ip: request.headers.get('cf-connecting-ip'),
        p_user_agent: request.headers.get('user-agent'),
      });
      if (ok !== true) done = 'not_resubscribed';
    } else await pgPostRpc(env, 'mailout_resubscribe', null, { p_token });
    // Tras volver, la dirección puede seguir excluida por otra baja (la de la difusión).
    const suppressed = done === 'resubscribed' ? ((await readInfo(env, p_token))?.suppressed ?? false) : false;
    return { done, suppressed };
  } catch (err) {
    console.error(
      JSON.stringify({ level: 'error', kind: 'unsubscribe_failed', message: err instanceof Error ? err.message : String(err) }),
    );
    return fail(500, { error: 'unavailable' });
  }
}

export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData().catch(() => null);
    const done: Done =
      form?.get('undo') === '1' ? 'resubscribed' : form?.get('everything') === '1' ? 'everything' : 'unsubscribed';
    return act(done, event);
  },
};
