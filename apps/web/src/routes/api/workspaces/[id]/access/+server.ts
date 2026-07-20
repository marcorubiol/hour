/** Workspace access administration: list, invite, change role and revoke. */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const UUID = v.pipe(v.string(), v.uuid());
const Role = v.picklist(['admin', 'member', 'viewer', 'guest']);
const InviteBody = v.object({
  email: v.pipe(v.string(), v.trim(), v.email(), v.maxLength(320)),
  role: Role,
  project_id: v.optional(v.nullable(UUID)),
  project_role_code: v.optional(
    v.nullable(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64))),
  ),
});
const PatchBody = v.object({
  membership_id: UUID,
  role: Role,
});
const DeleteBody = v.variant('kind', [
  v.object({ kind: v.literal('member'), id: UUID }),
  v.object({ kind: v.literal('invitation'), id: UUID }),
]);

interface AccessRow {
  access_kind: 'member' | 'invitation';
  id: string;
  user_id: string | null;
  email: string;
  display_name: string;
  role: 'owner' | 'admin' | 'member' | 'viewer' | 'guest';
  project_id: string | null;
  project_name: string | null;
  project_role_code: string | null;
  status: 'active' | 'pending' | 'accepted' | 'revoked' | 'expired';
  accepted_at: string | null;
  expires_at: string | null;
  created_at: string;
}

interface InvitationResult {
  id: string;
  email: string;
  role: AccessRow['role'];
  project_id: string | null;
  project_role_code: string | null;
  expires_at: string;
  token: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function context(request: Request, platform: App.Platform | undefined, id: string | undefined) {
  if (!platform?.env) {
    return { ok: false, response: json({ error: 'platform_unavailable' }, 500) } as const;
  }
  const jwt = extractAccessToken(request);
  if (!jwt) {
    return { ok: false, response: json({ error: 'missing_authorization' }, 401) } as const;
  }
  const parsedId = v.safeParse(UUID, id ?? '');
  if (!parsedId.success) {
    return { ok: false, response: json({ error: 'invalid_id' }, 400) } as const;
  }
  return {
    ok: true,
    env: platform.env as unknown as SupabaseEnv,
    jwt,
    workspaceId: parsedId.output,
  } as const;
}

function rpcError(err: unknown, route: string, requestId: string | undefined): Response {
  return pgErrorResponse(
    err,
    { route, requestId },
    {
      codes: {
        '22023': { status: 400, error: 'invalid_input' },
        '42501': { status: 403, error: 'forbidden' },
      },
      passUpstream: [401, 403],
    },
  );
}

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  const ctx = context(request, platform, params.id);
  if (!ctx.ok) return ctx.response;
  try {
    const { data } = await pgPostRpc<AccessRow>(ctx.env, 'list_workspace_access', ctx.jwt, {
      p_workspace_id: ctx.workspaceId,
    });
    return json({ items: data });
  } catch (err) {
    return rpcError(err, 'GET /api/workspaces/[id]/access', locals.requestId);
  }
};

export const POST: RequestHandler = async ({ request, params, platform, locals, url }) => {
  const ctx = context(request, platform, params.id);
  if (!ctx.ok) return ctx.response;
  const parsed = v.safeParse(InviteBody, await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid_body', issues: parsed.issues }, 400);
  if (Boolean(parsed.output.project_id) !== Boolean(parsed.output.project_role_code)) {
    return json({ error: 'project_and_role_required_together' }, 400);
  }
  try {
    const { data } = await pgPostRpc<InvitationResult>(
      ctx.env,
      'create_workspace_invitation',
      ctx.jwt,
      {
        p_workspace_id: ctx.workspaceId,
        p_email: parsed.output.email,
        p_role: parsed.output.role,
        p_project_id: parsed.output.project_id ?? null,
        p_project_role_code: parsed.output.project_role_code ?? null,
        p_expires_days: 7,
      },
    );
    const invitation = data[0];
    if (!invitation) return json({ error: 'rpc_empty_result' }, 502);
    return json(
      {
        invitation: {
          ...invitation,
          token: undefined,
          // Fragment keeps the capability out of HTTP, CDN and Sentry logs.
          // The /invite page forwards it to the API only in a JSON body.
          invite_url: `${url.origin}/invite#${invitation.token}`,
        },
      },
      201,
    );
  } catch (err) {
    return rpcError(err, 'POST /api/workspaces/[id]/access', locals.requestId);
  }
};

export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
  const ctx = context(request, platform, params.id);
  if (!ctx.ok) return ctx.response;
  const parsed = v.safeParse(PatchBody, await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid_body', issues: parsed.issues }, 400);
  try {
    await pgPostRpc(ctx.env, 'update_workspace_member_role', ctx.jwt, {
      p_membership_id: parsed.output.membership_id,
      p_role: parsed.output.role,
    });
    return new Response(null, { status: 204 });
  } catch (err) {
    return rpcError(err, 'PATCH /api/workspaces/[id]/access', locals.requestId);
  }
};

export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
  const ctx = context(request, platform, params.id);
  if (!ctx.ok) return ctx.response;
  const parsed = v.safeParse(DeleteBody, await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid_body', issues: parsed.issues }, 400);
  try {
    await pgPostRpc(
      ctx.env,
      parsed.output.kind === 'member'
        ? 'revoke_workspace_member'
        : 'revoke_workspace_invitation',
      ctx.jwt,
      parsed.output.kind === 'member'
        ? { p_membership_id: parsed.output.id }
        : { p_invitation_id: parsed.output.id },
    );
    return new Response(null, { status: 204 });
  } catch (err) {
    return rpcError(err, 'DELETE /api/workspaces/[id]/access', locals.requestId);
  }
};
