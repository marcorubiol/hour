/**
 * Los contactos de una conversación con una sala (ADR-102).
 *
 * POST  /api/conversations/:id/contacts — { person: { full_name, email?, phone? }, role? }
 *   La persona aún sin dossier («Añadir como contacto» tras el 409 del alta):
 *   se busca por correo en el espacio o se crea (`add_conversation_contact`).
 * POST  /api/conversations/:id/contacts — { person_id, role?, since?, is_primary? }
 *   Añade un contacto o rehace el suyo, y lo deja vigente
 *   (`set_conversation_contact`). Lo que el cuerpo no trae se conserva: la RPC
 *   reescribe papel y `since` en cada llamada, así que se leen antes
 *   (revisión de la fase 1).
 * PATCH /api/conversations/:id/contacts — { person_id, until? }
 *   Cierra un contacto (`end_conversation_contact`; `until` por defecto, hoy).
 *
 * La base decide: `edit:conversation` sobre una conversación que quien llama
 * ve; «no existe» y «no es tuyo» son el mismo 404. El principal no se cierra
 * ni se degrada sin nombrar antes a otro (400).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import {
  ContactAddInlineSchema,
  ContactEndSchema,
  ContactSetSchema,
  contactSetArgs,
  type ContactRowLite,
} from '$lib/conversation';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';

const CODES = {
  '42501': { status: 404, error: 'not_found' },
  '22023': { status: 400, error: 'invalid_input' },
  '23514': { status: 400, error: 'invalid_input' },
  '23505': {
    status: 409,
    error: 'conversation_exists',
    hint: 'This person already has a conversation in this project.',
  },
};

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return jsonNoStore({ error: 'invalid_id' }, 400);

  const body = await readBody(request);
  const inline = v.safeParse(ContactAddInlineSchema, body);
  if (inline.success) {
    try {
      const { data } = await pgPostRpc<ContactRowLite>(env, 'add_conversation_contact', jwt, {
        p_conversation_id: params.id,
        p_full_name: inline.output.person.full_name,
        p_email: inline.output.person.email ?? null,
        p_phone: inline.output.person.phone ?? null,
        p_role: inline.output.role ?? null,
      });
      return jsonNoStore({ contact: data[0] ?? null }, 201);
    } catch (err) {
      return pgErrorResponse(
        err,
        { route: 'POST /api/conversations/[id]/contacts', requestId: locals.requestId },
        { codes: CODES },
      );
    }
  }
  const parsed = v.safeParse(ContactSetSchema, body);
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body' }, 400);

  try {
    const { data: current } = await pgGet<ContactRowLite>(env, 'conversation_contact', jwt, {
      search: {
        select: 'person_id,role,since,until,is_primary',
        conversation_id: `eq.${params.id}`,
        person_id: `eq.${parsed.output.person_id}`,
      },
    });
    const { data } = await pgPostRpc<ContactRowLite>(
      env,
      'set_conversation_contact',
      jwt,
      contactSetArgs(params.id, parsed.output, current[0] ?? null),
    );
    return jsonNoStore({ contact: data[0] ?? null }, current[0] ? 200 : 201);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'POST /api/conversations/[id]/contacts', requestId: locals.requestId },
      { codes: CODES },
    );
  }
};

export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return jsonNoStore({ error: 'invalid_id' }, 400);

  const parsed = v.safeParse(ContactEndSchema, await readBody(request));
  if (!parsed.success) return jsonNoStore({ error: 'invalid_body' }, 400);

  try {
    const { data } = await pgPostRpc<ContactRowLite>(env, 'end_conversation_contact', jwt, {
      p_conversation_id: params.id,
      p_person_id: parsed.output.person_id,
      p_until: parsed.output.until ?? null,
    });
    return jsonNoStore({ contact: data[0] ?? null });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PATCH /api/conversations/[id]/contacts', requestId: locals.requestId },
      { codes: CODES },
    );
  }
};
