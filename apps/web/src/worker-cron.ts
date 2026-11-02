/**
 * El cron del Worker. Dos disparadores (wrangler.jsonc):
 *   · `*\/10 * * * *` (ADR-099): una pasada de sincronización de buzones y,
 *     aparte, otra comprobación del DNS de los dominios de envío pendientes
 *     (ADR-169); una no espera ni corta a la otra;
 *   · `* * * * *` (ADR-115): vaciar la cola del envío en bloque, nada más;
 *   · `17 3 * * *` (punto 98, plan del público § 3.3): borrar las altas sin
 *     confirmar de más de 30 días (`audience_purge_pending`).
 * El adaptador de SvelteKit no exporta `scheduled`, así que el despliegue usa
 * `worker-entry.js` como entrada: reexporta el `fetch` de SvelteKit y añade
 * este `scheduled`. Solo imports relativos: esto lo empaqueta wrangler, no
 * Vite.
 */

import { runMailSync } from './lib/server/mail/sync';
import { runMailoutQueue } from './lib/server/mailout/queue';
import { runDomainRecheck } from './lib/server/mailout/recheck';
import { serviceRpc } from './lib/server/mailout/db';
import type { MailEnv } from './lib/server/mail/db';
import type { MailoutEnv } from './lib/server/mailout';

export const MAILOUT_CRON = '* * * * *';
export const AUDIENCE_PURGE_CRON = '17 3 * * *';

function logFailure(kind: string) {
  return (err: unknown) => {
    console.error(
      JSON.stringify({ level: 'error', kind, message: err instanceof Error ? err.message : String(err) }),
    );
  };
}

export async function scheduled(
  controller: ScheduledController,
  env: MailEnv & MailoutEnv,
  ctx: ExecutionContext,
): Promise<void> {
  if (controller.cron === MAILOUT_CRON) {
    // Sin clave de servicio no hay cola que vaciar (local, preview).
    if (!env.SUPABASE_SERVICE_ROLE_KEY) return;
    ctx.waitUntil(runMailoutQueue(env).then(() => undefined, logFailure('mailout_queue_failed')));
    return;
  }
  if (controller.cron === AUDIENCE_PURGE_CRON) {
    if (!env.SUPABASE_SERVICE_ROLE_KEY) return;
    ctx.waitUntil(
      serviceRpc<number>(env, 'audience_purge_pending', {}).then((n) => {
        console.log(JSON.stringify({ level: 'info', kind: 'audience_purge_pending', deleted: n ?? 0 }));
      }, logFailure('audience_purge_failed')),
    );
    return;
  }
  ctx.waitUntil(runMailSync(env).then(() => undefined, logFailure('mail_sync_failed')));
  ctx.waitUntil(runDomainRecheck(env).then(() => undefined, logFailure('mail_domain_recheck_failed')));
}
