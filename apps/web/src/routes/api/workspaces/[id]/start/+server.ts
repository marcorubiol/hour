/**
 * GET /api/workspaces/[id]/start: lo que la lista de arranque de Hoy necesita
 * saber de un espacio (tarea 137): su primer espectáculo, su primer contacto
 * o conversación y su primera fecha, o nada. La forma, en `$lib/first-day`
 * (`StartResponse`).
 *
 * Solo lectura y con la RLS de quien pregunta: cada lectura va con su JWT,
 * como el resto de rutas, así que de un espacio ajeno no vuelve nada (y la
 * lista no sale: tampoco la pinta, porque no lo administra). Sin schema:
 * seis lecturas de una fila en paralelo, cada una con `limit=1`.
 *
 * Auth: Bearer JWT (o la cookie de sesión).
 */

import type { RequestHandler } from './$types';
import { extractAccessToken } from '$lib/auth';
import { pgGet, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { jsonNoStore, UUID_RE } from '$lib/server/http';
import type { StartResponse } from '$lib/first-day';

type ConvRow = {
  id: string;
  organization: { name: string } | null;
  contacts: { is_primary: boolean; person: { full_name: string } | null }[] | null;
};
type PerfRow = {
  slug: string | null;
  venue_name: string | null;
  city: string | null;
  performed_at: string | null;
  project: { name: string } | null;
};
type DateRow = { title: string | null; starts_at: string | null };

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;
  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);
  if (!UUID_RE.test(params.id)) return jsonNoStore({ error: 'invalid_id' }, 400);

  const first = (select: string) =>
    new URLSearchParams({
      select,
      workspace_id: `eq.${params.id}`,
      deleted_at: 'is.null',
      order: 'created_at.asc',
      limit: '1',
    });

  try {
    const [project, conv, person, org, perf, date] = await Promise.all([
      pgGet<{ id: string; slug: string; name: string }>(env, 'project', jwt, { search: first('id,slug,name') }),
      pgGet<ConvRow>(env, 'conversation', jwt, {
        search: first(
          'id,organization:workspace_organization!conversation_workspace_organization_fkey(name),contacts:conversation_contact(is_primary,person:workspace_person!conversation_contact_workspace_person_fkey(full_name))',
        ),
      }),
      pgGet<{ slug: string; full_name: string }>(env, 'workspace_person', jwt, { search: first('slug,full_name') }),
      pgGet<{ slug: string; name: string }>(env, 'workspace_organization', jwt, { search: first('slug,name') }),
      pgGet<PerfRow>(env, 'performance', jwt, {
        search: first('slug,venue_name,city,performed_at,project:project_id(name)'),
      }),
      pgGet<DateRow>(env, 'date', jwt, { search: first('title,starts_at') }),
    ]);

    const c = conv.data[0];
    const p = person.data[0];
    const o = org.data[0];
    const f = perf.data[0];
    const d = date.data[0];
    const body: StartResponse = {
      project: project.data[0] ?? null,
      contact: c
        ? {
            kind: 'conversation',
            id: c.id,
            name:
              c.organization?.name ||
              c.contacts?.find((x) => x.is_primary)?.person?.full_name ||
              c.contacts?.[0]?.person?.full_name ||
              '',
          }
        : p
          ? { kind: 'person', slug: p.slug, name: p.full_name }
          : o
            ? { kind: 'organization', slug: o.slug, name: o.name }
            : null,
      date: f
        ? {
            kind: 'performance',
            slug: f.slug,
            name: f.venue_name || f.city || f.project?.name || '',
            day: f.performed_at?.slice(0, 10) ?? null,
          }
        : d
          ? { kind: 'date', name: d.title ?? '', day: d.starts_at?.slice(0, 10) ?? null }
          : null,
    };
    return jsonNoStore(body);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/workspaces/[id]/start', requestId: locals.requestId },
      { passUpstream: [401, 403] },
    );
  }
};
