/**
 * Nav resolver (Adaptive Digest) — turns raw workspace/line API rows and the
 * user's pins into the display + scope shapes the shell, ⌘K palette, scope
 * strip, and the Calendar/Money lenses all share. Pure functions: no fetch,
 * no Svelte — consumers pass in the cached `['workspaces']` and `['lines']`
 * query data.
 */

import { accentVarFor } from './utils/accent';
import { parsePin } from './stores/pins.svelte';

export type NavWorkspace = {
  id: string;
  slug: string;
  name: string;
  kind: 'personal' | 'team';
  accent?: string | null;
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

export function workspaceUrl(slug: string): string {
  return `/h/${slug}/`;
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
  /** the pinned NavLines, resolved (for panels/labels) */
  lines: NavLine[];
  /** true when nothing is pinned → everything the user can see */
  isEmpty: boolean;
};

export function resolveScope(
  pins: string[],
  workspaces: NavWorkspace[],
  lineIndex: NavLine[],
): ResolvedScope {
  const wsBySlug = new Map(workspaces.map((w) => [w.slug, w]));
  const lineById = new Map(lineIndex.map((l) => [l.id, l]));
  const workspaceIds: string[] = [];
  const workspaceSlugs: string[] = [];
  const lineIds: string[] = [];
  const lines: NavLine[] = [];
  for (const pin of pins) {
    const { kind, key } = parsePin(pin);
    if (kind === 'space') {
      const ws = wsBySlug.get(key);
      if (ws) {
        workspaceIds.push(ws.id);
        workspaceSlugs.push(ws.slug);
      }
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
    lines,
    isEmpty: pins.length === 0,
  };
}

/** Keep an item if scope is empty, its workspace is a pinned space, or its
 *  line is a pinned line. The union predicate the lenses filter by. */
export function inScope(
  scope: ResolvedScope,
  item: { workspaceId?: string | null; lineId?: string | null },
): boolean {
  if (scope.isEmpty) return true;
  if (item.workspaceId && scope.workspaceIds.includes(item.workspaceId)) return true;
  if (item.lineId && scope.lineIds.includes(item.lineId)) return true;
  return false;
}
