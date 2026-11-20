/**
 * GET /api/bootstrap?today=YYYY-MM-DD&dates_from=YYYY-MM-DD
 *
 * Aggregated cold-boot read for Hoy: resolves the initial shell + Desk feeds
 * in parallel from the Cloudflare Worker (colocated near Supabase via Smart
 * Placement) so a cold phone or post-schema-bump open pays ONE mobile→Worker
 * round-trip instead of 11+ sequential/parallel ones.
 *
 * Every slice keeps the EXACT same JSON shape as its individual endpoint so
 * the client seeds TanStack Query's existing keys (`$lib/bootstrap-client`)
 * with zero cache-schema changes. Any slice that fails (other than 401 on
 * auth) is simply omitted and its individual query falls back on its own.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { CONVERSATIONS_WHOLE, CONVERSATION_SELECT, normalizeConversationItem, type ConversationDbItem } from '$lib/conversation';
import { COMMITMENTS_EMBED } from '$lib/people';
import { SCHEDULE_SLOT_EMBED, scheduleOf, withSchedule, type ScheduleSlotRow } from '$lib/schedule-slot';
import { TASK_SELECT, normalizeTaskItem, type TaskDbItem } from '$lib/task';
import { STAGE_SELECT } from '$lib/travel-stage';
import { withMyRole, type OwnMembership } from '$lib/workspace-role';
import { PostgrestError, pgGet, pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { DATE_SELECT } from '$lib/server/date-select';
import { TURN_EMBEDS, setLastTurnEmbed } from '$lib/server/conversation-overview';
import { fetchMissingFacts, type MissingFacts } from '$lib/server/missing-facts';
import { fetchPerformanceRosters } from '$lib/server/rosters';
import { jsonNoStore } from '$lib/server/http';
import { decodeJwtPayload } from '$lib/server/session';
import type { SetAside } from '$lib/set-aside';

const DAY_MS = 86_400_000;

const QuerySchema = v.object({
  today: v.optional(v.pipe(v.string(), v.isoDate())),
  dates_from: v.optional(v.pipe(v.string(), v.isoDate())),
});

async function loadWorkspaces(env: SupabaseEnv, jwt: string, sub: string | null) {
  const search = new URLSearchParams({
    select:
      'id,slug,alias,name,kind,timezone,country,accent,description,domain,city,logo_url,trade,lenses_off,season_start_month,booking_mode:settings->>booking_mode,invoicing_mode:settings->>invoicing_mode',
    deleted_at: 'is.null',
    order: 'created_at.asc',
    limit: '50',
  });
  const own = new URLSearchParams({
    select: '*',
    level: 'eq.workspace',
    accepted_at: 'not.is.null',
  });
  if (sub) own.set('user_id', `eq.${sub}`);

  const [{ data }, { data: memberships }] = await Promise.all([
    pgGet<{ id: string }>(env, 'workspace', jwt, { search }),
    sub ? pgGet<OwnMembership>(env, 'membership', jwt, { search: own }) : Promise.resolve({ data: [] as OwnMembership[] }),
  ]);
  return { items: withMyRole(data, memberships) };
}

async function loadProjects(env: SupabaseEnv, jwt: string) {
  const search = new URLSearchParams({
    select: 'id,slug,name,status,workspace_id,starts_on,ends_on,updated_at,accent,initials,description,custom_fields',
    deleted_at: 'is.null',
    status: 'eq.active',
    order: 'updated_at.desc',
    limit: '50',
  });
  const { data } = await pgGet<Record<string, unknown> & { custom_fields: { preparation?: unknown } | null }>(
    env,
    'project',
    jwt,
    { search },
  );
  return { items: data.map(({ custom_fields, ...p }) => ({ ...p, preparation: custom_fields?.preparation ?? null })) };
}

async function loadLines(env: SupabaseEnv, jwt: string) {
  const search = new URLSearchParams({
    select:
      'id,slug,name,kind,status,territory,start_date,end_date,accent,description,project_id,workspace_id,updated_at,last_navigated_at,project:project_id(id,slug,name,workspace_id)',
    deleted_at: 'is.null',
    order: 'last_navigated_at.desc.nullslast,updated_at.desc',
    limit: '100',
  });
  const { data } = await pgGet(env, 'line', jwt, { search });
  return { items: data };
}

async function loadMe(env: SupabaseEnv, jwt: string, sub: string) {
  const { data } = await pgGet<{ person_id: string | null; full_name: string }>(env, 'user_profile', jwt, {
    search: { select: 'person_id,full_name', user_id: `eq.${sub}`, limit: '1' },
  });
  const personId = data[0]?.person_id ?? null;
  const fullName = data[0]?.full_name ?? '';
  if (!personId) return { person_id: null, full_name: fullName, dossiers: [] };
  const dossiers = await pgGet(env, 'workspace_person', jwt, {
    search: {
      select: 'workspace_id,slug,full_name,profile_sync_enabled,profile_shared_fields',
      person_id: `eq.${personId}`,
      deleted_at: 'is.null',
    },
  });
  return { person_id: personId, full_name: fullName, dossiers: dossiers.data };
}

async function loadMoneyAccess(env: SupabaseEnv, jwt: string): Promise<{ read_money: boolean }> {
  try {
    const { data } = await pgPostRpc<boolean>(env, 'money_access_any', jwt, {});
    return { read_money: data[0] === true };
  } catch (rpcErr) {
    if (!(rpcErr instanceof PostgrestError && (rpcErr.status === 404 || rpcErr.code === 'PGRST202'))) {
      throw rpcErr;
    }
  }
  const { data: projects } = await pgGet<{ id: string }>(env, 'project', jwt, {
    search: { select: 'id', deleted_at: 'is.null', limit: '500' },
  });
  const any = await Promise.any(
    projects.map(async (p) => {
      const { data } = await pgPostRpc<boolean>(env, 'has_permission', jwt, {
        p_project_id: p.id,
        p_perm: 'read:money',
      });
      if (data[0] === true) return true;
      throw new Error('no');
    }),
  ).catch(() => false);
  return { read_money: any };
}

async function loadConversationAccess(env: SupabaseEnv, jwt: string) {
  const { data } = await pgPostRpc<{ read: boolean; edit: boolean }>(env, 'conversation_access', jwt, {});
  const row = data[0];
  return { read: row?.read === true, edit: row?.edit === true };
}

async function loadSetAside(env: SupabaseEnv, jwt: string) {
  const { data } = await pgGet<{ items: SetAside }>(env, 'desk_set_aside', jwt, {
    search: { select: 'items', limit: '1' },
  });
  return { items: data[0]?.items ?? {} };
}

async function loadPerformances(env: SupabaseEnv, jwt: string, today: string) {
  const search = new URLSearchParams({
    select: [
      'id,slug,performed_at,status,venue_id,venue_name,city,country',
      'workspace_id,project_id,line_id,conversation_id',
      'series_id',
      SCHEDULE_SLOT_EMBED,
      COMMITMENTS_EMBED,
      'hold_notice_days',
      'prep:custom_fields->preparation',
      'venue:venue_id(id,name,city,country,timezone)',
      'project:project_id(id,slug,name,accent,initials,workspace_id)',
    ].join(','),
    deleted_at: 'is.null',
    performed_at: `gte.${today}`,
    order: 'performed_at.asc.nullslast',
    limit: '200',
  });
  type PerfDb = { id: string; performed_at: string; status: string; project_id: string; schedule_slot: ScheduleSlotRow[] };
  const { data: rows } = await pgGet<PerfDb>(env, 'performance', jwt, { search });
  const base = rows.map(withSchedule);
  const [facts, rosters] = await Promise.all([
    fetchMissingFacts(env, jwt, base),
    fetchPerformanceRosters(env, jwt, base.map((p) => ({ id: p.id, project_id: p.project_id }))),
  ]);
  const items = base.map((p) => ({
    ...p,
    ...(facts[p.id] ?? ({} as Partial<MissingFacts>)),
    person_ids: rosters[p.id] ?? [],
  }));
  return { items };
}

async function loadDates(env: SupabaseEnv, jwt: string, datesFrom: string) {
  const search = new URLSearchParams({
    select: [...DATE_SELECT, `stages:travel_stage(${STAGE_SELECT})`].join(','),
    'stages.order': 'position.asc',
    deleted_at: 'is.null',
    starts_at: `gte.${datesFrom}`,
    order: 'starts_at.asc',
    limit: '200',
  });
  const { data } = await pgGet<{ schedule_slot?: ScheduleSlotRow[] } & Record<string, unknown>>(env, 'date', jwt, { search });
  return { items: data.map(({ schedule_slot, ...row }) => ({ ...row, schedule: scheduleOf(schedule_slot) })) };
}

async function loadTasks(env: SupabaseEnv, jwt: string) {
  const search = new URLSearchParams({
    select: TASK_SELECT,
    status: 'eq.open',
    deleted_at: 'is.null',
    order: 'due_at.asc.nullslast,created_at.desc',
    limit: '200',
  });
  const { data } = await pgGet<TaskDbItem>(env, 'task', jwt, { search });
  return { items: data.map(normalizeTaskItem) };
}

async function loadConversations(env: SupabaseEnv, jwt: string) {
  const search = new URLSearchParams({
    select: `${CONVERSATION_SELECT},${TURN_EMBEDS}`,
    deleted_at: 'is.null',
    order: 'next_action_at.asc.nullslast,updated_at.desc',
    limit: String(CONVERSATIONS_WHOLE),
    offset: '0',
  });
  setLastTurnEmbed(search);
  const { data } = await pgGet<ConversationDbItem>(env, 'conversation', jwt, { search, exactCount: false });
  return { limit: CONVERSATIONS_WHOLE, offset: 0, items: data.map((r) => normalizeConversationItem(r)) };
}

function isAuthError(reason: unknown): boolean {
  return reason instanceof PostgrestError && reason.status === 401;
}

export const GET: RequestHandler = async ({ request, url, platform }) => {
  if (!platform?.env) return jsonNoStore({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return jsonNoStore({ error: 'missing_authorization' }, 401);

  const parsed = v.safeParse(QuerySchema, Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return jsonNoStore({ error: 'invalid_query' }, 400);

  const today = parsed.output.today ?? new Date().toISOString().slice(0, 10);
  const datesFrom =
    parsed.output.dates_from ?? new Date(Date.parse(`${today}T00:00:00Z`) - 14 * DAY_MS).toISOString().slice(0, 10);
  const claims = decodeJwtPayload(jwt);
  const sub = typeof claims?.sub === 'string' && claims.sub ? claims.sub : null;

  const results = await Promise.allSettled([
    loadWorkspaces(env, jwt, sub),
    loadProjects(env, jwt),
    loadLines(env, jwt),
    sub ? loadMe(env, jwt, sub) : Promise.resolve(undefined),
    loadMoneyAccess(env, jwt),
    loadConversationAccess(env, jwt),
    loadSetAside(env, jwt),
    loadPerformances(env, jwt, today),
    loadDates(env, jwt, datesFrom),
    loadTasks(env, jwt),
    loadConversations(env, jwt),
  ]);

  // If the JWT itself is expired/rejected, tell the client 401 so fetchJSON
  // triggers its standard refresh → retry flow.
  if (results.some((r) => r.status === 'rejected' && isAuthError(r.reason))) {
    return jsonNoStore({ error: 'unauthorized' }, 401);
  }

  const keys = [
    'workspaces',
    'projects',
    'lines',
    'me',
    'money_access',
    'conversation_access',
    'set_aside',
    'performances',
    'dates',
    'tasks',
    'conversations',
  ] as const;

  const body: Record<string, unknown> = {};
  results.forEach((res, i) => {
    if (res.status === 'fulfilled' && res.value !== undefined) {
      body[keys[i]] = res.value;
    }
  });
  return jsonNoStore(body);
};
