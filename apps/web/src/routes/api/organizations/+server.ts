/**
 * GET /api/organizations?workspace_ids=a,b — las organizaciones vivas de esos
 * espacios (o de todos los del usuario), para autocompletar el alta de una
 * conversación (ADR-102). RLS decide: solo miembros internos del espacio.
 *
 * POST /api/organizations — { workspace_id, name, kind?, city?, email? } via
 * `create_workspace_organization` (136): una organización sin conversación,
 * desde ⌘K. La RPC decide quién (owner, admin o member, como la política de
 * INSERT). Un nombre que ya tiene otra organización viva del espacio es 409
 * `name_taken`, con la existente cuando quien llama la lee, para abrirla.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgGet, pgPostRpc, PostgrestError, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json, jsonNoStore, UUID_RE } from '$lib/server/http';
import { OrganizationCreateSchema, ilikeExact, type CreatedOrganization } from '$lib/directory-create';

export interface OrganizationOption {
  id: string;
  workspace_id: string;
  name: string;
}

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  const ids = [
    ...new Set(
      (url.searchParams.get('workspace_ids') ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter((x) => UUID_RE.test(x)),
    ),
  ];
  const search = new URLSearchParams({
    select: 'id,workspace_id,name',
    deleted_at: 'is.null',
    order: 'name.asc',
    limit: '1000',
  });
  if (ids.length) search.set('workspace_id', `in.(${ids.join(',')})`);
  try {
    const { data } = await pgGet<OrganizationOption>(env, 'workspace_organization', jwt, { search });
    return jsonNoStore({ items: data });
  } catch (err) {
    return pgErrorResponse(err, { route: 'GET /api/organizations', requestId: locals.requestId });
  }
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const parsed = v.safeParse(OrganizationCreateSchema, await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);
  const b = parsed.output;

  try {
    const { data } = await pgPostRpc<CreatedOrganization>(env, 'create_workspace_organization', jwt, {
      p_workspace_id: b.workspace_id,
      p_name: b.name,
      p_kind: b.kind || null,
      p_city: b.city || null,
      p_email: b.email || null,
    });
    if (data.length === 0) return json({ error: 'create_failed' }, 502);
    const o = data[0];
    return json({ organization: { id: o.id, workspace_id: o.workspace_id, slug: o.slug, name: o.name } }, 201);
  } catch (err) {
    if (err instanceof PostgrestError && err.code === '23505') {
      // The one that has the name, when the caller reads it: the screen opens it.
      const search = new URLSearchParams({
        select: 'id,workspace_id,slug,name',
        workspace_id: `eq.${b.workspace_id}`,
        name: `ilike.${ilikeExact(b.name)}`,
        deleted_at: 'is.null',
        limit: '1',
      });
      const existing = await pgGet<CreatedOrganization>(env, 'workspace_organization', jwt, { search }).catch(() => null);
      return json({ error: 'name_taken', organization: existing?.data[0] ?? null }, 409);
    }
    return pgErrorResponse(
      err,
      { route: 'POST /api/organizations', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden' },
        },
      },
    );
  }
};
