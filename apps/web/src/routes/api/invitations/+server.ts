/** Preview and accept a workspace invitation without exposing its token in API logs. */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

const Body = v.object({ token: v.pipe(v.string(), v.minLength(32), v.maxLength(128)) });

interface InvitationPreview {
  workspace_id: string;
  workspace_slug: string;
  workspace_name: string;
  email: string;
  role: string;
  project_id: string | null;
  project_name: string | null;
  project_role_code: string | null;
  expires_at: string;
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

async function invoke(
  request: Request,
  platform: App.Platform | undefined,
  functionName: 'preview_workspace_invitation' | 'accept_workspace_invitation',
  requestId: string | undefined,
): Promise<Response> {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);
  const parsed = v.safeParse(Body, await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid_body' }, 400);

  try {
    const { data } = await pgPostRpc<InvitationPreview>(
      platform.env as unknown as SupabaseEnv,
      functionName,
      jwt,
      { p_token: parsed.output.token },
    );
    const invitation = data[0];
    if (!invitation) return json({ error: 'invitation_unavailable' }, 404);
    return json({ invitation });
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: `POST /api/invitations/${functionName}`, requestId },
      {
        codes: { '42501': { status: 404, error: 'invitation_unavailable' } },
        passUpstream: [401],
      },
    );
  }
}

export const POST: RequestHandler = ({ request, platform, locals }) =>
  invoke(request, platform, 'preview_workspace_invitation', locals.requestId);

export const PATCH: RequestHandler = ({ request, platform, locals }) =>
  invoke(request, platform, 'accept_workspace_invitation', locals.requestId);
