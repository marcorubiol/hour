/**
 * El cron del Worker (ADR-099): cada 10 minutos, una pasada de sincronización
 * de buzones. El adaptador de SvelteKit no exporta `scheduled`, así que el
 * despliegue usa `worker-entry.js` como entrada: reexporta el `fetch` de
 * SvelteKit y añade este `scheduled`. Solo imports relativos: esto lo
 * empaqueta wrangler, no Vite.
 */

import { runMailSync } from './lib/server/mail/sync';
import type { MailEnv } from './lib/server/mail/db';

export async function scheduled(
  _controller: ScheduledController,
  env: MailEnv,
  ctx: ExecutionContext,
): Promise<void> {
  ctx.waitUntil(
    runMailSync(env).then(
      () => undefined,
      (err: unknown) => {
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'mail_sync_failed',
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      },
    ),
  );
}
