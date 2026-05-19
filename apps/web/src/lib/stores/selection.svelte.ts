/**
 * Selection store — multi-select filter for sidebar (workspaces × projects).
 *
 * Refactored 2026-05-19 from single-select (one workspace + one entity)
 * to multi-select filter. Plaza items are now toggleable; LineList shows
 * lines per the effective filter.
 *
 * Source of truth: URL.
 *   - `/h/`                                           → empty selection
 *   - `/h/[ws]/`                                      → 1 workspace
 *   - `/h/[ws]/project/[slug]/`                       → 1 project (implies its workspace)
 *   - `/h/[ws]/project/[slug]/line/[line]/`           → still 1 project (line detail page)
 *   - `/h/?ws=a,b&project=c,d`                        → multi-select form
 *
 * Persistence: when URL has no selection info (`/h/` with no params), the
 * store restores from localStorage and navigates to the restored URL.
 * Otherwise URL wins.
 *
 * Canonical-vs-query URL serialization (vote 3A 2026-05-19):
 *   - 0 ws + 0 proj                                   → /h/
 *   - 1 ws + 0 proj                                   → /h/[ws]/
 *   - 0 ws + 1 proj (known workspace)                 → /h/[ws]/project/[slug]/
 *   - 1 ws + 1 proj (proj belongs to that ws)         → /h/[ws]/project/[slug]/
 *   - Anything else                                   → /h/?ws=...&project=...
 *
 * Project workspace mapping: stored externally and registered via
 * `registerProjectWorkspaces()` when /api/projects + /api/workspaces data
 * lands (Plaza does this in an effect).
 */

import { getContext, setContext } from 'svelte';
import { goto } from '$app/navigation';

const STORAGE_KEY = 'hour_selection';
const ROUTE_PREFIX = '/h';

