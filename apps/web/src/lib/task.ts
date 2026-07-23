/**
 * Task domain helpers (ADR-068, D3) — the verb layer. Single home for the
 * status vocabulary and the POST/PATCH contracts shared by the API
 * endpoints, the Tasks line module and the Desk feed.
 *
 * A task attaches to at most ONE of project / line / performance /
 * conversation — none = a free workspace-level task (workspace_id required
 * at create). The parent is immutable after creation (DB trigger); that is
 * why the PATCH whitelist carries no parent FKs.
 */

import * as v from 'valibot';
import { Constants, type Enums, type Tables } from './db-types';
import { localDayISO, realIsoDate } from './datetime';

export type TaskStatus = Enums<'task_status'>;

/** Both statuses in schema enum order (runtime mirror of the DB enum). */
export const TASK_STATUSES = Constants.public.Enums.task_status;

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'Open',
  done: 'Done',
};

/**
 * POST /api/tasks body. At most one parent FK; a task with no parent needs
 * workspace_id. Both rules are enforced by the endpoint (and again by the
 * RPC) — the fields stay optional here so the error can be specific.
 */
export const TaskCreateSchema = v.object({
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
  note: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500)))),
  due_at: v.optional(v.nullable(realIsoDate)),
  from_at: v.optional(v.nullable(realIsoDate)),
  lead_days: v.optional(
    v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(365))),
  ),
  workspace_id: v.optional(v.pipe(v.string(), v.uuid())),
  project_id: v.optional(v.pipe(v.string(), v.uuid())),
  line_id: v.optional(v.pipe(v.string(), v.uuid())),
  performance_id: v.optional(v.pipe(v.string(), v.uuid())),
  conversation_id: v.optional(v.pipe(v.string(), v.uuid())),
});

export type TaskCreate = v.InferOutput<typeof TaskCreateSchema>;

/**
 * PATCH /api/tasks/:id body — field edits ride a direct PostgREST PATCH
 * (task_update is member-gated, not claim-bound, and the row stays
 * SELECT-visible after a field edit; ADR-048 only bites soft-deletes).
 * Unknown keys are stripped, so RLS-sensitive columns (workspace_id,
 * parent FKs, origin, created_by…) can never ride along.
 */
export const TaskPatchSchema = v.object({
  title: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200))),
  note: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500)))),
  due_at: v.optional(v.nullable(realIsoDate)),
  from_at: v.optional(v.nullable(realIsoDate)),
  lead_days: v.optional(
    v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(365))),
  ),
  status: v.optional(v.picklist(TASK_STATUSES)),
});

export type TaskPatch = v.InferOutput<typeof TaskPatchSchema>;

/**
 * Shape the task endpoints return: the row plus the parent embeds every
 * surface needs for context labels and pin-scope resolution (each embed
 * carries enough to resolve the task's effective project). Embedded rows
 * respect RLS on their own table — an invisible parent comes back null.
 */
export interface TaskItem extends Tables<'task'> {
  project: { id: string; slug: string | null; name: string } | null;
  line: { id: string; slug: string | null; name: string; project_id: string } | null;
  performance: {
    id: string;
    slug: string | null;
    project_id: string;
    venue_name: string | null;
    city: string | null;
    start_at: string | null;
  } | null;
  conversation: {
    id: string;
    project_id: string;
    person: {
      slug: string | null;
      full_name: string | null;
      organization_name: string | null;
    } | null;
  } | null;
}

/** The `{ items }` envelope the tasks endpoints return and every tasks query caches. */
export type TasksCache = { items: TaskItem[] };

export interface TaskDbItem extends Omit<TaskItem, 'conversation'> {
  conversation: {
    id: string;
    project_id: string;
    person: {
      slug: string | null;
      full_name: string | null;
      organization: { name: string } | null;
    } | null;
  } | null;
}

export function normalizeTaskItem(item: TaskDbItem): TaskItem {
  return {
    ...item,
    conversation: item.conversation
      ? {
          ...item.conversation,
          person: item.conversation.person
            ? {
                slug: item.conversation.person.slug,
                full_name: item.conversation.person.full_name,
                organization_name: item.conversation.person.organization?.name ?? null,
              }
            : null,
        }
      : null,
  };
}

/** PostgREST embed clause matching `TaskItem` — shared by GET, POST and PATCH. */
export const TASK_SELECT = [
  '*',
  'project:project_id(id,slug,name)',
  'line:line_id(id,slug,name,project_id)',
  'performance:performance_id(id,slug,project_id,venue_name,city,start_at)',
  'conversation:conversation_id(id,project_id,person:workspace_person!conversation_workspace_person_fkey(slug,full_name,organization:workspace_organization!workspace_person_organization_fkey(name)))',
].join(',');

