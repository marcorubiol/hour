/**
 * Un ajuste por persona (comms carril 2, fase 4): la faceta de una membresía,
 * dada, cambiada o quitada a mano. Es `set_membership_facet` tal cual, que
 * decide quién puede (quien podría haberla dado o el admin, ADR-104) y deja
 * `source = override` con su `audit_log`.
 *
 * PUT { membership_id, facet_id, verb: 'view' | 'edit' | null } → null quita.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';

const Uuid = v.pipe(v.string(), v.regex(UUID_RE));
const Body = v.object({
  membership_id: Uuid,
  facet_id: Uuid,
  verb: v.nullable(v.picklist(['view', 'edit'])),
});

export const PUT: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return jsonNoStore({ error: 'invalid_id' }, 400);
  const parsed = v.safeParse(Body, await request.json().catch(() => null));
  if (!parsed.success) return jsonNoStore({ error: 'invalid' }, 400);
  try {
    await pgPostRpc(platform.env as unknown as SupabaseEnv, 'set_membership_facet', jwt, {
      p_membership_id: parsed.output.membership_id,
      p_facet_id: parsed.output.facet_id,
      p_verb: parsed.output.verb,
    });
    return jsonNoStore({ ok: true });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'PUT /api/workspaces/[id]/facets/grants', requestId: locals.requestId },
      {
        codes: {
          '0A000': { status: 400, error: 'invalid' },
          '23514': { status: 400, error: 'invalid' },
          '42501': { status: 403, error: 'forbidden' },
        },
      },
    );
  }
};
