/** Un 22023 de las RPC de fusión de organizaciones, con su porqué (`$lib/organization-merge`). */
import { PostgrestError } from '$lib/supabase';
import { json } from '$lib/server/http';
import { orgMergeRefusal } from '$lib/organization-merge';

export function orgRefusalResponse(err: unknown): Response | null {
  if (!(err instanceof PostgrestError) || err.code !== '22023') return null;
  let message = '';
  try {
    message = String((JSON.parse(err.body) as { message?: unknown }).message ?? '');
  } catch {
    /* sin cuerpo: invalid_input */
  }
  return json({ error: orgMergeRefusal(message) }, 400);
}
