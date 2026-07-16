/**
 * Task domain helpers (ADR-068, D3) — the verb layer. Single home for the
 * status vocabulary and the POST/PATCH contracts shared by the API
 * endpoints, the Tasks line module and the Desk feed.
 *
 * A task attaches to at most ONE of project / line / performance /
 * engagement — none = a free workspace-level task (workspace_id required
 * at create). The parent is immutable after creation (DB trigger); that is
 * why the PATCH whitelist carries no parent FKs.
 */

import * as v from 'valibot';
import { Constants, type Enums, type Tables } from './db-types';

export type TaskStatus = Enums<'task_status'>;

/** Both statuses in schema enum order (runtime mirror of the DB enum). */
export const TASK_STATUSES = Constants.public.Enums.task_status;

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'Open',
  done: 'Done',
};

/**
 * "YYYY-MM-DD that is a real calendar day" — same contract as
 * engagement.next_action_at (the column is timestamptz; Postgres casts).
 */
const realIsoDate = v.pipe(
  v.string(),
  v.isoDate(),
  v.check((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a real calendar date'),
);

/**
 * POST /api/tasks body. At most one parent FK; a task with no parent needs
 * workspace_id. Both rules are enforced by the endpoint (and again by the
 * RPC) — the fields stay optional here so the error can be specific.
 */
export const TaskCreateSchema = v.object({
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
  note: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500)))),
  due_at: v.optional(v.nullable(realIsoDate)),
  workspace_id: v.optional(v.pipe(v.string(), v.uuid())),
  project_id: v.optional(v.pipe(v.string(), v.uuid())),
  line_id: v.optional(v.pipe(v.string(), v.uuid())),
  performance_id: v.optional(v.pipe(v.string(), v.uuid())),
  engagement_id: v.optional(v.pipe(v.string(), v.uuid())),
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
  engagement: {
    id: string;
    project_id: string;
    person: {
      slug: string | null;
      full_name: string | null;
      organization_name: string | null;
    } | null;
  } | null;
}

/** PostgREST embed clause matching `TaskItem` — shared by GET, POST and PATCH. */
export const TASK_SELECT = [
  '*',
  'project:project_id(id,slug,name)',
  'line:line_id(id,slug,name,project_id)',
  'performance:performance_id(id,slug,project_id,venue_name,city,start_at)',
  'engagement:engagement_id(id,project_id,person:person_id(slug,full_name,organization_name))',
].join(',');

/**
 * The task's effective project id, resolved through whichever parent it
 * hangs off — how a task reaches pin scope (same route engagements take:
 * line pins scope through their project).
 */
export function taskProjectId(t: TaskItem): string | null {
  return (
    t.project_id ??
    t.line?.project_id ??
    t.performance?.project_id ??
    t.engagement?.project_id ??
    null
  );
}

/** One-line context label for a task row ("where does this verb hang"). */
export function taskContextLabel(t: TaskItem): string | null {
  if (t.line) return t.line.name;
  if (t.performance) {
    return [t.performance.venue_name, t.performance.city].filter(Boolean).join(', ') || 'Performance';
  }
  if (t.engagement) {
    return (
      t.engagement.person?.full_name || t.engagement.person?.organization_name || 'Conversation'
    );
  }
  if (t.project) return t.project.name;
  return null;
}
