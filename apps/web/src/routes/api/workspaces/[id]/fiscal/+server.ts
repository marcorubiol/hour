/**
 * The space's issuer (ADR-168): the fiscal data a proforma prints for who
 * bills. Same resolution as `issue_invoice` and the proforma page: the
 * space's own issuer (`workspace.fiscal_identity_id`), else the account
 * default.
 *
 * GET → WorkspaceFiscalResponse. RLS decides what is seen
 *     (`fiscal_identity_select`: read:money in the space, or account admin);
 *     a pointer whose row does not come back is `hidden`.
 * PUT → writes the space's own issuer. With one, a PATCH of that row; without,
 *     an insert of a space-owned `kind='issuer'` row and `update_workspace`
 *     pointing the space at it. Both are owner/admin only
 *     (`fiscal_identity_insert/update`, `update_workspace`). An account
 *     default is never edited from here: saving over it gives the space its
 *     own, starting from the default's values (the form is prefilled).
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { ISSUER_FISCAL_FIELDS, type IssuerFiscal, type WorkspaceFiscalResponse } from '$lib/fiscal';
import { pgGet, pgInsert, pgPatch, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';
import { IssuerFiscalSchema } from '$lib/server/fiscal';

type FiscalRow = IssuerFiscal & { id: string };
const FISCAL_SELECT = ['id', ...ISSUER_FISCAL_FIELDS].join(',');

async function readWorkspace(env: SupabaseEnv, jwt: string, id: string) {
  const { data } = await pgGet<{ fiscal_identity_id: string | null; account_id: string }>(env, 'workspace', jwt, {
    search: { id: `eq.${id}`, deleted_at: 'is.null', select: 'fiscal_identity_id,account_id' },
  });
  return data[0] ?? null;
}

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return jsonNoStore({ error: 'invalid_id' }, 400);

  try {
    const [ws, admin] = await Promise.all([
      readWorkspace(env, jwt, params.id),
      pgPostRpc<boolean>(env, 'is_workspace_admin', jwt, { ws_id: params.id }),
    ]);
    if (!ws) return jsonNoStore({ error: 'not_found' }, 404);

    let source: WorkspaceFiscalResponse['source'] = ws.fiscal_identity_id ? 'workspace' : null;
    let pointer = ws.fiscal_identity_id;
    if (!pointer) {
      const { data: accounts } = await pgGet<{ default_fiscal_identity_id: string | null }>(env, 'account', jwt, {
        search: { id: `eq.${ws.account_id}`, select: 'default_fiscal_identity_id' },
      });
      pointer = accounts[0]?.default_fiscal_identity_id ?? null;
      if (pointer) source = 'account';
    }

    let fiscal: FiscalRow | null = null;
    if (pointer) {
      const { data } = await pgGet<FiscalRow>(env, 'fiscal_identity', jwt, {
        search: { id: `eq.${pointer}`, select: FISCAL_SELECT },
      });
      fiscal = data[0] ?? null;
    }

    const body: WorkspaceFiscalResponse = {
      fiscal,
      source,
      hidden: Boolean(pointer) && !fiscal,
      can_edit: admin.data[0] === true,
    };
    return jsonNoStore(body);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/workspaces/[id]/fiscal', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};

export const PUT: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return jsonNoStore({ error: 'invalid_id' }, 400);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonNoStore({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(IssuerFiscalSchema, raw);
  if (!parsed.success) {
    return jsonNoStore(
      {
        error: 'invalid_body',
        issues: parsed.issues.map((i) => ({ path: i.path?.map((p) => p.key).join('.'), message: i.message })),
      },
      400,
    );
  }
  const fields = Object.fromEntries(
    Object.entries(parsed.output).map(([k, val]) => [k, val === '' ? null : val]),
  ) as IssuerFiscal;
  if (fields.country) fields.country = fields.country.toUpperCase();

  try {
    const ws = await readWorkspace(env, jwt, params.id);
    if (!ws) return jsonNoStore({ error: 'not_found' }, 404);

    if (ws.fiscal_identity_id) {
      const { data } = await pgPatch<FiscalRow>(env, 'fiscal_identity', jwt, fields, {
        search: { id: `eq.${ws.fiscal_identity_id}`, select: FISCAL_SELECT },
      });
      if (!data[0]) return jsonNoStore({ error: 'forbidden_or_not_found' }, 403);
      return jsonNoStore({ fiscal: data[0] });
    }

    const { data: created } = await pgInsert<FiscalRow>(
      env,
      'fiscal_identity',
      jwt,
      { ...fields, workspace_id: params.id, kind: 'issuer' },
      { search: { select: FISCAL_SELECT } },
    );
    const row = created[0];
    if (!row) return jsonNoStore({ error: 'save_failed' }, 502);
    await pgPostRpc(env, 'update_workspace', jwt, {
      p_workspace_id: params.id,
      p_patch: { fiscal_identity_id: row.id },
    });
    return jsonNoStore({ fiscal: row });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PUT /api/workspaces/[id]/fiscal', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '23514': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden' },
          P0002: { status: 404, error: 'not_found' },
        },
        passUpstream: [],
      },
    );
  }
};
