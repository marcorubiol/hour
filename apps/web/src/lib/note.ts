/**
 * Where a private note falls when nothing on its day anchors it (ADR-093,
 * `_tasks.md § 23`): exactly one pinned container, that container; anything
 * else, «the company», a note of the pinned space or the first one. The
 * Planner's margin and the shell's note (163) ask here.
 */

import { t, type Locale } from './i18n';
import type { NavWorkspace, ResolvedScope } from './nav';
import { spaceName } from './utils/identity';

export interface NoteFallback {
  label: string;
  project_id?: string;
  line_id?: string;
  workspace_id?: string;
}

export function noteFallback(
  scope: Pick<ResolvedScope, 'projects' | 'lines' | 'workspaceIds'>,
  workspaces: readonly Pick<NavWorkspace, 'id' | 'name'>[],
  locale: Locale,
): NoteFallback {
  const solo = scope.projects.length + scope.lines.length + scope.workspaceIds.length === 1;
  if (solo && scope.projects.length === 1) {
    const p = scope.projects[0];
    return { label: p.name, project_id: p.id };
  }
  if (solo && scope.lines.length === 1) {
    const l = scope.lines[0];
    return { label: l.name, line_id: l.id };
  }
  const pinned = solo ? workspaces.find((w) => w.id === scope.workspaceIds[0]) : undefined;
  const home = pinned ?? workspaces[0];
  if (home) return { label: spaceName(home.name), workspace_id: home.id };
  return { label: t('planner.note_company', locale) };
}

/** The anchor half of the POST body: the fallback's one id. */
export function noteFallbackBody(f: NoteFallback): { project_id?: string; line_id?: string; workspace_id?: string } {
  if (f.project_id) return { project_id: f.project_id };
  if (f.line_id) return { line_id: f.line_id };
  return f.workspace_id ? { workspace_id: f.workspace_id } : {};
}
