/**
 * El cron del Worker. Dos disparadores (wrangler.jsonc):
 *   · `*\/10 * * * *` (ADR-099): una pasada de sincronización de buzones;
 *   · `* * * * *` (ADR-115): vaciar la cola del envío en bloque, nada más.
 * El adaptador de SvelteKit no exporta `scheduled`, así que el despliegue usa
 * `worker-entry.js` como entrada: reexporta el `fetch` de SvelteKit y añade
 * este `scheduled`. Solo imports relativos: esto lo empaqueta wrangler, no
 * Vite.
 */

import { runMailSync } from './lib/server/mail/sync';
import { runMailoutQueue } from './lib/server/mailout/queue';
import type { MailEnv } from './lib/server/mail/db';
import type { MailoutEnv } from './lib/server/mailout';

export const MAILOUT_CRON = '* * * * *';

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
  ctx.waitUntil(runMailSync(env).then(() => undefined, logFailure('mail_sync_failed')));
}
