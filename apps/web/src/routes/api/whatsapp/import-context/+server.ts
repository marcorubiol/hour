/**
 * POST /api/whatsapp/import-context (ADR-189): con qué se revisa en el
 * dispositivo un chat exportado antes de importarlo.
 *
 * Body `{ workspace_id, fingerprints }` (las huellas de los mensajes leídos,
 * nunca su texto). Devuelve, con la RLS de quien llama, sus personas (con
 * número y si son del equipo), las conversaciones vivas que edita, sus
 * contactos con fechas y los bolos con su primer y último día; y, del
 * espacio, qué huellas ya están y qué chats propios las comparten.
 *
 * Auth: Bearer JWT. Sólo owner, admin o member (404 si no).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json } from '$lib/server/http';
import { ImportContextRequestSchema, type ImportContext, type ImportOwnChat } from '$lib/wa-import';

interface Lookup {
  known: string[];
  chats: ImportOwnChat[];
  team: string[];
  me: { person_id: string | null; name: string | null } | null;
}

type Context = Pick<ImportContext, 'conversations' | 'contacts' | 'bolos'> & {
  persons: { person_id: string; name: string; phone: string | null }[];
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(ImportContextRequestSchema, raw);
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);
  const { workspace_id, fingerprints } = parsed.output;

  try {
    const [lookup, context] = await Promise.all([
      pgPostRpc<Lookup>(env, 'whatsapp_import_lookup', jwt, { p_workspace_id: workspace_id, p_fingerprints: fingerprints }),
      pgPostRpc<Context>(env, 'whatsapp_import_context', jwt, { p_workspace_id: workspace_id }),
    ]);
    const l = lookup.data[0];
    const c = context.data[0];
    if (!l || !c) return json({ error: 'not_found' }, 404);
    const team = new Set(l.team);
    const body: ImportContext = {
      me: l.me ?? { person_id: null, name: null },
      persons: c.persons.map((p) => ({ ...p, team: team.has(p.person_id) })),
      conversations: c.conversations,
      contacts: c.contacts,
      bolos: c.bolos,
      known: l.known,
      chats: l.chats,
    };
    return json(body);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/whatsapp/import-context', requestId: locals.requestId },
      { codes: { '42501': { status: 404, error: 'not_found' }, '22023': { status: 400, error: 'invalid_body' } } },
    );
  }
};