type PersistedSelection = {
  ws?: string[];
  projects?: Array<{ slug: string; ws: string }>;
};

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export class SelectionStore {
  workspaces = $state<Set<string>>(new Set());
  projects = $state<Set<string>>(new Set());
  /** project slug → workspace slug; populated by registerProjectWorkspaces */
  projectWorkspaceMap = $state<Map<string, string>>(new Map());
  /**
   * The "browsing context" workspace, derived from URL path /h/[ws]/...
   * Set by the layout via setContextWorkspace(). Used to anchor URLs when
   * the selection state alone doesn't pick a single workspace
   * (empty selection or multi-select) — we don't want /h/?ws=... because
   * /h/ has no sidebar shell; URLs must always live under /h/[ws]/.
   */
  contextWorkspaceSlug = $state<string | null>(null);

  setContextWorkspace(slug: string | null): void {
    if (this.contextWorkspaceSlug !== slug) this.contextWorkspaceSlug = slug;
  }

  /**
   * Focus mode: a transient client-only view that pins the LineList filter
   * to a single workspace, regardless of what's in `workspaces`/`projects`.
   * Plaza also collapses its tree to just the focused workspace's row.
   *
   * Crucially, focus does NOT mutate the underlying selection sets and does
   * NOT change the URL — when the user exits focus, the prior selection
   * surfaces unchanged. Per Marco: "el focus es realmente en ese momento".
   */
  focusedWorkspaceSlug = $state<string | null>(null);

  setFocus(slug: string | null): void {
    if (this.focusedWorkspaceSlug !== slug) this.focusedWorkspaceSlug = slug;
  }

  /**
   * What LineList should use as the workspace-level filter. Focus wins:
   * when active, returns ONLY the focused slug; otherwise the real
   * `workspaces` set. Projects-level filter is suppressed during focus
   * (see effectiveProjects).
   */
  effectiveWorkspaces(): Set<string> {
    if (this.focusedWorkspaceSlug !== null) {
      return new Set([this.focusedWorkspaceSlug]);
    }
    return this.workspaces;
  }

  /**
   * Projects filter during focus: empty (focus is a workspace-only scope).
   * Outside focus: the real `projects` set.
   */
  effectiveProjects(): Set<string> {
    if (this.focusedWorkspaceSlug !== null) return new Set();
    return this.projects;
  }

  // ── Mutations ─────────────────────────────────────────────────────────

  /**
   * Toggle a workspace AND cascade to all its known projects: selecting a
   * workspace auto-selects all its projects, deselecting auto-deselects.
   * Project→workspace mapping comes from `projectWorkspaceMap` (populated
   * by Plaza via registerProjectWorkspaces when the projects query lands).
   * If the map is incomplete (e.g., user clicks before data loads), only
   * the workspace toggles — known projects cascade as they become known.
   */
  toggleWorkspace(slug: string): void {
    const nextWs = new Set(this.workspaces);
    const nextProjs = new Set(this.projects);
    const isAdding = !nextWs.has(slug);

    if (isAdding) nextWs.add(slug);
    else nextWs.delete(slug);

    for (const [projSlug, wsSlug] of this.projectWorkspaceMap) {
      if (wsSlug !== slug) continue;
      if (isAdding) nextProjs.add(projSlug);
      else nextProjs.delete(projSlug);
    }

    this.workspaces = nextWs;
    this.projects = nextProjs;
    this.navigate();
  }

  toggleProject(projectSlug: string, workspaceSlug: string): void {
    const next = new Set(this.projects);
    if (next.has(projectSlug)) next.delete(projectSlug);
    else next.add(projectSlug);
    this.projects = next;
    // Remember the workspace context for future URL serialization
    if (!this.projectWorkspaceMap.has(projectSlug)) {
      const nextMap = new Map(this.projectWorkspaceMap);
      nextMap.set(projectSlug, workspaceSlug);
      this.projectWorkspaceMap = nextMap;
    }
    this.navigate();
  }

  clear(): void {
    this.workspaces = new Set();
    this.projects = new Set();
    this.navigate();
  }

  // ── Queries ───────────────────────────────────────────────────────────

  isWorkspaceSelected(slug: string): boolean {
    return this.workspaces.has(slug);
  }

  isProjectSelected(slug: string): boolean {
    return this.projects.has(slug);
  }

  /** True if any selection is active (used by LineList to choose "all" vs "filtered"). */
  hasAnySelection(): boolean {
    return this.workspaces.size > 0 || this.projects.size > 0;
  }

  // ── Registry helper (called from Plaza after queries load) ───────────

  registerProjectWorkspaces(
    items: Iterable<{ slug: string; workspaceSlug: string }>,
  ): void {
    let changed = false;
    const next = new Map(this.projectWorkspaceMap);
    for (const { slug, workspaceSlug } of items) {
      if (next.get(slug) !== workspaceSlug) {
        next.set(slug, workspaceSlug);
        changed = true;
      }
    }
    if (changed) this.projectWorkspaceMap = next;
  }

  // ── URL serialization ────────────────────────────────────────────────

  /** Serialize current selection to a URL path. Picks canonical form when possible. */
  toUrl(): string {
    return this.serialize(this.workspaces, this.projects, this.projectWorkspaceMap);
  }

  /** Preview URL if a workspace toggle were applied — useful for href= on
      links. Mirrors toggleWorkspace's cascade: projects of the toggled
      workspace add/remove with it. */
  previewUrlAfterToggleWorkspace(slug: string): string {
    const nextWs = new Set(this.workspaces);
    const nextProjs = new Set(this.projects);
    const isAdding = !nextWs.has(slug);

    if (isAdding) nextWs.add(slug);
    else nextWs.delete(slug);

    for (const [projSlug, wsSlug] of this.projectWorkspaceMap) {
      if (wsSlug !== slug) continue;
      if (isAdding) nextProjs.add(projSlug);
      else nextProjs.delete(projSlug);
    }

    return this.serialize(nextWs, nextProjs, this.projectWorkspaceMap);
  }

  /** Preview URL if a project toggle were applied. */
  previewUrlAfterToggleProject(projectSlug: string, workspaceSlug: string): string {
    const next = new Set(this.projects);
    if (next.has(projectSlug)) next.delete(projectSlug);
    else next.add(projectSlug);
    // Ensure the map has the workspace context (needed for canonical URL)
    const map = new Map(this.projectWorkspaceMap);
    if (!map.has(projectSlug)) map.set(projectSlug, workspaceSlug);
    return this.serialize(this.workspaces, next, map);
  }

  private serialize(
    workspaces: Set<string>,
    projects: Set<string>,
    map: Map<string, string>,
  ): string {
    const ws = [...workspaces];
    const projs = [...projects];
    const ctx = this.contextWorkspaceSlug;

    // Canonical paths when selection collapses to a single entity
    if (ws.length === 0 && projs.length === 1) {
      const wSlug = map.get(projs[0]);
      if (wSlug) return `${ROUTE_PREFIX}/${wSlug}/project/${projs[0]}/`;
    }
    if (ws.length === 1 && projs.length === 1) {
      const wSlug = map.get(projs[0]);
      if (wSlug === ws[0]) return `${ROUTE_PREFIX}/${ws[0]}/project/${projs[0]}/`;
    }
    if (ws.length === 1 && projs.length === 0) {
      return `${ROUTE_PREFIX}/${ws[0]}/`;
    }

    // Empty selection — stay at the current browsing context.
    if (ws.length === 0 && projs.length === 0) {
      return ctx ? `${ROUTE_PREFIX}/${ctx}/` : `${ROUTE_PREFIX}/`;
    }

    // Multi-select — anchor on the current browsing context, selection
    // travels in query params. Fallback to first selected workspace if no
    // context is known (e.g. SSR or initial mount).
    const base = ctx ?? ws[0] ?? map.get(projs[0]) ?? '';
    const params = new URLSearchParams();
    if (ws.length) params.set('ws', ws.sort().join(','));
    if (projs.length) params.set('project', projs.sort().join(','));
    return base
      ? `${ROUTE_PREFIX}/${base}/?${params.toString()}`
      : `${ROUTE_PREFIX}/?${params.toString()}`;
  }

  // ── Hydration ────────────────────────────────────────────────────────

  /** Parse selection from current URL. Idempotent: skips state writes if unchanged. */
  hydrateFromUrl(url: URL): void {
    const parsed = this.parseUrl(url);
    // Always register implied project→workspace mappings if URL exposes them,
    // even when the URL is a sub-route that doesn't drive selection state.
    // Plaza needs them to render canonical URLs and on-path visual hints.
    for (const [projSlug, wsSlug] of parsed.impliedProjectWorkspaces) {
      if (this.projectWorkspaceMap.get(projSlug) !== wsSlug) {
        const next = new Map(this.projectWorkspaceMap);
        next.set(projSlug, wsSlug);
        this.projectWorkspaceMap = next;
      }
    }
    // Sub-routes (line detail, future show detail) signal "viewing inside a
    // project, not filtering by it" — selection state stays untouched.
    // Plaza uses URL-derived on-path class for the visual marker instead.
    if (parsed.keepSelection) return;
    if (
      setsEqual(parsed.workspaces, this.workspaces) &&
      setsEqual(parsed.projects, this.projects)
    ) {
      return;
    }
    this.workspaces = parsed.workspaces;
    this.projects = parsed.projects;
  }

  /** Try to restore from localStorage. Called when URL is /h/ with no params. */
  restoreFromLocalStorage(): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw) as PersistedSelection;
      const ws = Array.isArray(data.ws) ? data.ws.filter(s => typeof s === 'string') : [];
      const projs = Array.isArray(data.projects)
        ? data.projects.filter(p => p && typeof p.slug === 'string' && typeof p.ws === 'string')
        : [];
      if (ws.length === 0 && projs.length === 0) return false;
      this.workspaces = new Set(ws);
      this.projects = new Set(projs.map(p => p.slug));
      const next = new Map(this.projectWorkspaceMap);
      for (const p of projs) next.set(p.slug, p.ws);
      this.projectWorkspaceMap = next;
      return true;
    } catch {
      return false;
    }
  }

  // ── Internals ────────────────────────────────────────────────────────

  private parseUrl(url: URL): {
    workspaces: Set<string>;
    projects: Set<string>;
    impliedProjectWorkspaces: Array<[string, string]>;
    /** Sub-route (line detail, future show detail) — preserve existing selection. */
    keepSelection?: boolean;
  } {
    const path = url.pathname;
    const implied: Array<[string, string]> = [];
    const wsParam = url.searchParams.get('ws');
    const projParam = url.searchParams.get('project');
    const hasQueryFilter = Boolean(wsParam || projParam);

    // Query params take precedence: if user explicitly added ?ws= or ?project=,
    // they drive selection regardless of canonical path. Path is just context.
    if (hasQueryFilter) {
      const wss = wsParam ? wsParam.split(',').filter(Boolean) : [];
      const projs = projParam ? projParam.split(',').filter(Boolean) : [];
      return {
        workspaces: new Set(wss),
        projects: new Set(projs),
        impliedProjectWorkspaces: implied,
      };
    }

    // /h/[ws]/project/[slug]/<sub>/...  → sub-route (line detail, etc.)
    // Visiting a line/show within a project doesn't imply filtering by that
    // project. Existing selection preserved; project surfaces as on-path
    // visual hint via URL match in Plaza.
    const subRouteMatch = path.match(/^\/h\/([^/]+)\/project\/([^/]+)\/[^/]+/);
    if (subRouteMatch) {
      const [, ws, proj] = subRouteMatch;
      implied.push([proj, ws]);
      return {
        workspaces: new Set(),
        projects: new Set(),
        impliedProjectWorkspaces: implied,
        keepSelection: true,
      };
    }

    // /h/[ws]/project/[slug]/  (exact, no sub-route)  → 1 ws + 1 project filter
    const projectMatch = path.match(/^\/h\/([^/]+)\/project\/([^/]+)\/?$/);
    if (projectMatch) {
      const [, ws, proj] = projectMatch;
      implied.push([proj, ws]);
      return {
        workspaces: new Set([ws]),
        projects: new Set([proj]),
        impliedProjectWorkspaces: implied,
      };
    }

    // /h/[ws]/ with no query → 1 workspace selected (canonical)
    const wsMatch = path.match(/^\/h\/([^/]+)\/?$/);
    if (wsMatch) {
      return {
        workspaces: new Set([wsMatch[1]]),
        projects: new Set(),
        impliedProjectWorkspaces: implied,
      };
    }

    // /h/ (root) with no params → empty selection
    if (path === '/h/' || path === '/h') {
      return {
        workspaces: new Set(),
        projects: new Set(),
        impliedProjectWorkspaces: implied,
      };
    }

    // Other paths (e.g. /login, /booking): don't infer any selection
    return {
      workspaces: new Set(),
      projects: new Set(),
      impliedProjectWorkspaces: implied,
    };
  }

  private navigate(): void {
    this.persist();
    const target = this.toUrl();
    void goto(target, { replaceState: false, keepFocus: true, noScroll: true });
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const data: PersistedSelection = {
        ws: [...this.workspaces],
        projects: [...this.projects].map(slug => ({
          slug,
          ws: this.projectWorkspaceMap.get(slug) ?? '',
        })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Storage full or disabled — in-session state still works
    }
  }
}

const KEY = Symbol('selection');

export function provideSelection(): SelectionStore {
  const store = new SelectionStore();
  setContext(KEY, store);
  return store;
}

export function useSelection(): SelectionStore {
  const store = getContext<SelectionStore | undefined>(KEY);
  if (!store) {
    throw new Error('useSelection() called outside a SelectionStore provider');
  }
  return store;
}
