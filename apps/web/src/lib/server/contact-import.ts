/**
 * Importar contactos (138), lo que comparten sus rutas: si la base aún no
 * tiene la migración `20261113100000_contact_import`, PostgREST contesta 404
 * con PGRST202 (la función no existe) o PGRST205 (la tabla no existe), o
 * Postgres 42P01 / 42883. La pantalla no enseña ese error crudo: recibe
 * `not_ready` y dice que importar contactos aún no está disponible. Una
 * columna que no existe (42703) es un fallo, no una migración pendiente.
 */

import { PostgrestError } from '$lib/supabase';
import { json } from '$lib/server/http';

export function schemaMissing(err: unknown): boolean {
  if (!(err instanceof PostgrestError)) return false;
  return ['PGRST202', 'PGRST205', '42P01', '42883'].includes(err.code ?? '');
}

export function notReadyResponse(): Response {
  return json({ error: 'not_ready' }, 503);
}
