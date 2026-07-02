/**
 * Sidebar selection → API filter ids (ADR-038: the selection is the
 * filter; empty = everything RLS allows). Slugs resolve against the
 * cached workspace/project lists the shell already loads. Pure — each
 * consumer owns its TanStack queries and passes the maps in.
 */

interface SelectionLike {
  effectiveProjects(): Set<string>;
  effectiveWorkspaces(): Set<string>;
  hasAnySelection(): boolean;
}

export interface SelectionFilterIds {
  projectIds: string[];
  workspaceIds: string[];
  /**
   * True while a selection exists but no slug resolved to an id (caches
   * still loading, or a parked project) — callers must hold their feed
   * instead of falling through to the unfiltered everything-query.
   */
  unresolved: boolean;
}

export function resolveSelectionIds(
  selection: SelectionLike,
  projectsBySlug: ReadonlyMap<string, { id: string }>,
  workspacesBySlug: ReadonlyMap<string, { id: string }>,
): SelectionFilterIds {
  const projectIds: string[] = [];
  const workspaceIds: string[] = [];
  for (const slug of selection.effectiveProjects()) {
    const p = projectsBySlug.get(slug);
    if (p) projectIds.push(p.id);
  }
  for (const slug of selection.effectiveWorkspaces()) {
    const w = workspacesBySlug.get(slug);
    if (w) workspaceIds.push(w.id);
  }
  projectIds.sort();
  workspaceIds.sort();
  return {
    projectIds,
    workspaceIds,
    unresolved:
      selection.hasAnySelection() && projectIds.length === 0 && workspaceIds.length === 0,
  };
}
