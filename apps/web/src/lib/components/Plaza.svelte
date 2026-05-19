<script lang="ts">
  /**
   * Plaza — user-scoped sidebar tree, 2 levels.
   *
   * Renders ALL workspaces the user is a member of, with their projects
   * nested below. Each workspace row has a chevron (toggle collapse) and
   * a clickable name (navigate to workspace home). Each project row links
   * to the project detail at /h/[workspace]/project/[slug]/.
   *
   * Active state:
   *   - Project row matches URL → `--project-active` (filled background)
   *   - Workspace contains the active project → `--workspace-on-path`
   *     (primary tint on workspace name; ADR-029 trabajo #8 cross-highlight)
   *   - Workspace matches URL but no project selected → `--workspace-active`
   *
   * Collapse:
   *   - Default: all workspaces expanded
   *   - User toggle persisted in localStorage key
   *     `plaza_collapsed_workspaces` (array of workspace_ids)
   *   - Collapsed workspace hides its projects but keeps the row + chevron
   *
   * Lines (3rd level) live in <LineList /> sidebar lower, not here —
   * separates navigation (Plaza) from active project context (Lines).
   */

  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { accentVar, accentVarFor } from '$lib/utils/accent';
  import { useSelection } from '$lib/stores/selection.svelte';
  import Dialog from './Dialog.svelte';
  import Input from './Input.svelte';
  import Button from './Button.svelte';
  import Tooltip from './Tooltip.svelte';

  type Workspace = {
    id: string;
    slug: string;
    name: string;
    kind: 'personal' | 'team';
    accent?: string | null;
    description?: string | null;
  };

  type Project = {
    id: string;
    slug: string;
    name: string;
    status: 'draft' | 'active' | 'archived';
    workspace_id: string;
    accent?: string | null;
    description?: string | null;
  };

  const COLLAPSE_KEY = 'plaza_collapsed_workspaces';

  function clearAuthAndBounce() {
    localStorage.removeItem('hour_jwt');
    localStorage.removeItem('hour_refresh');
    localStorage.removeItem('hour_expires_at');
    goto('/login', { replaceState: true });
  }

  async function fetchJSON<T>(url: string, signal: AbortSignal): Promise<T> {
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) {
      clearAuthAndBounce();
      throw new Error('Missing JWT');
    }
    const res = await fetch(url, { signal, headers: { Authorization: `Bearer ${jwt}` } });
    if (res.status === 401) {
      clearAuthAndBounce();
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        detail?: string;
        error?: string;
      };
      throw new Error(body.detail || body.error || `Error ${res.status}`);
    }
    return (await res.json()) as T;
  }

  const workspacesQuery = createQuery({
    queryKey: ['workspaces'],
    queryFn: ({ signal }) => fetchJSON<{ items: Workspace[] }>('/api/workspaces', signal),
  });

  const projectsQuery = createQuery({
    queryKey: ['projects', { status: 'active' }],
    queryFn: ({ signal }) =>
      fetchJSON<{ items: Project[] }>('/api/projects?status=active', signal),
  });

  const selection = useSelection();

  // On-path: the workspace + project implied by the current URL when
  // viewing a sub-route (line detail, future show detail). NOT a selection;
  // visual marker only. SelectionStore.parseUrl preserves the existing
  // filter when on sub-routes, so this state surfaces independently.
  let onPathProjectSlug = $derived.by(() => {
    const m = page.url.pathname.match(/^\/h\/[^/]+\/project\/([^/]+)\/[^/]+/);
    return m?.[1] ?? '';
  });
  let onPathWorkspaceSlug = $derived.by(() => {
    const m = page.url.pathname.match(/^\/h\/([^/]+)\/project\/[^/]+\/[^/]+/);
    return m?.[1] ?? '';
  });

  let workspaces = $derived($workspacesQuery.data?.items ?? []);
  let projects = $derived($projectsQuery.data?.items ?? []);

  // Active scope from URL — drives the row/project highlighting.
  let activeWorkspaceSlug = $derived(page.params.workspace ?? '');
  let activeProjectSlug = $derived.by(() => {
    const m = page.url.pathname.match(/^\/h\/[^/]+\/project\/([^/]+)/);
    return m?.[1] ?? '';
  });

  // Focus: pinned to SelectionStore. Tree filter accounts for both kinds:
  //  · workspace focus → only that workspace's row, all its projects
  //  · project focus   → only the project's workspace row, only that project
  let tree = $derived.by(() => {
    const all = workspaces.map((workspace) => ({
      workspace,
      projects: projects.filter((p) => p.workspace_id === workspace.id),
    }));
    const wsFocus = selection.focusedWorkspaceSlug;
    const projFocus = selection.focusedProjectSlug;
    if (wsFocus == null) return all;
    const filtered = all.filter((t) => t.workspace.slug === wsFocus);
    if (projFocus == null) return filtered;
    return filtered.map((t) => ({
      ...t,
      projects: t.projects.filter((p) => p.slug === projFocus),
    }));
  });

  function toggleFocus(workspaceSlug: string) {
    // Click on focus icon: toggle workspace focus. If a project is focused,
    // clicking workspace focus exits to the workspace level (set workspace
    // focus, clears project focus).
    const isOnlyWsFocused =
      selection.focusedWorkspaceSlug === workspaceSlug &&
      selection.focusedProjectSlug === null;
    selection.setFocus(isOnlyWsFocused ? null : workspaceSlug);
  }

  function toggleProjectFocus(projectSlug: string, workspaceSlug: string) {
    const isThisFocused = selection.focusedProjectSlug === projectSlug;
    selection.setProjectFocus(isThisFocused ? null : projectSlug, workspaceSlug);
  }

  let loading = $derived($workspacesQuery.isPending || $projectsQuery.isPending);
  let errored = $derived($workspacesQuery.isError || $projectsQuery.isError);

  // Register project→workspace mappings so SelectionStore can build canonical
  // URLs for projects even when navigating from query-params form.
  $effect(() => {
    if (workspaces.length === 0 || projects.length === 0) return;
    const wsById = new Map(workspaces.map((w) => [w.id, w.slug]));
    const items: Array<{ slug: string; workspaceSlug: string }> = [];
    for (const p of projects) {
      const wsSlug = wsById.get(p.workspace_id);
      if (wsSlug) items.push({ slug: p.slug, workspaceSlug: wsSlug });
    }
    selection.registerProjectWorkspaces(items);
  });

  // Collapse state — set of workspace ids that are collapsed.
  let collapsedIds = $state<Set<string>>(new Set());

  onMount(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr) && arr.every((x) => typeof x === 'string')) {
          collapsedIds = new Set(arr);
        }
      }
    } catch {
      // Bad payload — ignore, fall back to default (all expanded).
    }
  });

  function toggleCollapse(workspaceId: string) {
    const next = new Set(collapsedIds);
    if (next.has(workspaceId)) next.delete(workspaceId);
    else next.add(workspaceId);
    collapsedIds = next;
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // Storage full or disabled — collapse state still works in-session.
    }
  }

  // Collapse-all / expand-all toggle. Icon stays the same in both
  // directions; only the tooltip + action flip based on whether
  // everything's already collapsed. The button itself is always present
  // (hover-reveal on the Places header).
  let allCollapsed = $derived(
    workspaces.length > 0 && workspaces.every((w) => collapsedIds.has(w.id)),
  );

  function toggleAllCollapsed() {
    const next: Set<string> = allCollapsed
      ? new Set()
      : new Set(workspaces.map((w) => w.id));
    collapsedIds = next;
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // ignore
    }
  }


  // ── Add workspace ─────────────────────────────────────────────────────
  // First in-page creation flow. The + button next to the "Places" eyebrow
  // opens a minimal dialog (name only); the server derives the slug and
  // wires the workspace under the caller's personal account. On success we
  // invalidate the ['workspaces'] query, wait for the refetch so the new
  // row is in cache, then navigate so the user lands on the new workspace.
  const queryClient = useQueryClient();
  let dialogOpen = $state(false);
  let formName = $state('');
  let formAccent = $state<string | null>(null); // null = auto (hash of name)
  let formDescription = $state('');
  let formError = $state<string | null>(null);

  // Auto-preview: what color would the hash assign right now? Updates live
  // as the name is typed. Once the user clicks a swatch, formAccent locks
  // and this becomes informational only (the locked swatch wins).
  let autoAccentSlug = $derived(formName.trim() || 'workspace');
  let activeAccent = $derived(formAccent ?? `auto:${autoAccentSlug}`);

  type CreateInput = {
    name: string;
    accent: string | null;
    description: string;
  };

  const createWorkspaceMutation = createMutation({
    mutationFn: async (input: CreateInput) => {
      const jwt = localStorage.getItem('hour_jwt');
      if (!jwt) {
        clearAuthAndBounce();
        throw new Error('Missing JWT');
      }
      const reqBody: Record<string, string> = { name: input.name };
      if (input.accent) reqBody.accent = input.accent;
      if (input.description.trim()) reqBody.description = input.description.trim();
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(reqBody),
      });
      if (res.status === 401) {
        clearAuthAndBounce();
        throw new Error('Unauthorized');
      }
      const resBody = (await res.json().catch(() => ({}))) as {
        workspace?: Workspace;
        detail?: string;
        error?: string;
      };
      if (!res.ok || !resBody.workspace) {
        throw new Error(resBody.detail || resBody.error || `Error ${res.status}`);
      }
      return resBody.workspace;
    },
    onSuccess: async (workspace) => {
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      await queryClient.refetchQueries({ queryKey: ['workspaces'] });
      dialogOpen = false;
      formName = '';
      formAccent = null;
      formDescription = '';
      formError = null;
      await goto(`/h/${workspace.slug}/`);
    },
    onError: (err) => {
      formError = err instanceof Error ? err.message : 'Could not create workspace';
    },
  });

  function openCreate() {
    formName = '';
    formAccent = null;
    formDescription = '';
    formError = null;
    dialogOpen = true;
  }

  function submitCreate(event: Event) {
    event.preventDefault();
    const name = formName.trim();
    if (!name) {
      formError = 'Name cannot be empty';
      return;
    }
    formError = null;
    $createWorkspaceMutation.mutate({
      name,
      accent: formAccent,
      description: formDescription,
    });
  }

  // ── Add project ───────────────────────────────────────────────────────
  // Mirrors the workspace flow but scoped to a specific workspace. The +
  // button on each workspace row opens this dialog with the workspace id
  // pre-filled. Same field shape (name + accent + description). Status is
  // forced to 'active' server-side (RPC default), not exposed in UI.
  let projDialogOpen = $state(false);
  let projTargetWorkspace = $state<Workspace | null>(null);
  let projFormName = $state('');
  let projFormAccent = $state<string | null>(null);
  let projFormDescription = $state('');
  let projFormError = $state<string | null>(null);

  let projAutoAccentSlug = $derived(projFormName.trim() || 'project');

  type CreateProjectInput = {
    workspace_id: string;
    name: string;
    accent: string | null;
    description: string;
  };

  const createProjectMutation = createMutation({
    mutationFn: async (input: CreateProjectInput) => {
      const jwt = localStorage.getItem('hour_jwt');
      if (!jwt) {
        clearAuthAndBounce();
        throw new Error('Missing JWT');
      }
      const reqBody: Record<string, string> = {
        workspace_id: input.workspace_id,
        name: input.name,
      };
      if (input.accent) reqBody.accent = input.accent;
      if (input.description.trim()) reqBody.description = input.description.trim();
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(reqBody),
      });
      if (res.status === 401) {
        clearAuthAndBounce();
        throw new Error('Unauthorized');
      }
      const resBody = (await res.json().catch(() => ({}))) as {
        project?: Project;
        detail?: string;
        error?: string;
      };
      if (!res.ok || !resBody.project) {
        throw new Error(resBody.detail || resBody.error || `Error ${res.status}`);
      }
      return resBody.project;
    },
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ['projects', { status: 'active' }] });
      await queryClient.refetchQueries({ queryKey: ['projects', { status: 'active' }] });
      projDialogOpen = false;
      projFormName = '';
      projFormAccent = null;
      projFormDescription = '';
      projFormError = null;
      const wsSlug = projTargetWorkspace?.slug;
      projTargetWorkspace = null;
      if (wsSlug) await goto(`/h/${wsSlug}/project/${project.slug}/`);
    },
    onError: (err) => {
      projFormError = err instanceof Error ? err.message : 'Could not create project';
    },
  });

  function openCreateProject(workspace: Workspace) {
    projTargetWorkspace = workspace;
    projFormName = '';
    projFormAccent = null;
    projFormDescription = '';
    projFormError = null;
    projDialogOpen = true;
  }

  function submitCreateProject(event: Event) {
    event.preventDefault();
    const name = projFormName.trim();
    if (!name) {
      projFormError = 'Name cannot be empty';
      return;
    }
    if (!projTargetWorkspace) return;
    projFormError = null;
    $createProjectMutation.mutate({
      workspace_id: projTargetWorkspace.id,
      name,
      accent: projFormAccent,
      description: projFormDescription,
    });
  }

  // ── Add line ──────────────────────────────────────────────────────────
  // + button on each project row opens a dialog to create a line under
  // that project. Mirrors create_project flow: name + color (palette) +
  // description. Server defaults kind='other'.
  let lineDialogOpen = $state(false);
  let lineTargetProject = $state<Project | null>(null);
  let lineTargetWorkspaceSlug = $state<string>('');
  let lineFormName = $state('');
  let lineFormAccent = $state<string | null>(null);
  let lineFormDescription = $state('');
  let lineFormError = $state<string | null>(null);

  let lineAutoAccentSlug = $derived(lineFormName.trim() || 'line');

  type CreateLineInput = {
    project_id: string;
    name: string;
    accent: string | null;
    description: string;
  };

  const createLineMutation = createMutation({
    mutationFn: async (input: CreateLineInput) => {
      const jwt = localStorage.getItem('hour_jwt');
      if (!jwt) {
        clearAuthAndBounce();
        throw new Error('Missing JWT');
      }
      const reqBody: Record<string, string> = {
        project_id: input.project_id,
        name: input.name,
      };
      if (input.accent) reqBody.accent = input.accent;
      if (input.description.trim()) reqBody.description = input.description.trim();
      const res = await fetch('/api/lines', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(reqBody),
      });
      if (res.status === 401) {
        clearAuthAndBounce();
        throw new Error('Unauthorized');
      }
      const resBody = (await res.json().catch(() => ({}))) as {
        line?: { id: string; name: string };
        detail?: string;
        error?: string;
      };
      if (!res.ok || !resBody.line) {
        throw new Error(resBody.detail || resBody.error || `Error ${res.status}`);
      }
      return resBody.line;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['lines'] });
      await queryClient.refetchQueries({ queryKey: ['lines'] });
      lineDialogOpen = false;
      lineFormName = '';
      lineFormAccent = null;
      lineFormDescription = '';
      lineFormError = null;
      lineTargetProject = null;
      lineTargetWorkspaceSlug = '';
    },
    onError: (err) => {
      lineFormError = err instanceof Error ? err.message : 'Could not create line';
    },
  });

  function openCreateLine(project: Project, workspaceSlug: string) {
    lineTargetProject = project;
    lineTargetWorkspaceSlug = workspaceSlug;
    lineFormName = '';
    lineFormAccent = null;
    lineFormDescription = '';
    lineFormError = null;
    lineDialogOpen = true;
  }

  function submitCreateLine(event: Event) {
    event.preventDefault();
    const name = lineFormName.trim();
    if (!name) {
      lineFormError = 'Name cannot be empty';
      return;
    }
    if (!lineTargetProject) return;
    lineFormError = null;
    $createLineMutation.mutate({
      project_id: lineTargetProject.id,
      name,
      accent: lineFormAccent,
      description: lineFormDescription,
    });
  }
