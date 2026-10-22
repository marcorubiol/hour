/** Un 22023 de las RPC de fusión, con su porqué (`$lib/person-merge`). */
import { PostgrestError } from '$lib/supabase';
import { json } from '$lib/server/http';
import { mergeRefusal } from '$lib/person-merge';

export function refusalResponse(err: unknown): Response | null {
  if (!(err instanceof PostgrestError) || err.code !== '22023') return null;
  let message = '';
  try {
    message = String((JSON.parse(err.body) as { message?: unknown }).message ?? '');
  } catch {
    /* sin cuerpo: invalid_input */
  }
  return json({ error: mergeRefusal(message) }, 400);
}

/**
 * La RPC aún no existe en esta base (migración de la fase 3 sin aplicar):
 * la pantalla sigue sin el aviso en vez de romperse.
 */
export function isMissingFunction(err: unknown): boolean {
  return err instanceof PostgrestError && (err.code === 'PGRST202' || err.code === '42883');
}
