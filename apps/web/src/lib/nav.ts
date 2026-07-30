/**
 * Nav resolver (Adaptive Digest) — turns raw workspace/project/line API rows
 * and the user's pins into the display + scope shapes the shell, ⌘K palette,
 * scope strip, and the Calendar/Money lenses all share. Pure functions: no
 * fetch, no Svelte — consumers pass in the cached `['workspaces']`,
 * `['projects', …]` and `['lines']` query data.
 */

import { accentVarFor } from './utils/accent';
import { parsePin } from './stores/pins.svelte';

/** Space discipline (ADR-062) — drives per-archetype vocabulary. */
export type WorkspaceDomain =
  | 'theatre'
  | 'dance'
  | 'circus'
  | 'music'
  | 'mixed'
  | 'other';

export type NavWorkspace = {
  id: string;
  slug: string;
  /** Optional pretty URL alias (ADR-067) — resolved inbound only; canonical
      links always emit the slug (machine short-id). */
  alias?: string | null;
  name: string;
  kind: 'personal' | 'team';
  accent?: string | null;
  /** Space-portada masthead fields (ADR-062) — GET /api/workspaces returns
      them; all NULL when unset (UI falls back to the kind label / hides). */
  description?: string | null;
  domain?: WorkspaceDomain | null;
  city?: string | null;
  logo_url?: string | null;
  /**
   * ADR-002 — which hold convention this workspace follows. `simple`
   * (theatre/dance): holds are unranked and two can coexist on one slot.
   * `prioritized` (music): hold 1 has first right to convert, 2 promotes
   * when 1 releases. Absent reads as `simple` — a company that never said
   * otherwise is not running a priority queue.
   */
  booking_mode?: string | null;
  /** IANA home timezone — the timeslot-entry fallback when a gig has no
      linked venue (timezone rule, spec § Timezone rule). */
  timezone?: string;
};

/** Row shape of GET /api/projects — the shared ['projects', …] cache. */
export type RawProject = {
  id: string;
  slug: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
  workspace_id: string;
  starts_on: string | null;
  ends_on: string | null;
  updated_at: string;
  accent?: string | null;
  /** Stored identity monogram (ADR-081); absent until the migration lands. */
  initials?: string | null;
  description?: string | null;
};

export type NavProject = {
  id: string;
  slug: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  /** Space identity color — same convention as NavLine.accent. */
  accent: string;
};

export type RawLine = {
  id: string;
  slug: string | null;
  name: string;
  kind: string;
  status: string;
  workspace_id: string;
  project: { id: string; slug: string; name: string; workspace_id: string } | null;
};

export type NavLine = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  workspaceId: string;
  workspaceSlug: string;
  accent: string;
};

/** Resolve raw projects against the workspace list into display-ready units,
 *  dropping any whose workspace the user can't currently see. */
export function buildProjectIndex(
  workspaces: NavWorkspace[],
  projects: RawProject[],
): NavProject[] {
  const wsById = new Map(workspaces.map((w) => [w.id, w]));
  const out: NavProject[] = [];
  for (const p of projects) {
    const ws = wsById.get(p.workspace_id);
    if (!ws) continue;
    out.push({
      id: p.id,
      slug: p.slug,
      name: p.name,
      status: p.status,
      workspaceId: p.workspace_id,
      workspaceSlug: ws.slug,
      workspaceName: ws.name,
      accent: accentVarFor(ws),
    });
  }
  return out;
}

/** Resolve raw lines against the workspace list into display-ready units,
 *  dropping any whose workspace the user can't currently see. */
export function buildLineIndex(
  workspaces: NavWorkspace[],
  lines: RawLine[],
): NavLine[] {
  const wsById = new Map(workspaces.map((w) => [w.id, w]));
  const out: NavLine[] = [];
  for (const l of lines) {
    const ws = wsById.get(l.workspace_id);
    if (!ws || !l.project) continue;
    out.push({
      id: l.id,
      slug: l.slug ?? l.id,
      name: l.name,
      kind: l.kind,
      projectId: l.project.id,
      projectSlug: l.project.slug,
      projectName: l.project.name,
      workspaceId: l.workspace_id,
      workspaceSlug: ws.slug,
      accent: accentVarFor(ws),
    });
  }
  return out;
}

export function projectUrl(project: NavProject): string {
  return `/h/${project.workspaceSlug}/project/${project.slug}/`;
}

