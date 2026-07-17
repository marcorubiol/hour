/**
 * Server-side fetcher for a single performance with everything its detail
 * page and road sheet need: venue, line, project, engagement(person),
 * crew, cast overrides, related dates, assets — plus the project-scoped
 * canonical cast (ADR-034: cast_member hangs off project, so it cannot be
 * embedded from performance and needs a second query).
 *
 * The key is either a uuid or a slug; slugs are only unique per workspace
 * (ADR-024), so slug lookups require the workspace slug and go through an
 * inner join on `workspace`.
 *
 * RLS does all authorization: zero rows = not found OR not allowed —
 * indistinguishable by design.
 */

import { pgGet, type SupabaseEnv } from '$lib/supabase';
import type { Json, Tables } from '$lib/db-types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export type PersonEmbed = {
  id: string;
  slug: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  organization_name?: string | null;
};

export type PerformanceDetail = Omit<
  Tables<'performance'>,
  'fee_amount' | 'fee_currency' | 'deleted_at' | 'created_by' | 'previous_slugs'
> & {
  venue: {
    id: string;
    slug: string | null;
    name: string;
    city: string | null;
    country: string | null;
    address: string | null;
    capacity: number | null;
    timezone: string | null;
    contacts: Json;
  } | null;
  line: { id: string; slug: string; name: string; kind: string } | null;
  project: { id: string; slug: string; name: string; accent: string | null } | null;
  engagement: {
    id: string;
    slug: string;
    status: string;
    person: PersonEmbed | null;
  } | null;
  crew_assignment: Array<{
    id: string;
    role: string;
    notes: string | null;
    contact_override: Json;
    person: PersonEmbed | null;
  }>;
  cast_override: Array<{
    id: string;
    role: string;
    reason: string | null;
    person: PersonEmbed | null;
    replaces_person: { id: string; full_name: string } | null;
  }>;
  date: Array<{
    id: string;
    kind: string;
    status: string;
    title: string | null;
    starts_at: string;
    ends_at: string | null;
    all_day: boolean;
    venue_name: string | null;
    city: string | null;
  }>;
  asset_version: Array<{
    id: string;
    kind: string;
    direction: string;
    url: string;
    notes: string | null;
    uploaded_at: string | null;
  }>;
};

export type CastMemberRow = {
  id: string;
  role: string;
  notes: string | null;
  person: PersonEmbed | null;
};

export interface PerformanceBundleResult {
  performance: PerformanceDetail;
  cast_members: CastMemberRow[];
}

const PERSON_COLS = 'id,slug,full_name,email,phone';

/**
 * Resolve a performance key (uuid, or slug scoped by workspace slug) to its
 * id without fetching the whole bundle. Returns null when nothing matched
 * (missing row or RLS denied — indistinguishable by design).
 */
export async function resolvePerformanceId(
  env: SupabaseEnv,
  jwt: string,
  key: string,
  workspaceSlug: string | null,
): Promise<string | null> {
  if (isUuid(key)) return key;
  if (!workspaceSlug) return null;
  const search = new URLSearchParams();
  search.set('select', 'id,workspace:workspace_id!inner(slug)');
  search.set('slug', `eq.${key}`);
  search.set('workspace.slug', `eq.${workspaceSlug}`);
  search.set('deleted_at', 'is.null');
  search.set('limit', '1');
  const { data } = await pgGet<{ id: string }>(env, 'performance', jwt, { search });
  return data[0]?.id ?? null;
}

// Explicit column list — deliberately NO fee_amount/fee_currency. The
// decided read-path money gate is the performance_redacted view
// (read:money); the detail bundle must not bypass it through the base
// table. Money surfaces arrive with the Money lens (Phase 0.3) via the
// view.
const PERFORMANCE_COLS = [
  'id',
  'workspace_id',
  'project_id',
  'line_id',
  'engagement_id',
  'slug',
  'performed_at',
  'status',
  'venue_id',
  'venue_name',
  'city',
  'country',
  'load_in_at',
  'soundcheck_at',
  'start_at',
  'loadout_at',
  'wrap_at',
  'logistics',
  'hospitality',
  'technical',
  'notes',
  'custom_fields',
  'created_at',
  'updated_at',
].join(',');

const DETAIL_SELECT = [
  PERFORMANCE_COLS,
  'venue:venue_id(id,slug,name,city,country,address,capacity,timezone,contacts)',
  'line:line_id(id,slug,name,kind)',
  'project:project_id(id,slug,name,accent)',
  `engagement:engagement_id(id,slug,status,person:person_id(${PERSON_COLS},organization_name))`,
  `crew_assignment(id,role,notes,contact_override,person:person_id(${PERSON_COLS}))`,
  `cast_override(id,role,reason,person:person_id(${PERSON_COLS}),replaces_person:replaces_person_id(id,full_name))`,
  'date(id,kind,status,title,starts_at,ends_at,all_day,venue_name,city,venue:venue_id(timezone))',
  'asset_version(id,kind,direction,url,notes,uploaded_at)',
].join(',');

/**
 * Fetch the bundle. Returns null when nothing matched (missing row or RLS
 * denied). Throws PostgrestError on upstream failures — callers map it.
 */
export async function fetchPerformanceBundle(
  env: SupabaseEnv,
  jwt: string,
  key: string,
  workspaceSlug: string | null,
): Promise<PerformanceBundleResult | null> {
  const search = new URLSearchParams();

  if (isUuid(key)) {
    search.set('select', DETAIL_SELECT);
    search.set('id', `eq.${key}`);
  } else {
    if (!workspaceSlug) return null;
    // Slug lookup — scope by workspace via inner join (ADR-024 uniqueness).
    search.set('select', `${DETAIL_SELECT},workspace:workspace_id!inner(slug)`);
    search.set('slug', `eq.${key}`);
    search.set('workspace.slug', `eq.${workspaceSlug}`);
  }

  search.set('deleted_at', 'is.null');
  // Soft-delete filters + ordering for the embedded collections.
  search.set('crew_assignment.deleted_at', 'is.null');
  search.set('cast_override.deleted_at', 'is.null');
  search.set('date.deleted_at', 'is.null');
  search.set('date.order', 'starts_at.asc');
  search.set('asset_version.deleted_at', 'is.null');
  search.set('limit', '1');

  const { data } = await pgGet<PerformanceDetail>(env, 'performance', jwt, { search });
  if (data.length === 0) return null;
  const performance = data[0];

  const castSearch = new URLSearchParams();
  castSearch.set('select', `id,role,notes,person:person_id(${PERSON_COLS})`);
  castSearch.set('project_id', `eq.${performance.project_id}`);
  castSearch.set('deleted_at', 'is.null');
  castSearch.set('order', 'role.asc');
  const { data: castMembers } = await pgGet<CastMemberRow>(env, 'cast_member', jwt, {
    search: castSearch,
  });

  return { performance, cast_members: castMembers };
}
