/**
 * Piezas comunes de las rutas /api/mailout/[id]/* (envío en bloque, fase 3).
 * Todo lo de una persona va con su JWT y RLS; la clave de servicio no aparece
 * aquí (la usa solo la cola, queue.ts).
 */

import type { RequestEvent } from '@sveltejs/kit';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse, type PgErrorMapEntry } from '$lib/server/errors';
import { json, UUID_RE } from '$lib/server/mail/http';
import {
  MAIL_DOMAIN_SELECT,
  MAILOUT_SELECT,
  type MailDomainItem,
  type MailoutDetail,
  type MailoutItem,
  type MailoutRecipientRow,
} from '$lib/mailout';
import type { ComposeContext } from '$lib/mailout-compose';
import { defaultProviderKind, type MailoutEnv } from './index';

/** 42501 es «no existe» (o no es tuyo); 22023, lo que el envío no admite ahora. */
export const MAILOUT_PG_CODES: Record<string, PgErrorMapEntry> = {
  '42501': { status: 404, error: 'not_found' },
  '22023': { status: 409, error: 'invalid_state' },
  '23514': { status: 400, error: 'invalid' },
  '23505': { status: 409, error: 'conflict' },
};

interface MailoutCtx {
  env: MailoutEnv;
  jwt: string;
  id: string;
  event: RequestEvent;
}

/** Plataforma, JWT, id y errores de PostgREST, iguales en todas las rutas. */
export async function mailoutRoute(
  event: RequestEvent,
  route: string,
  fn: (ctx: MailoutCtx) => Promise<Response>,
): Promise<Response> {
  const { request, params, platform, locals } = event;
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  const id = params.id ?? '';
  if (!UUID_RE.test(id)) return json({ error: 'not_found' }, 404);
  try {
    return await fn({ env: platform.env as unknown as MailoutEnv, jwt, id, event });
  } catch (err) {
    return pgErrorResponse(err, { route, requestId: locals.requestId }, { codes: MAILOUT_PG_CODES });
  }
}

/** El cuerpo JSON validado, o la respuesta 400. */
export async function readBody<S extends v.GenericSchema>(
  request: Request,
  schema: S,
): Promise<v.InferOutput<S> | Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(schema, raw);
  return parsed.success ? parsed.output : json({ error: 'invalid_body' }, 400);
}

/** El mensaje de un RAISE, para distinguir dos 22023 o 42501 de la misma RPC. */
export function pgMessage(err: unknown): string {
  if (!(err instanceof PostgrestError)) return '';
  try {
    return String((JSON.parse(err.body) as { message?: unknown }).message ?? '');
  } catch {
    return '';
  }
}

export async function readMailout(env: SupabaseEnv, jwt: string, id: string): Promise<MailoutItem | null> {
  const { data } = await pgGet<MailoutItem>(env, 'mailout', jwt, { search: { select: MAILOUT_SELECT, id: `eq.${id}` } });
  return data[0] ?? null;
}

export async function previewRows(
  env: SupabaseEnv,
  jwt: string,
  id: string,
): Promise<{ recipients: MailoutRecipientRow[]; compose: ComposeContext[] }> {
  const [recipients, compose] = await Promise.all([
    pgPostRpc<MailoutRecipientRow>(env, 'mailout_preview', jwt, { p_id: id }),
    pgPostRpc<ComposeContext>(env, 'mailout_compose_preview', jwt, { p_id: id }),
  ]);
  return { recipients: recipients.data, compose: compose.data };
}

/** Todo lo que pinta la pantalla del envío; null si quien llama no lo ve. */
export async function loadDetail(env: MailoutEnv, jwt: string, id: string): Promise<MailoutDetail | null> {
  const mailout = await readMailout(env, jwt, id);
  if (!mailout) return null;
  const [ws, project, domains, accounts, rows, canEdit] = await Promise.all([
    pgGet<{ id: string; slug: string; name: string }>(env, 'workspace', jwt, {
      search: { select: 'id,slug,name', id: `eq.${mailout.workspace_id}` },
    }),
    pgGet<{ id: string; slug: string; name: string | null }>(env, 'project', jwt, {
      search: { select: 'id,slug,name', id: `eq.${mailout.project_id}` },
    }),
    pgGet<MailDomainItem>(env, 'mail_domain', jwt, {
      search: {
        select: MAIL_DOMAIN_SELECT,
        workspace_id: `eq.${mailout.workspace_id}`,
        verified_at: 'not.is.null',
        order: 'created_at.asc',
      },
    }),
    // Las respuestas, como `queue_mailout`: el buzón común activo, si no el
    // personal de quien envía (la RLS solo deja ver el propio).
    pgGet<{ address: string; scope: 'personal' | 'workspace' }>(env, 'mail_account', jwt, {
      search: {
        select: 'address,scope',
        workspace_id: `eq.${mailout.workspace_id}`,
        status: 'eq.active',
        order: 'scope.desc,created_at.asc',
      },
    }),
    previewRows(env, jwt, id),
    pgPostRpc<boolean>(env, 'has_permission', jwt, { p_project_id: mailout.project_id, p_perm: 'edit:conversation' }),
  ]);
  if (!ws.data[0]) return null;
  const domain = domains.data.find((d) => d.id === mailout.mail_domain_id);
  const reply = accounts.data.find((a) => a.scope === 'workspace') ?? accounts.data[0] ?? null;
  return {
    mailout,
    can_edit: canEdit.data[0] === true,
    workspace: ws.data[0],
    project: project.data[0] ?? null,
    domains: domains.data,
    reply_to: reply,
    recipients: rows.recipients,
    compose: rows.compose,
    simulated: (domain?.provider ?? defaultProviderKind(env)) === 'simulator',
  };
}
