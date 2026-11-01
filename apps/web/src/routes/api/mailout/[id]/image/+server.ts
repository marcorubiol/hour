/**
 * POST /api/mailout/[id]/image (cuerpo: la imagen, PNG o JPEG, ya reducida
 * por la pantalla) → { image_url }: sube la imagen del espectáculo de un
 * borrador a R2 (ADR-172). No la pone en el envío: eso lo hace el guardado
 * del borrador (`PATCH /api/mailout/[id]` con `image`, `set_mailout_image`),
 * junto a su texto alternativo y su enlace.
 *
 * Solo quien edita el envío y solo en borrador, comprobado antes de escribir
 * en R2.
 */

import type { RequestHandler } from './$types';
import { pgPostRpc } from '$lib/supabase';
import { jsonNoStore } from '$lib/server/http';
import { mailoutRoute, readMailout } from '$lib/server/mailout/route';
import { putPublicImage, readUpload, rejectImage } from '$lib/server/media';

export const POST: RequestHandler = (event) =>
  mailoutRoute(event, 'POST /api/mailout/[id]/image', async ({ env, jwt, id }) => {
    const bucket = event.platform?.env?.MEDIA;
    if (!bucket) return jsonNoStore({ error: 'platform_unavailable' }, 500);
    const mailout = await readMailout(env, jwt, id);
    if (!mailout) return jsonNoStore({ error: 'not_found' }, 404);
    const canEdit = await pgPostRpc<boolean>(env, 'has_permission', jwt, {
      p_project_id: mailout.project_id,
      p_perm: 'edit:conversation',
    });
    if (canEdit.data[0] !== true) return jsonNoStore({ error: 'not_found' }, 404);
    if (mailout.status !== 'draft') return jsonNoStore({ error: 'invalid_state' }, 409);

    const bytes = await readUpload(event.request, 'mail');
    if (bytes === 'too_large') return jsonNoStore({ error: 'too_large' }, 413);
    const why = rejectImage(bytes, 'mail');
    if (why) return jsonNoStore({ error: why }, why === 'too_large' ? 413 : 415);
    return jsonNoStore({ image_url: await putPublicImage(bucket, mailout.workspace_id, 'mail', bytes) });
  });
