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
import { jsonNoStore, jwtSubject, UUID_RE } from '$lib/server/http';
import { audienceAccess } from '$lib/server/audience';
import type { AudienceAccess } from '$lib/audience';
import {
  MAIL_DOMAIN_SELECT,
  MAILOUT_SELECT,
  type MailDomainItem,
  type AudiencePreview,
  type InvitationAudience,
  type InvitationPerformance,
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
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  const id = params.id ?? '';
  if (!UUID_RE.test(id)) return jsonNoStore({ error: 'not_found' }, 404);
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
    return jsonNoStore({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(schema, raw);
  return parsed.success ? parsed.output : jsonNoStore({ error: 'invalid_body' }, 400);
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

/** Una persona del público que recibiría una invitación, para la vista previa. */
type EligibleRow = {
  id: string;
  address: string;
  name: string | null;
  basis_kind: 'consent' | 'relationship';
  confirmed_at: string | null;
  import_id: string | null;
};

type CompanyRow = {
  name: string;
  city: string | null;
  website: string | null;
  phone: string | null;
  mail_signature: string | null;
  privacy_url: string | null;
};

/** Cuántas personas del público enseña la vista previa de un borrador. */
const AUDIENCE_PREVIEW = 20;

/**
 * El bloque «Público» de una invitación (ADR-173 § 10): la lista, quién de
 * ella recibiría si se pusiera en cola ahora (confirmadas, sin importaciones
 * en revisión), cuántas ya van como profesionales y una muestra con lo que
 * montaría cada correo. Es lo que congela `queue_mailout`, leído para pintar;
 * la supresión la vuelve a mirar la base (y solo el admin la lee, ADR-113).
 */
async function invitationAudience(
  env: SupabaseEnv,
  jwt: string,
  mailout: MailoutItem,
  recipients: MailoutRecipientRow[],
  performance: InvitationPerformance | null,
): Promise<{ audience: InvitationAudience | null; preview: AudiencePreview[] }> {
  if (!mailout.audience_id) return { audience: null, preview: [] };
  const [list, subs, imports, company] = await Promise.all([
    pgGet<{ id: string; name: string }>(env, 'audience', jwt, { search: { select: 'id,name', id: `eq.${mailout.audience_id}` } }),
    pgGet<EligibleRow>(env, 'audience_subscription', jwt, {
      search: {
        select: 'id,address,name,basis_kind,confirmed_at,import_id',
        audience_id: `eq.${mailout.audience_id}`,
        status: 'eq.confirmed',
        order: 'confirmed_at.desc.nullslast',
        limit: '5000',
      },
    }),
    pgGet<{ id: string }>(env, 'audience_import', jwt, {
      search: { select: 'id', audience_id: `eq.${mailout.audience_id}`, status: 'neq.done' },
    }),
    pgGet<CompanyRow>(env, 'workspace', jwt, {
      search: { select: 'name,city,website,phone,mail_signature,privacy_url', id: `eq.${mailout.workspace_id}` },
    }),
  ]);
  const a = list.data[0];
  if (!a) return { audience: null, preview: [] };
  const held = new Set(imports.data.map((i) => i.id));
  // Un profesional que sale gana la dirección; uno saltado la deja al público.
  const pros = new Set(
    recipients.filter((r) => r.conversation_id && r.address && r.status !== 'skipped').map((r) => r.address!.toLowerCase()),
  );
  const open = subs.data.filter((s) => !s.import_id || !held.has(s.import_id));
  const eligible = open.filter((s) => !pros.has(s.address.toLowerCase()));
  const c = company.data[0];
  const preview: AudiencePreview[] = c
    ? eligible.slice(0, AUDIENCE_PREVIEW).map((s) => ({
        address: s.address,
        display_name: s.name?.trim() || null,
        recipient_id: `audience:${s.id}`,
        address_kind: 'subscriber',
        basis_kind: s.basis_kind,
        contact_first_name: null,
        contact_name: null,
        organization_name: null,
        city: null,
        company_name: c.name,
        company_city: c.city?.trim() || null,
        company_website: c.website?.trim() || null,
        company_phone: c.phone?.trim() || null,
        company_signature: c.mail_signature?.trim() || null,
        privacy_url: c.privacy_url,
        mailout_kind: 'invitation',
        audience_subscription_id: s.id,
        audience_name: a.name,
        subscriber_name: s.name?.trim() || null,
        subscribed_at: s.confirmed_at,
        venue_name: performance?.venue_name ?? null,
        venue_city: performance?.city ?? null,
      }))
    : [];
  return {
    audience: { id: a.id, name: a.name, eligible: eligible.length, as_pros: open.length - eligible.length },
    preview,
  };
}

/** La función de una invitación, con la sala y la ciudad como las monta la cola. */
async function invitationPerformance(
  env: SupabaseEnv,
  jwt: string,
  id: string | null,
): Promise<InvitationPerformance | null> {
  if (!id) return null;
  const { data } = await pgGet<{
    id: string;
    performed_at: string;
    venue_name: string | null;
    city: string | null;
    venue: { name: string | null; city: string | null } | null;
  }>(env, 'performance', jwt, { search: { select: 'id,performed_at,venue_name,city,venue:venue_id(name,city)', id: `eq.${id}` } });
  const p = data[0];
  if (!p) return null;
  return {
    id: p.id,
    performed_at: p.performed_at,
    venue_name: p.venue_name?.trim() || p.venue?.name?.trim() || null,
    city: p.city?.trim() || p.venue?.city?.trim() || null,
  };
}

/** Todo lo que pinta la pantalla del envío; null si quien llama no lo ve. */
export async function loadDetail(env: MailoutEnv, jwt: string, id: string): Promise<MailoutDetail | null> {
  const mailout = await readMailout(env, jwt, id);
  if (!mailout) return null;
  const invitation = mailout.kind === 'invitation';
  const [ws, project, domains, accounts, rows, canEditProject, access, performance] = await Promise.all([
    pgGet<{ id: string; slug: string; name: string; logo_url: string | null }>(env, 'workspace', jwt, {
      search: { select: 'id,slug,name,logo_url', id: `eq.${mailout.workspace_id}` },
    }),
    mailout.project_id
      ? pgGet<{ id: string; slug: string; name: string | null }>(env, 'project', jwt, {
          search: { select: 'id,slug,name', id: `eq.${mailout.project_id}` },
        })
      : Promise.resolve({ data: [] as { id: string; slug: string; name: string | null }[] }),
    // Los de la difusión verificados (de dónde sale); en una invitación,
    // también el del público, verificado o no (su bloque dice si falta).
    pgGet<MailDomainItem>(env, 'mail_domain', jwt, {
      search: {
        select: MAIL_DOMAIN_SELECT,
        workspace_id: `eq.${mailout.workspace_id}`,
        order: 'created_at.asc',
        ...(invitation ? {} : { purpose: 'eq.outreach' }),
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
    mailout.project_id && !invitation
      ? pgPostRpc<boolean>(env, 'has_permission', jwt, { p_project_id: mailout.project_id, p_perm: 'edit:conversation' })
      : Promise.resolve({ data: [false] }),
    invitation ? audienceAccess(env, jwt, [mailout.workspace_id]) : Promise.resolve({} as Record<string, AudienceAccess>),
    invitation ? invitationPerformance(env, jwt, mailout.performance_id) : Promise.resolve(null),
  ]);
  if (!ws.data[0]) return null;
  const outreach = domains.data.filter((d) => d.purpose === 'outreach' && d.verified_at);
  const domain = outreach.find((d) => d.id === mailout.mail_domain_id);
  const audienceDomain = invitation ? (domains.data.find((d) => d.id === mailout.audience_mail_domain_id) ?? null) : null;
  const reply = accounts.data.find((a) => a.scope === 'workspace') ?? accounts.data[0] ?? null;
  const mine = access[mailout.workspace_id];
  // Una invitación la escribe quien la creó o lleva el público; con lista,
  // solo quien lleva el público (`private.mailout_for_caller`).
  const canEdit = invitation
    ? (mailout.created_by === jwtSubject(jwt) || Boolean(mine?.edit)) && (!mailout.audience_id || Boolean(mine?.edit))
    : canEditProject.data[0] === true;
  const [lists, block] = invitation
    ? await Promise.all([
        mine?.read
          ? pgGet<{ id: string; name: string }>(env, 'audience', jwt, {
              search: { select: 'id,name', workspace_id: `eq.${mailout.workspace_id}`, status: 'neq.archived', order: 'created_at.asc' },
            })
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        mine?.read
          ? invitationAudience(env, jwt, mailout, rows.recipients, performance)
          : Promise.resolve({ audience: null, preview: [] }),
      ])
    : [{ data: [] as { id: string; name: string }[] }, { audience: null, preview: [] as AudiencePreview[] }];
  // Simulado: lo dice el dominio por el que sale cada origen (ADR-111).
  const providers = [domain?.provider ?? (invitation ? null : defaultProviderKind(env)), audienceDomain?.provider ?? null].filter(
    (p): p is MailDomainItem['provider'] => p !== null,
  );
  return {
    mailout,
    can_edit: canEdit,
    can_edit_audience: Boolean(mine?.edit),
    audiences: lists.data,
    audience: block.audience,
    audience_domain: audienceDomain,
    performance,
    audience_preview: block.preview,
    workspace: ws.data[0],
    project: project.data[0] ?? null,
    domains: outreach,
    reply_to: reply,
    recipients: rows.recipients,
    compose: rows.compose,
    simulated: providers.length === 0 ? defaultProviderKind(env) === 'simulator' : providers.includes('simulator'),
  };
}