export function lineUrl(line: NavLine): string {
  return `/h/${line.workspaceSlug}/project/${line.projectSlug}/line/${line.slug}`;
}

export type ResolvedScope = {
  /** workspace ids of pinned spaces */
  workspaceIds: string[];
  /** workspace slugs of pinned spaces */
  workspaceSlugs: string[];
  /** line ids of pinned lines */
  lineIds: string[];
  /** project ids in scope: pinned projects ∪ projects of pinned lines —
   *  the surface API feeds filter on (`project_ids`) */
  projectIds: string[];
  /** the pinned NavProjects, resolved (for chips/panels; NOT line-derived) */
  projects: NavProject[];
  /** the pinned NavLines, resolved (for panels/labels) */
  lines: NavLine[];
  /**
   * Person ids of the pinned people. A person is NOT a container: it
   * contributes no workspace, project or line, so it never widens or narrows
   * `projectIds` — the surfaces that understand rosters narrow by it
   * themselves (`matchesPinnedPeople` in $lib/people), and the ones that do
   * not simply ignore it.
   */
  personIds: string[];
  /**
   * True when no CONTAINER is pinned → every container the user can see.
   *
   * Deliberately blind to person pins, and that is the whole point: every
   * consumer reads `isEmpty` as "do not filter by container" (see `inScope`
   * below, plus the Planner, Desk, Conversations and Books). Counting a
   * person pin here would flip it to false while contributing no ids, so
   * `inScope` would answer false for everything and pinning a person would
   * blank out three lenses that have no idea what a person is.
   */
  isEmpty: boolean;
};

export function resolveScope(
  pins: string[],
  workspaces: NavWorkspace[],
  lineIndex: NavLine[],
  projectIndex: NavProject[],
): ResolvedScope {
  const wsBySlug = new Map(workspaces.map((w) => [w.slug, w]));
  const lineById = new Map(lineIndex.map((l) => [l.id, l]));
  const projectById = new Map(projectIndex.map((p) => [p.id, p]));
  const workspaceIds: string[] = [];
  const workspaceSlugs: string[] = [];
  const lineIds: string[] = [];
  const lines: NavLine[] = [];
  const projects: NavProject[] = [];
  const personIds: string[] = [];
  let containerPins = 0;
  for (const pin of pins) {
    const { kind, key } = parsePin(pin);
    if (kind === 'person') {
      // Unresolved on purpose: there is no container index to look a person
      // up in, and an id is all the person axis needs. The label comes from
      // the team feed, which the surfaces that draw people already fetch.
      if (key) personIds.push(key);
      continue;
    }
    containerPins++;
    if (kind === 'space') {
      const ws = wsBySlug.get(key);
      if (ws) {
        workspaceIds.push(ws.id);
        workspaceSlugs.push(ws.slug);
      }
    } else if (kind === 'project') {
      const project = projectById.get(key);
      if (project) projects.push(project);
    } else {
      const line = lineById.get(key);
      if (line) {
        lineIds.push(line.id);
        lines.push(line);
      }
    }
  }
  return {
    workspaceIds,
    workspaceSlugs,
    lineIds,
    projectIds: [
      ...new Set([...projects.map((p) => p.id), ...lines.map((l) => l.projectId)]),
    ],
    projects,
    lines,
    personIds: [...new Set(personIds)],
    isEmpty: containerPins === 0,
  };
}

/** Keep an item if scope is empty, its workspace is a pinned space, its line
 *  is a pinned line, or its project is in scope — pinned directly or through
 *  a pinned line (conversations reach line scope through their project).
 *
 *  CONTAINER-ONLY, by contract: a person pin passes straight through here.
 *  An item has no person of its own to test against (a roster is computed
 *  from three tables and only a performance has one), so narrowing by person
 *  belongs to `$lib/people` — where the answer can carry whether it was a
 *  fact or an inference, which a boolean cannot. */
export function inScope(
  scope: ResolvedScope,
  item: { workspaceId?: string | null; lineId?: string | null; projectId?: string | null },
): boolean {
  if (scope.isEmpty) return true;
  if (item.workspaceId && scope.workspaceIds.includes(item.workspaceId)) return true;
  if (item.lineId && scope.lineIds.includes(item.lineId)) return true;
  if (item.projectId && scope.projectIds.includes(item.projectId)) return true;
  return false;
}