</script>

<nav class="plaza" aria-label="Places">
  <div class="plaza__header">
    <p class="eyebrow plaza__eyebrow">Places</p>
    <div class="plaza__header-actions">
      <Tooltip
        text={allCollapsed ? 'Expand all' : 'Collapse all'}
        position="left"
        delay={400}
      >
        <button
          type="button"
          class="plaza__add"
          aria-label={allCollapsed ? 'Expand all workspaces' : 'Collapse all workspaces'}
          aria-pressed={allCollapsed}
          onclick={toggleAllCollapsed}
        >
          <!-- Single icon for both directions — inward arrows. The
               tooltip + action change with state, the symbol doesn't. -->
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4 14h6v6" />
            <path d="M20 10h-6V4" />
            <path d="m14 10 7-7" />
            <path d="m3 21 7-7" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip text="Add place" position="left" delay={400}>
        <button
          type="button"
          class="plaza__add"
          aria-label="Add workspace"
          onclick={openCreate}
        >
          <svg
            viewBox="0 0 14 14"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M7 2 V12" />
            <path d="M2 7 H12" />
          </svg>
        </button>
      </Tooltip>
    </div>
  </div>

  {#if loading}
    <p class="plaza__state">Loading…</p>
  {:else if errored}
    <p class="plaza__state plaza__state--danger">Couldn't load projects.</p>
  {:else if tree.length === 0}
    <p class="plaza__state">No projects yet.</p>
  {:else}
    <ul class="plaza__list" role="list">
      {#each tree as { workspace, projects } (workspace.id)}
        {@const isCollapsed = collapsedIds.has(workspace.id)}
        {@const isWorkspaceSelected = selection.isWorkspaceSelected(workspace.slug)}
        {@const isWorkspaceOnPath =
          !isWorkspaceSelected && workspace.slug === onPathWorkspaceSlug}
        {@const hasProjects = projects.length > 0}
        {@const isFocused = selection.focusedWorkspaceSlug === workspace.slug}
        <li
          class={[
            'plaza__workspace',
            isWorkspaceSelected && 'plaza__workspace--selected',
            isWorkspaceOnPath && 'plaza__workspace--on-path',
          ]
            .filter(Boolean)
            .join(' ')}
          style={`--c: ${accentVarFor(workspace)}`}>
          <div
            class={[
              'plaza__workspace-row',
              isWorkspaceSelected && 'plaza__workspace-row--selected',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <a
              class="plaza__workspace-link"
              href={selection.previewUrlAfterToggleWorkspace(workspace.slug)}
              aria-current={isWorkspaceSelected ? "true" : undefined}
              title={isWorkspaceSelected
                ? `Deselect ${workspace.name}`
                : `Select ${workspace.name}`}
            >
              <span class="plaza__workspace-name">{workspace.name}</span>
              <span class="plaza__workspace-sub">
                {workspace.kind === 'personal' ? 'Personal workspace' : 'Team workspace'}
              </span>
            </a>
            <div
              class={[
                'plaza__workspace-actions',
                isFocused && 'plaza__workspace-actions--pinned',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {#if !isFocused}
                <Tooltip
                  text={isCollapsed ? 'Expand' : 'Collapse'}
                  position="left"
                  delay={400}
                >
                  <button
                    type="button"
                    class={['plaza__chevron', isCollapsed && 'plaza__chevron--collapsed']
                      .filter(Boolean)
                      .join(' ')}
                    aria-label={isCollapsed
                      ? `Expand ${workspace.name}`
                      : `Collapse ${workspace.name}`}
                    aria-expanded={!isCollapsed}
                    onclick={() => toggleCollapse(workspace.id)}
                  >
                    {#if isCollapsed}
                      <!-- Expand: arrows OUT — clicking opens projects. -->
                      <svg
                        viewBox="0 0 24 24"
                        width="11"
                        height="11"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M15 3h6v6" />
                        <path d="M9 21H3v-6" />
                        <path d="M21 3 14 10" />
                        <path d="M3 21l7-7" />
                      </svg>
                    {:else}
                      <!-- Collapse: arrows IN — clicking folds projects. -->
                      <svg
                        viewBox="0 0 24 24"
                        width="11"
                        height="11"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4 14h6v6" />
                        <path d="M20 10h-6V4" />
                        <path d="m14 10 7-7" />
                        <path d="m3 21 7-7" />
                      </svg>
                    {/if}
                  </button>
                </Tooltip>
                <Tooltip text="Settings" position="left" delay={400}>
                  <a
                    class="plaza__row-icon plaza__settings"
                    href={`/h/${workspace.slug}/settings`}
                    aria-label={`Settings for ${workspace.name}`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="12"
                      height="12"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <!-- Sliders horizontal: 3 rails + 3 handles at varied
                           positions. Reads as "tune / adjust" — fits the
                           Phase 0 settings page (colors, names, prefs). -->
                      <path d="M21 4 H14" />
                      <path d="M10 4 H3" />
                      <path d="M21 12 H12" />
                      <path d="M8 12 H3" />
                      <path d="M21 20 H16" />
                      <path d="M12 20 H3" />
                      <circle cx="12" cy="4" r="2" />
                      <circle cx="10" cy="12" r="2" />
                      <circle cx="14" cy="20" r="2" />
                    </svg>
                  </a>
                </Tooltip>
                <Tooltip text="Add project" position="left" delay={400}>
                  <button
                    type="button"
                    class="plaza__row-icon plaza__add-project"
                    aria-label={`Add project to ${workspace.name}`}
                    onclick={() => openCreateProject(workspace)}
                  >
                    <svg
                      viewBox="0 0 14 14"
                      width="11"
                      height="11"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      aria-hidden="true"
                    >
                      <path d="M7 2 V12" />
                      <path d="M2 7 H12" />
                    </svg>
                  </button>
                </Tooltip>
              {/if}
              <Tooltip
                text={isFocused ? 'Exit focus' : 'Focus'}
                position="left"
                delay={400}
              >
                <button
                  type="button"
                  class={[
                    'plaza__row-icon',
                    'plaza__focus',
                    isFocused && 'plaza__focus--on',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-label={isFocused
                    ? `Exit focus on ${workspace.name}`
                    : `Focus ${workspace.name}`}
                  aria-pressed={isFocused}
                  onclick={() => toggleFocus(workspace.slug)}
                >
                  <svg
                    viewBox="0 0 14 14"
                    width="11"
                    height="11"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.4"
                    aria-hidden="true"
                  >
                    <circle cx="7" cy="7" r="4.5" />
                    <circle cx="7" cy="7" r="1.2" fill="currentColor" />
                  </svg>
                </button>
              </Tooltip>
            </div>
          </div>

          {#if !isCollapsed && !hasProjects}
            <div class="plaza__empty">
              <p class="plaza__empty-msg">No projects yet.</p>
              <button
                type="button"
                class="plaza__empty-action"
                onclick={() => openCreateProject(workspace)}
              >
                Add new project
              </button>
            </div>
          {/if}
          {#if !isCollapsed && hasProjects}
            <ul class="plaza__projects" role="list">
              {#each projects as project (project.id)}
                {@const isProjectSelected = selection.isProjectSelected(project.slug)}
                {@const isProjectOnPath =
                  !isProjectSelected && project.slug === onPathProjectSlug}
                {@const isProjectFocused = selection.focusedProjectSlug === project.slug}
                <li
                  class={[
                    'plaza__project-row',
                    isProjectSelected && 'plaza__project-row--selected',
                    isProjectOnPath && 'plaza__project-row--on-path',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <a
                    class="plaza__project"
                    href={selection.previewUrlAfterToggleProject(
                      project.slug,
                      workspace.slug,
                    )}
                    aria-current={isProjectSelected ? "true" : undefined}
                    title={isProjectSelected
                      ? `Deselect ${project.name}`
                      : `Select ${project.name}`}
                  >
                    <span class="plaza__project-name">{project.name}</span>
                  </a>
                  <div
                    class={[
                      'plaza__project-actions',
                      isProjectFocused && 'plaza__project-actions--pinned',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {#if !isProjectFocused}
                      <Tooltip text="Settings" position="left" delay={400}>
                        <a
                          class="plaza__row-icon plaza__settings"
                          href={`/h/${workspace.slug}/project/${project.slug}/`}
                          aria-label={`Settings for ${project.name}`}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="12"
                            height="12"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M21 4 H14" />
                            <path d="M10 4 H3" />
                            <path d="M21 12 H12" />
                            <path d="M8 12 H3" />
                            <path d="M21 20 H16" />
                            <path d="M12 20 H3" />
                            <circle cx="12" cy="4" r="2" />
                            <circle cx="10" cy="12" r="2" />
                            <circle cx="14" cy="20" r="2" />
                          </svg>
                        </a>
                      </Tooltip>
                      <Tooltip text="Add line" position="left" delay={400}>
                        <button
                          type="button"
                          class="plaza__row-icon plaza__add-line"
                          aria-label={`Add line to ${project.name}`}
                          onclick={() => openCreateLine(project, workspace.slug)}
                        >
                          <svg
                            viewBox="0 0 14 14"
                            width="11"
                            height="11"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                            stroke-linecap="round"
                            aria-hidden="true"
                          >
                            <path d="M7 2 V12" />
                            <path d="M2 7 H12" />
                          </svg>
                        </button>
                      </Tooltip>
                    {/if}
                    <Tooltip
                      text={isProjectFocused ? 'Exit focus' : 'Focus'}
                      position="left"
                      delay={400}
                    >
                      <button
                        type="button"
                        class={[
                          'plaza__row-icon',
                          'plaza__focus',
                          isProjectFocused && 'plaza__focus--on',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        aria-label={isProjectFocused
                          ? `Exit focus on ${project.name}`
                          : `Focus ${project.name}`}
                        aria-pressed={isProjectFocused}
                        onclick={() => toggleProjectFocus(project.slug, workspace.slug)}
                      >
                        <svg
                          viewBox="0 0 14 14"
                          width="11"
                          height="11"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.4"
                          aria-hidden="true"
                        >
                          <circle cx="7" cy="7" r="4.5" />
                          <circle cx="7" cy="7" r="1.2" fill="currentColor" />
                        </svg>
                      </button>
                    </Tooltip>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</nav>

<Dialog
  bind:open={dialogOpen}
  title="New workspace"
  description="A workspace groups your projects under your personal account."
  size="s"
  onclose={() => {
    formName = '';
    formAccent = null;
    formDescription = '';
    formError = null;
  }}
>
  {#snippet children()}
    <form class="plaza__form" onsubmit={submitCreate}>
      <Input
        label="Name"
        name="workspace-name"
        bind:value={formName}
        placeholder="e.g. Side projects"
        required
        autofocus
        autocomplete="off"
        error={formError ?? undefined}
        disabled={$createWorkspaceMutation.isPending}
      />

      <!-- Color picker: 8 swatches mapped to --accent-1..--accent-8.
           Auto is implicit — when no swatch is selected, the form submits
           accent=null and the server derives via hash(slug). Live preview
           below tells the user which one Auto would pick. -->
      <fieldset class="plaza__swatches">
        <legend>Color</legend>
        <div
          class="plaza__swatch-grid"
          role="radiogroup"
          aria-label="Workspace color"
        >
          {#each [1, 2, 3, 4, 5, 6, 7, 8] as n (n)}
            {@const isOn = formAccent === String(n)}
            <button
              type="button"
              role="radio"
              aria-checked={isOn}
              class={['plaza__swatch', isOn && 'plaza__swatch--on']
                .filter(Boolean)
                .join(' ')}
              style={`background: var(--accent-${n})`}
              aria-label={`Color ${n}`}
              disabled={$createWorkspaceMutation.isPending}
              onclick={() => (formAccent = isOn ? null : String(n))}
            ></button>
          {/each}
        </div>
        <p class="plaza__swatch-hint">
          {#if formAccent}
            <button
              type="button"
              class="plaza__swatch-clear"
              onclick={() => (formAccent = null)}
              disabled={$createWorkspaceMutation.isPending}
            >Clear · use auto</button>
          {:else}
            <span class="plaza__swatch-auto">
              <span
                class="plaza__swatch-auto-chip"
                style={`background: ${accentVar(autoAccentSlug)}`}
                aria-hidden="true"
              ></span>
              Auto from name
            </span>
          {/if}
        </p>
      </fieldset>

      <label class="field">
        <span>Description</span>
        <textarea
          class="plaza__desc"
          bind:value={formDescription}
          maxlength="280"
          rows="3"
          placeholder="Optional. What is this workspace for?"
          disabled={$createWorkspaceMutation.isPending}
        ></textarea>
        <p class="field__msg field__msg--quiet">
          {formDescription.length} / 280
        </p>
      </label>

      <!-- Hidden submit lets Enter inside the input trigger submit. -->
      <button type="submit" hidden aria-hidden="true"></button>
    </form>
  {/snippet}
  {#snippet actions()}
    <Button
      variant="outline"
      size="s"
      disabled={$createWorkspaceMutation.isPending}
      onclick={() => (dialogOpen = false)}
    >
      Cancel
    </Button>
    <Button
      variant="primary"
      size="s"
      loading={$createWorkspaceMutation.isPending}
      onclick={submitCreate}
    >
      Create
    </Button>
  {/snippet}
</Dialog>

<Dialog
  bind:open={projDialogOpen}
  title="New project"
  description={projTargetWorkspace
    ? `Adds a project under ${projTargetWorkspace.name}.`
    : 'Adds a project under the selected workspace.'}
  size="s"
  onclose={() => {
    projFormName = '';
    projFormAccent = null;
    projFormDescription = '';
    projFormError = null;
    projTargetWorkspace = null;
  }}
>
  {#snippet children()}
    <form class="plaza__form" onsubmit={submitCreateProject}>
      <Input
        label="Name"
        name="project-name"
        bind:value={projFormName}
        placeholder="e.g. Spring tour"
        required
        autofocus
        autocomplete="off"
        error={projFormError ?? undefined}
        disabled={$createProjectMutation.isPending}
      />

      <fieldset class="plaza__swatches">
        <legend>Color</legend>
        <div
          class="plaza__swatch-grid"
          role="radiogroup"
          aria-label="Project color"
        >
          {#each [1, 2, 3, 4, 5, 6, 7, 8] as n (n)}
            {@const isOn = projFormAccent === String(n)}
            <button
              type="button"
              role="radio"
              aria-checked={isOn}
              class={['plaza__swatch', isOn && 'plaza__swatch--on']
                .filter(Boolean)
                .join(' ')}
              style={`background: var(--accent-${n})`}
              aria-label={`Color ${n}`}
              disabled={$createProjectMutation.isPending}
              onclick={() => (projFormAccent = isOn ? null : String(n))}
            ></button>
          {/each}
        </div>
        <p class="plaza__swatch-hint">
          {#if projFormAccent}
            <button
              type="button"
              class="plaza__swatch-clear"
              onclick={() => (projFormAccent = null)}
              disabled={$createProjectMutation.isPending}
            >Clear · use auto</button>
          {:else}
            <span class="plaza__swatch-auto">
              <span
                class="plaza__swatch-auto-chip"
                style={`background: ${accentVar(projAutoAccentSlug)}`}
                aria-hidden="true"
              ></span>
              Auto from name
            </span>
          {/if}
        </p>
      </fieldset>

      <label class="field">
        <span>Description</span>
        <textarea
          class="plaza__desc"
          bind:value={projFormDescription}
          maxlength="280"
          rows="3"
          placeholder="Optional. What is this project about?"
          disabled={$createProjectMutation.isPending}
        ></textarea>
        <p class="field__msg field__msg--quiet">
          {projFormDescription.length} / 280
        </p>
      </label>

      <button type="submit" hidden aria-hidden="true"></button>
    </form>
  {/snippet}
  {#snippet actions()}
    <Button
      variant="outline"
      size="s"
      disabled={$createProjectMutation.isPending}
      onclick={() => (projDialogOpen = false)}
    >
      Cancel
    </Button>
    <Button
      variant="primary"
      size="s"
      loading={$createProjectMutation.isPending}
      onclick={submitCreateProject}
    >
      Create
    </Button>
  {/snippet}
</Dialog>

<Dialog
  bind:open={lineDialogOpen}
  title="New line"
  description={lineTargetProject
    ? `Adds a line under ${lineTargetProject.name}.`
    : 'Adds a line under the selected project.'}
  size="s"
  onclose={() => {
    lineFormName = '';
    lineFormAccent = null;
    lineFormDescription = '';
    lineFormError = null;
    lineTargetProject = null;
    lineTargetWorkspaceSlug = '';
  }}
>
  {#snippet children()}
    <form class="plaza__form" onsubmit={submitCreateLine}>
      <Input
        label="Name"
        name="line-name"
        bind:value={lineFormName}
        placeholder="e.g. Spring 2027 tour"
        required
        autofocus
        autocomplete="off"
        error={lineFormError ?? undefined}
        disabled={$createLineMutation.isPending}
      />

      <fieldset class="plaza__swatches">
        <legend>Color</legend>
        <div class="plaza__swatch-grid" role="radiogroup" aria-label="Line color">
          {#each [1, 2, 3, 4, 5, 6, 7, 8] as n (n)}
            {@const isOn = lineFormAccent === String(n)}
            <button
              type="button"
              role="radio"
              aria-checked={isOn}
              class={['plaza__swatch', isOn && 'plaza__swatch--on']
                .filter(Boolean)
                .join(' ')}
              style={`background: var(--accent-${n})`}
              aria-label={`Color ${n}`}
              disabled={$createLineMutation.isPending}
              onclick={() => (lineFormAccent = isOn ? null : String(n))}
            ></button>
          {/each}
        </div>
        <p class="plaza__swatch-hint">
          {#if lineFormAccent}
            <button
              type="button"
              class="plaza__swatch-clear"
              onclick={() => (lineFormAccent = null)}
              disabled={$createLineMutation.isPending}
            >Clear · use auto</button>
          {:else}
            <span class="plaza__swatch-auto">
              <span
                class="plaza__swatch-auto-chip"
                style={`background: ${accentVar(lineAutoAccentSlug)}`}
                aria-hidden="true"
              ></span>
              Auto from name
            </span>
          {/if}
        </p>
      </fieldset>

      <label class="field">
        <span>Description</span>
        <textarea
          class="plaza__desc"
          bind:value={lineFormDescription}
          maxlength="280"
          rows="3"
          placeholder="Optional. What is this line about?"
          disabled={$createLineMutation.isPending}
        ></textarea>
        <p class="field__msg field__msg--quiet">
          {lineFormDescription.length} / 280
        </p>
      </label>

      <button type="submit" hidden aria-hidden="true"></button>
    </form>
  {/snippet}
  {#snippet actions()}
    <Button
      variant="outline"
      size="s"
      disabled={$createLineMutation.isPending}
      onclick={() => (lineDialogOpen = false)}
    >
      Cancel
    </Button>
    <Button
      variant="primary"
      size="s"
      loading={$createLineMutation.isPending}
      onclick={submitCreateLine}
    >
      Create
    </Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .plaza {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    /* Header row: eyebrow on the start, + button on the end. The button
       stays subtle (faint until hover) so it doesn't compete with the
       workspace rows for attention — discoverable on intent, quiet
       otherwise. */
    .plaza__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-inline: var(--space-s);
    }

    .plaza__header-actions {
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }

    .plaza__eyebrow {
      margin: 0;
    }

    /* Hover-reveal — matches the workspace-row icons. Hidden at rest;
       appears when the user hovers the header line OR focuses the button
       by keyboard. Keeps the sidebar quiet by default and consistent
       with the per-row icons (chevron is the only always-visible affordance). */
    .plaza__add {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: 18px;
      block-size: 18px;
      padding: 0;
      background: var(--bg-ultra-light);
      border: 0;
      border-radius: var(--radius-s);
      color: var(--text-faint);
      cursor: pointer;
      opacity: 0;
      pointer-events: none;
      transition:
        opacity var(--transition),
        color var(--transition),
        background-color var(--transition);
    }

    .plaza__header:hover .plaza__add,
    .plaza__header:focus-within .plaza__add {
      opacity: 1;
      pointer-events: auto;
    }

    .plaza__add:hover,
    .plaza__add:focus-visible {
      color: var(--text-color);
      background: var(--bg-hover);
    }

    .plaza__add:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 2px;
    }

    .plaza__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }

    /* Color picker — 8 round swatches in a single row. Selected state is
       a ring around the dot, not a border on the dot itself, so the
       palette color reads cleanly at all sizes. */
    .plaza__swatches {
      border: 0;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .plaza__swatches > legend {
      padding: 0;
      font-size: var(--text-s);
      color: var(--text-color);
    }

    .plaza__swatch-grid {
      display: flex;
      gap: var(--space-xs);
      flex-wrap: wrap;
    }

    .plaza__swatch {
      inline-size: 22px;
      block-size: 22px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 0 0 1px var(--border-color-light) inset;
      transition: box-shadow var(--transition), transform var(--transition);
    }

    .plaza__swatch:hover:not(:disabled) {
      transform: scale(1.08);
    }

    .plaza__swatch:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 2px;
    }

    .plaza__swatch--on {
      box-shadow:
        0 0 0 2px var(--bg),
        0 0 0 4px var(--text-color);
    }

    .plaza__swatch:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .plaza__swatch-hint {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--text-faint);
      min-block-size: 1.2em;
    }

    .plaza__swatch-auto {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
    }

    .plaza__swatch-auto-chip {
      inline-size: 10px;
      block-size: 10px;
      border-radius: 50%;
      box-shadow: 0 0 0 1px var(--border-color-light) inset;
    }

    .plaza__swatch-clear {
      background: transparent;
      border: 0;
      padding: 0;
      font-family: inherit;
      font-size: var(--text-xs);
      color: var(--text-muted);
      cursor: pointer;
      text-decoration: underline dotted;
      text-underline-offset: 2px;
    }

    .plaza__swatch-clear:hover {
      color: var(--text-color);
    }

    .plaza__desc {
      inline-size: 100%;
      padding: var(--space-xs) var(--space-s);
      font-family: inherit;
      font-size: var(--text-s);
      color: var(--text-color);
      background: var(--bg);
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius);
      resize: vertical;
      min-block-size: 5em;
    }

    .plaza__desc:focus {
      outline: none;
      border-color: var(--text-muted);
    }

    .plaza__desc:disabled {
      opacity: 0.6;
    }

    .field__msg--quiet {
      color: var(--text-faint);
      font-size: var(--text-xs);
      text-align: end;
      margin: 0;
    }

    .plaza__list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      /* Workspace-to-workspace breathing — bumped from xs to m so each
         workspace block reads as a distinct unit, not a list of rows. */
      gap: var(--space-m);
    }

    .plaza__workspace {
      display: flex;
      flex-direction: column;
      position: relative;
      /* Visual breathing room from the sidebar's trailing edge so the
         selected/hover bg + border-radius can read as a card instead
         of bleeding into the panel border. */
      margin-inline-end: var(--space-xs);
    }

    /* Accent rail: 2px vertical bar spanning the full height of the
       workspace block (row + nested projects ul). Lives as a ::before
       on the <li> wrapper so it extends past the workspace row down
       through the projects list. Color comes from accentVar(workspace.slug). */
    .plaza__workspace::before {
      content: '';
      position: absolute;
      inset-block: var(--space-xs);
      inset-inline-start: 0;
      inline-size: 2px;
      background: var(--c, var(--text-muted));
      border-radius: 2px;
      pointer-events: none;
    }

    .plaza__workspace-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: var(--space-xs);
      /* Align all children to the top of the row so the actions cluster
         sits next to the workspace name (line 1), not vertically centered
         against the 2-line stack — that read as "icons floating between
         lines". The cluster controls its own block-size to match the
         name's line height (see .plaza__workspace-actions below). */
      align-items: start;
      padding-block: var(--space-xs);
      padding-inline-start: calc(var(--space-s) + 2px);
      padding-inline-end: var(--space-s);
      border-radius: var(--radius);
      transition: background-color var(--transition);
    }
    /* Original document order is chevron-then-link, but visually we want
       the link (name + sub) on the leading edge and the chevron at the
       trailing edge. Reverse order via grid-template-areas, or simpler:
       just place link in col 1 and chevron in col 2 via order. Cleanest
       is reordering the template — done in the markup with link before
       chevron. (Comment kept here to document the column intent.) */

    /* Hover on the workspace row paints the WHOLE workspace block (row +
       nested projects ul) — same full-height concept as the accent rail
       and on-path. Uses :has() on the <li> to scope the hover to the
       direct workspace-row child only, NOT to project-row hovers in the
       nested ul. Project hover keeps its own row-level rule. */
    /* Hover/selected pair: same accent overlay concept, different opacity
       so the hierarchy reads — hover is a very subtle "anticipation" of
       the selected state, selected is firmer (but still subtle vs. the
       canvas). Both inherit the workspace's accent via `--c`, so each
       workspace shows its own hue on hover/select. Lowered from
       4/8/12% to 3/4/8% (editorial-sobrio refinement): the rail does
       most of the identity work; the bg tint stays as a quiet confirm
       of state without flooding the row. */
    .plaza__workspace:not(.plaza__workspace--selected):has(
        > .plaza__workspace-row:hover
      ) {
      background: color-mix(in oklch, var(--c) 3%, transparent);
      border-radius: var(--radius);
    }

    .plaza__workspace--selected {
      background: color-mix(in oklch, var(--c) 4%, transparent);
      border-radius: var(--radius);
    }

    /* Hover on a selected workspace: bg drops from --c 4% (selected) to
       --c 3% (same as the hover on an unselected workspace). The lighter
       tint reads as "the accent is letting go" — preview of the deselect
       — while staying inside the same accent spectrum (no jump to
       neutral that would mimic the deselected state). State stays
       readable via rail + name font-weight 600, not the bg. Mirrors the
       project row's hover-on-selected behaviour for consistency. */
    .plaza__workspace--selected:has(> .plaza__workspace-row:hover) {
      background: color-mix(in oklch, var(--c) 3%, transparent);
    }

    /* Selected workspace name: weight bump from 500 → 600 communicates
       state typographically instead of via colour tint. Removing the
       earlier accent-darkened text frees up a colour channel — the rail
       + bg already carry the identity; the heavier weight carries the
       selection. */
    .plaza__workspace-row--selected .plaza__workspace-name {
      font-weight: 600;
    }

    /* On-path: URL points inside this workspace's project sub-route
       (e.g. line detail). 2px primary inline-start line extends top-to-
       bottom across the WHOLE workspace block (row + nested projects ul)
       because it lives on the <li> wrapper, not the inner row. Visual
       marker only — never a selection state. */
    .plaza__workspace--on-path {
      box-shadow: inset 2px 0 0 var(--primary);
    }

    /* Chevron lives inside the tinted pill alongside the other icons →
       uses --c for icon colour and a soft tint on hover. */
    /* Neutral action cluster — no "pill" wrapper. Each icon carries its
       own quiet grey square; the cluster just lays them out. Hidden
       icons use `display: none` (not opacity) so the cluster contracts
       to fit visible ones — pinned icons snap to the right edge of the
       row cleanly instead of sitting in their default column with
       invisible siblings reserving space. Two modifier pins:
         · --collapsed: chevron always visible (only way to expand back)
         · --pinned:    only Focus rendered (markup-level {#if}) */
    .plaza__workspace-actions {
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }

    .plaza__row-icon,
    .plaza__chevron {
      display: none;
      align-items: center;
      justify-content: center;
      inline-size: 18px;
      block-size: 18px;
      padding: 0;
      background: var(--bg-ultra-light);
      border: 0;
      border-radius: var(--radius-s);
      color: var(--text-faint);
      text-decoration: none;
      cursor: pointer;
      transition:
        background-color var(--transition),
        color var(--transition);
    }

    .plaza__workspace-row:hover .plaza__row-icon,
    .plaza__workspace-row:hover .plaza__chevron,
    .plaza__workspace-row:has(:focus-visible) .plaza__row-icon,
    .plaza__workspace-row:has(:focus-visible) .plaza__chevron,
    .plaza__project-row:hover .plaza__row-icon,
    .plaza__project-row:has(:focus-visible) .plaza__row-icon {
      display: inline-flex;
    }

    /* Project actions cluster — same layout pattern as workspace actions,
       same hover-reveal behavior via .plaza__row-icon. */
    .plaza__project-actions {
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }

    .plaza__project-actions--pinned .plaza__focus {
      display: inline-flex;
    }

    /* Right-edge fade on the workspace/project name — the text mask
       fades to transparent in the last ~24px, so when the icons overlap
       (narrow sidebar) the text dissolves into the row's actual bg
       (whatever colour it is in that state) instead of being abruptly
       covered. Painting a fixed-colour strip behind the icons clashed
       with tinted row states (hover, selected), so the fade lives on
       the TEXT — the row's bg shows through naturally underneath. */
    .plaza__workspace-link,
    .plaza__project {
      mask-image: linear-gradient(
        to right,
        black calc(100% - 24px),
        transparent
      );
      -webkit-mask-image: linear-gradient(
        to right,
        black calc(100% - 24px),
        transparent
      );
    }

    .plaza__row-icon:hover,
    .plaza__row-icon:focus-visible,
    .plaza__chevron:hover,
    .plaza__chevron:focus-visible {
      background: var(--bg-hover);
      color: var(--text-color);
    }

    .plaza__row-icon:focus-visible,
    .plaza__chevron:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 1px;
    }

    .plaza__workspace-actions--pinned .plaza__focus {
      display: inline-flex;
    }

    /* Focus active state — same neutral language; slightly darker bg
       signals "this is what's holding focus." */
    .plaza__focus--on {
      background: var(--bg-hover);
      color: var(--text-color);
    }

    .plaza__focus--on:hover,
    .plaza__focus--on:focus-visible {
      background: var(--bg-active);
      color: var(--text-color);
    }

    .plaza__workspace-link {
      display: flex;
      flex-direction: column;
      /* No gap — line-heights on name + sub already control vertical
         rhythm. Adding gap here pushed the sub away from the name
         enough that the row looked like two separate items. */
      gap: 0;
      min-inline-size: 0;
      color: var(--text-color);
      text-decoration: none;
    }

    .plaza__workspace-link:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 2px;
      border-radius: var(--radius);
    }

    .plaza__workspace-name {
      font-family: var(--font-display);
      font-size: var(--text-m);
      font-weight: 500;
      letter-spacing: -0.01em;
      /* Tight line-height: the name + sub stack feels compact and the
         actions cluster height (1lh of this line-height) sits exactly
         where the name reads. */
      line-height: 1.2;
      color: var(--text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .plaza__workspace-sub {
      font-size: var(--text-xs);
      line-height: 1.2;
      color: var(--text-faint);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .plaza__projects {
      list-style: none;
      margin: 0;
      /* Align projects under the workspace name: same inline-start padding
         as .plaza__workspace-row (rail width + standard inline padding).
         Trailing air comes from the li's margin-inline-end inherited from
         the workspace wrapper. */
      padding-inline-start: calc(var(--space-s) + 2px);
      padding-block-start: var(--space-xs);
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    /* Empty state — quiet message + an inline text button to add the
       first project. Sits where the projects list would, indented to
       align with project rows. Both elements vanish when the workspace
       is collapsed (the empty block is gated by !isCollapsed). */
    .plaza__empty {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding-inline-start: calc(var(--space-s) + 2px + var(--space-s));
      padding-block-start: var(--space-xs);
    }

    .plaza__empty-msg {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--text-faint);
      font-style: italic;
    }

    .plaza__empty-action {
      align-self: flex-start;
      padding: 0;
      background: transparent;
      border: 0;
      font-family: inherit;
      font-size: var(--text-xs);
      color: var(--text-muted);
      cursor: pointer;
      text-decoration: underline dotted;
      text-underline-offset: 3px;
      transition: color var(--transition);
    }

    .plaza__empty-action:hover,
    .plaza__empty-action:focus-visible {
      color: var(--text-color);
    }

    .plaza__empty-action:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 2px;
      border-radius: var(--radius-s);
    }

    /* Project row container — link on the left, actions cluster on the
       right. Mirrors the workspace-row layout pattern. The --selected /
       --on-path modifiers now live on the row (the <li>), not on the
       link itself, so the actions cluster shares the tinted bg. */
    .plaza__project-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: var(--space-xs);
      align-items: center;
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      border-radius: var(--radius);
      transition: background-color var(--transition);
    }

    .plaza__project {
      display: block;
      color: var(--text-color);
      text-decoration: none;
      min-inline-size: 0;
    }

    .plaza__project:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: -2px;
      border-radius: var(--radius-s);
    }

    .plaza__project-row:not(.plaza__project-row--selected):hover {
      background: color-mix(in oklch, var(--c) 4%, transparent);
    }

    /* Project row --selected uses the same accent-tinted mix as workspace,
       inheriting --c from the parent workspace <li>. */
    .plaza__project-row--selected {
      background: color-mix(in oklch, var(--c) 8%, transparent);
    }

    /* Hover on a selected project: bg drops from --c 8% (selected) to
       --c 4% (same as the hover on an unselected project). The lighter
       tint reads as "the accent is letting go" — preview of the deselect
       — while staying inside the same accent spectrum (no jump to
       neutral that would mimic the deselected state). State stays
       readable because font-weight + opacity carry it, not the bg. */
    .plaza__project-row--selected:hover,
    .plaza__workspace--selected .plaza__project-row--selected:hover {
      background: color-mix(in oklch, var(--c) 4%, transparent);
    }

    /* Inside a selected workspace, manually-deselected project rows dim. */
    .plaza__workspace--selected .plaza__project-row:not(.plaza__project-row--selected) .plaza__project {
      opacity: 0.4;
      font-style: italic;
    }

    /* Inside a selected workspace, the parent's bg already covers this row. */
    .plaza__workspace--selected .plaza__project-row--selected {
      background: transparent;
    }

    /* On-path: URL is inside this project's sub-route. */
    .plaza__project-row--on-path {
      box-shadow: inset 2px 0 0 var(--primary);
    }

    .plaza__workspace--on-path .plaza__project-row--on-path {
      box-shadow: none;
    }

    /* Same accent-tinted rule for selected project names (inherits --c
       from the parent workspace li). */
    .plaza__project-row--selected .plaza__project-name {
      color: color-mix(in oklch, var(--c), black 30%);
    }

    .plaza__project-name {
      font-size: var(--text-s);
      /* Explicit tight line-height — kills the ~1.5 inherited from base
         that made project rows look spaced even though their padding is
         already minimal. Click target preserved via padding-block xs on
         .plaza__project. */
      line-height: 1.3;
      color: var(--text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }


    .plaza__state {
      margin: 0;
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      font-size: var(--text-s);
      color: var(--text-faint);
    }

    .plaza__state--danger {
      color: var(--danger);
    }
  }
</style>