// ── Surfacing (ADR-070) ─────────────────────────────────────────────────

export type TaskSurfaceStateName =
  | 'dormant'
  | 'anytime'
  | 'open'
  | 'urgent'
  | 'overdue'
  | 'done';

export interface TaskSurface {
  /** The calendar day (YYYY-MM-DD) the task surfaces, or null (anytime). */
  surfacesAt: string | null;
  state: TaskSurfaceStateName;
}

/** Calendar-day arithmetic on an ISO date string, UTC-anchored. */
function isoAddDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The ADR-070 surfacing rule, pure and day-precise. `now` is a parameter —
 * never read the clock in here. All comparisons are CALENDAR DAYS (the
 * date-only contract: an instant compare against local midnight flags a
 * due-today task overdue for any viewer west of UTC):
 *
 * - `surfacesAt = max(from_at, due_at − lead_days)` — missing parts degrade
 *   gracefully; no dates at all → null (anytime).
 * - Before `surfacesAt` → `dormant` (the Desk never renders it).
 * - Past `due_at` → `overdue`. On the due day, or inside the lead window →
 *   `urgent`. Surfaced with no due pressure → `open`. `done` wins over all.
 */
export function taskSurfaceState(
  t: Pick<Tables<'task'>, 'status' | 'from_at' | 'due_at' | 'lead_days'>,
  now: Date,
): TaskSurface {
  const fromDay = t.from_at ? t.from_at.slice(0, 10) : null;
  const dueDay = t.due_at ? t.due_at.slice(0, 10) : null;
  const leadDay = dueDay && t.lead_days != null ? isoAddDays(dueDay, -t.lead_days) : null;
  // ISO date strings compare correctly as strings.
  const surfacesAt =
    fromDay && leadDay ? (fromDay > leadDay ? fromDay : leadDay) : (fromDay ?? leadDay);

  const today = localDayISO(now);

  if (t.status === 'done') return { surfacesAt, state: 'done' };
  if (surfacesAt && today < surfacesAt) return { surfacesAt, state: 'dormant' };
  if (!fromDay && !dueDay) return { surfacesAt, state: 'anytime' };
  if (dueDay) {
    if (today > dueDay) return { surfacesAt, state: 'overdue' };
    if (today === dueDay || (leadDay && today >= leadDay)) {
      return { surfacesAt, state: 'urgent' };
    }
    return { surfacesAt, state: 'open' };
  }
  // from-only, already surfaced: a plain "task to do" now.
  return { surfacesAt, state: 'open' };
}

/**
 * The task's effective project id, resolved through whichever parent it
 * hangs off — how a task reaches pin scope (same route conversations take:
 * line pins scope through their project).
 */
export function taskProjectId(t: TaskItem): string | null {
  return (
    t.project_id ??
    t.line?.project_id ??
    t.performance?.project_id ??
    t.conversation?.project_id ??
    null
  );
}

/** One-line context label for a task row ("where does this verb hang"). */
export function taskContextLabel(t: TaskItem): string | null {
  if (t.line) return t.line.name;
  if (t.performance) {
    return [t.performance.venue_name, t.performance.city].filter(Boolean).join(', ') || 'Performance';
  }
  if (t.conversation) {
    return (
      t.conversation.person?.full_name || t.conversation.person?.organization_name || 'Conversation'
    );
  }
  if (t.project) return t.project.name;
  return null;
}

// ── Composer target (shared quick-add, ADR-068) ─────────────────────────
// The single parent a new task attaches to. `id` is the FK the POST wants:
// the workspace_id for a space, the entity's own id otherwise. Display
// fields (name / accent / lineKind) ride along so the composer pill and the
// picker rows render without a second lookup.

export type TaskTargetKind =
  | 'space'
  | 'project'
  | 'line'
  | 'performance'
  | 'conversation';

export interface TaskTarget {
  kind: TaskTargetKind;
  /** workspace_id for a space; the entity's own id otherwise. */
  id: string;
  name: string;
  /** CSS accent value for the glyph (space / project / line only). */
  accent?: string;
  /** line kind (tour / season / …) driving the line glyph + label. */
  lineKind?: string;
}

/** Map a target to the single POST /api/tasks parent field it fills. */
export function taskTargetFields(target: TaskTarget): Partial<TaskCreate> {
  switch (target.kind) {
    case 'space':
      return { workspace_id: target.id };
    case 'project':
      return { project_id: target.id };
    case 'line':
      return { line_id: target.id };
    case 'performance':
      return { performance_id: target.id };
    case 'conversation':
      return { conversation_id: target.id };
  }
}
