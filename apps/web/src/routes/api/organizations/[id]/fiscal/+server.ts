/**
 * GET /api/organizations/:id/fiscal — the organization's receiver fiscal
 *     identity (ADR-102 phase 2b) and whether the caller may edit it. RLS
 *     decides what is seen: the organization, internal members; its fiscal
 *     data, whoever reads money in the workspace (`fiscal_identity_select`).
 *     `can_edit` is `can_edit_workspace_money`, the same rule the write uses.
 * PUT /api/organizations/:id/fiscal — create or edit it through
 *     `set_organization_fiscal_identity` (fiscal_identity has no direct
 *     writes for `authenticated`).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import type { OrganizationFiscalResponse, ReceiverFiscal } from '$lib/fiscal';
import { pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { json, UUID_RE } from '$lib/server/mail/http';

type OrganizationRow = OrganizationFiscalResponse['organization'] & {
  fiscal: (ReceiverFiscal & { id: string }) | null;
};

const FISCAL_SELECT =
  'id,workspace_id,name,fiscal:fiscal_identity!workspace_organization_fiscal_identity_id_fkey(id,legal_name,tax_id,address_line_1,address_line_2,postal_code,city,region,country)';

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return json({ error: 'invalid_id' }, 400);

  try {
    const search = new URLSearchParams({ select: FISCAL_SELECT, id: `eq.${params.id}`, deleted_at: 'is.null' });
    const { data } = await pgGet<OrganizationRow>(env, 'workspace_organization', jwt, { search });
    const row = data[0];
    if (!row) return json({ error: 'not_found' }, 404);
    const { data: canEdit } = await pgPostRpc<boolean>(env, 'can_edit_workspace_money', jwt, {
      p_workspace_id: row.workspace_id,
    });
    const body: OrganizationFiscalResponse = {
      organization: { id: row.id, workspace_id: row.workspace_id, name: row.name },
      fiscal: row.fiscal,
      can_edit: canEdit[0] === true,
    };
    return json(body);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/organizations/[id]/fiscal', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

const text = (max: number) => v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(max))), null);

const PutSchema = v.object({
  legal_name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(300)),
  tax_id: text(60),
  address_line_1: text(300),
  address_line_2: text(300),
  postal_code: text(30),
  city: text(120),
  region: text(120),
  country: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.regex(/^([A-Za-z]{2})?$/))), null),
});

export const PUT: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return json({ error: 'invalid_id' }, 400);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(PutSchema, raw);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_body',
        issues: parsed.issues.map((i) => ({ path: i.path?.map((p) => p.key).join('.'), message: i.message })),
      },
      400,
    );
  }

  try {
    const { data } = await pgPostRpc<ReceiverFiscal & { id: string }>(env, 'set_organization_fiscal_identity', jwt, {
      p_organization_id: params.id,
      p_fiscal: parsed.output,
    });
    if (!data[0]) return json({ error: 'save_failed' }, 502);
    return json({ fiscal: data[0] });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PUT /api/organizations/[id]/fiscal', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden_or_not_found' },
        },
      },
    );
  }
};
