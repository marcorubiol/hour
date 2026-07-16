<script lang="ts">
  /**
   * Contacts lens — Phase 0.3 item 1, v1 (ADR-044). The difusión work
   * surface inside the shell: engagement list filtered by the sidebar
   * selection (ADR-038 union; empty = everything RLS allows), free-text
   * search over person name/organization, status filter, and the ADR-040
   * inline editors via the shared EngagementTable.
   *
   * "Add contact" (ADR-051) captures a person + conversation in one step:
   * POST /api/engagements with inline person fields — the RPC
   * find-or-creates the person on email, so re-typing a known email links
   * the existing file instead of duplicating it.
   */

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { fetchJSON, mutateJSON, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import EngagementTable from '$lib/components/EngagementTable.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { ENGAGEMENT_STATUSES, statusLabel } from '$lib/engagement';
  import { usePins } from '$lib/stores/pins.svelte';
  import {
    buildLineIndex,
    buildProjectIndex,
    resolveScope,
    lineUrl,
    projectUrl,
    type NavLine,
    type NavProject,
    type NavWorkspace,
    type RawLine,
    type RawProject,
  } from '$lib/nav';
  import {
    workspacesQueryOptions,
    activeProjectsQueryOptions,
    allLinesQueryOptions,
  } from '$lib/nav-queries';

  const pins = usePins();

  const workspacesQuery = createQuery(workspacesQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());
  const projectsQuery = createQuery(activeProjectsQueryOptions());

  let workspaces = $derived<NavWorkspace[]>($workspacesQuery.data?.items ?? []);

  // ── Pins → scope (Adaptive Digest) ────────────────────────────────────
  let projectIndex = $derived(buildProjectIndex(workspaces, $projectsQuery.data?.items ?? []));
  let lineIndex = $derived(buildLineIndex(workspaces, ($linesQuery.data?.items as RawLine[]) ?? []));
  let scope = $derived(resolveScope(pins.pins, workspaces, lineIndex, projectIndex));
  // Project pins scope directly; a line pin scopes engagements through its
  // project. The endpoint filters by project_ids ∪ workspace_ids.
  let filterIds = $derived({
    projectIds: scope.projectIds,
    workspaceIds: scope.workspaceIds,
  });
  // Hold the feed while project/line pins exist but their caches haven't
  // resolved them yet (avoids flashing the unscoped everything-view).
  let scopeUnresolved = $derived(
    (pins.lineIds().length > 0 && scope.lines.length !== pins.lineIds().length) ||
      (pins.projectIds().length > 0 && scope.projects.length !== pins.projectIds().length),
  );

  function openLine(line: NavLine) {
    void goto(lineUrl(line));
  }
  function openProject(project: NavProject) {
    void goto(projectUrl(project));
  }

  // Debounced search — the raw input updates instantly, the query key
  // only after the pause.
  let qRaw = $state('');
  let q = $state('');
  $effect(() => {
    const next = qRaw;
    const t = setTimeout(() => {
      q = next.trim();
    }, 300);
    return () => clearTimeout(t);
  });

  let statusFilter = $state('any');
  let statusOptions = [
    { value: 'any', label: 'All statuses' },
    ...ENGAGEMENT_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
  ];

  let filters = $derived({
    projectIds: filterIds.projectIds,
    workspaceIds: filterIds.workspaceIds,
    q: q || undefined,
    status: statusFilter,
    enabled: !scopeUnresolved,
  });

  // ── Add contact (ADR-051) ────────────────────────────────────────────
  const queryClient = useQueryClient();

  let addOpen = $state(false);
  // A contact can live in several spaces at once (person is global, deduped
  // on email; belonging to a space = an engagement in one of its projects).
  // So the target is a SET of projects, grouped by space in the picker.
  let aProjectIds = $state<string[]>([]);
  // Optional line per targeted project (ADR-056) — the target is a set of
  // projects, so one global select can't work; each checked project gets its
  // own. Unset key = "No line".
  let aLineByProject = $state<Record<string, string>>({});
  let aName = $state('');
  let aEmail = $state('');
  let aPhone = $state('');
  let aOrg = $state('');
  let aStatus = $state('contacted');
  let aNextAt = $state('');
  let aNextNote = $state('');

  let allProjects = $derived<RawProject[]>($projectsQuery.data?.items ?? []);
  // Projects grouped under the space (workspace) they belong to — the picker
  // reads as "which spaces (and which project inside them)".
  let projectGroups = $derived.by(() => {
    const wsName = new Map(workspaces.map((w) => [w.id, w.name]));
    const byWs = new Map<string, { wsId: string; wsName: string; projects: { id: string; name: string }[] }>();
    for (const p of allProjects) {
      let g = byWs.get(p.workspace_id);
      if (!g) {
        g = { wsId: p.workspace_id, wsName: wsName.get(p.workspace_id) ?? 'Space', projects: [] };
        byWs.set(p.workspace_id, g);
      }
      g.projects.push({ id: p.id, name: p.name ?? p.slug });
    }
    return [...byWs.values()];
  });
  // Line options per project, from the same lines cache the scope resolver
  // reads (lineIndex) — only projects that actually have lines get a select.
  let linesByProject = $derived.by(() => {
    const byProject = new Map<string, { value: string; label: string }[]>();
    for (const l of lineIndex) {
      const opts = byProject.get(l.projectId);
      if (opts) opts.push({ value: l.id, label: l.name });
      else byProject.set(l.projectId, [{ value: l.id, label: l.name }]);
    }
    return byProject;
  });
  let addStatusOptions = ENGAGEMENT_STATUSES.map((s) => ({
    value: s,
    label: statusLabel(s),
  }));

  function toggleProject(id: string) {
    aProjectIds = aProjectIds.includes(id)
      ? aProjectIds.filter((x) => x !== id)
      : [...aProjectIds, id];
  }

  function openAdd() {
    // Open fresh every time — leftover text from a cancelled attempt must
    // never ride into a new contact.
    aName = '';
    aEmail = '';
    aPhone = '';
    aOrg = '';
    aNextAt = '';
    aNextNote = '';
    aStatus = ENGAGEMENT_STATUSES[0];
    // Pre-select when the pinned scope, or the whole workspace, collapses to
    // a single project — otherwise start empty and let the user pick spaces.
    // A single pinned line also preselects that line for its project.
    aProjectIds =
      scope.lines.length === 1
        ? [scope.lines[0].projectId]
        : allProjects.length === 1
          ? [allProjects[0].id]
          : [];
    aLineByProject =
      scope.lines.length === 1 ? { [scope.lines[0].projectId]: scope.lines[0].id } : {};
    addOpen = true;
  }

  type AddResult = { created: number; existed: number; failed: string[] };

  const addMutation = createMutation({
    // One contact, N spaces → N engagements. Sequential, not parallel: the
    // first insert find-or-creates the person (by email) and returns its id;
    // every later insert links that same person_id. This keeps a no-email
    // contact from spawning a duplicate person per space, and avoids a race
    // on the citext-unique email.
    mutationFn: async (): Promise<AddResult> => {
      const targets = [...aProjectIds];
      const lineFor = { ...aLineByProject };
      const person = {
        full_name: aName.trim(),
        email: aEmail.trim() || null,
        phone: aPhone.trim() || null,
        organization_name: aOrg.trim() || null,
      };
      const base = {
        status: aStatus,
        next_action_at: aNextAt || null,
        next_action_note: aNextNote.trim() || null,
      };
      let personId: string | null = null;
      const out: AddResult = { created: 0, existed: 0, failed: [] };

      for (const projectId of targets) {
        const line_id = lineFor[projectId] || null;
        const body: Record<string, unknown> = personId
          ? { project_id: projectId, person_id: personId, line_id, ...base }
          : { project_id: projectId, person, line_id, ...base };
        try {
          const data = await mutateJSON<{ engagement?: { person_id?: string } }>(
            'POST',
            '/api/engagements',
            body,
          );
          out.created += 1;
          if (!personId && data?.engagement?.person_id) personId = data.engagement.person_id;
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            // Already has a conversation in this project — not an error.
            out.existed += 1;
          } else {
            out.failed.push(e instanceof Error ? e.message : 'Unexpected error');
          }
        }
      }
      // Nothing landed and something broke → surface it as an error.
      if (out.created === 0 && out.existed === 0 && out.failed.length > 0) {
        throw new Error(out.failed[0]);
      }
      return out;
    },
    onSuccess: (r) => {
      addOpen = false;
      aName = '';
      aEmail = '';
      aPhone = '';
      aOrg = '';
      aNextAt = '';
      aNextNote = '';
      aProjectIds = [];
      aLineByProject = {};
      void queryClient.invalidateQueries({ queryKey: ['engagements'] });
      const parts: string[] = [];
      if (r.created) parts.push(`Added to ${r.created} ${r.created === 1 ? 'space' : 'spaces'}`);
      if (r.existed) parts.push(`already in ${r.existed}`);
      if (r.failed.length) parts.push(`${r.failed.length} failed`);
      addToast({
        tone: r.failed.length ? 'warning' : 'success',
        message: `${parts.join(' · ')}.`,
      });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Contact not added',
        message: `${err instanceof Error ? err.message : 'Unexpected error'}`,
      });
    },
  });

  function submitAdd() {
    if (aProjectIds.length === 0) {
      addToast({ tone: 'warning', message: 'Pick at least one space.' });
      return;
    }
    if (!aName.trim()) {
      addToast({ tone: 'warning', message: 'The contact needs a name.' });
      return;
    }
    $addMutation.mutate();
  }
</script>

<svelte:head>
  <title>Contacts — Hour</title>
</svelte:head>

<section class="contacts">
  <header class="contacts__head">
    <p class="eyebrow">Contacts</p>
    <div class="contacts__controls">
      <div class="contacts__search">
        <Input
          label="Search"
          type="search"
          placeholder="People or organizations…"
          bind:value={qRaw}
        />
      </div>
      <Select label="Status" options={statusOptions} bind:value={statusFilter} />
      <Button size="s" onclick={openAdd}>Add contact</Button>
    </div>
  </header>

  <EngagementTable {filters} personBase={`/h/${page.params.workspace}/person`} />
</section>

<Dialog bind:open={addOpen} title="Add contact" size="m">
  <p class="contacts__dialog-hint">
    Pick one or more spaces — the same contact lives in all of them. A known
    email links the same person across spaces instead of duplicating it.
  </p>
  <fieldset class="contacts__spaces">
    <legend class="contacts__field-label">
      Spaces <span class="contacts__field-hint">— where does this contact belong?</span>
    </legend>
    {#if projectGroups.length === 0}
      <p class="contacts__field-hint">No projects to add to yet.</p>
    {:else}
      <div class="contacts__space-groups">
        {#each projectGroups as g (g.wsId)}
          <div class="contacts__space-group">
            <p class="contacts__space-name">{g.wsName}</p>
            {#each g.projects as p (p.id)}
              <Checkbox
                label={p.name}
                checked={aProjectIds.includes(p.id)}
                onchange={() => toggleProject(p.id)}
              />
              {#if aProjectIds.includes(p.id) && (linesByProject.get(p.id)?.length ?? 0) > 0}
                <div class="contacts__line">
                  <Select
                    label="Line"
                    options={[{ value: '', label: 'No line' }, ...(linesByProject.get(p.id) ?? [])]}
                    bind:value={aLineByProject[p.id]}
                  />
                </div>
              {/if}
            {/each}
          </div>
        {/each}
      </div>
    {/if}
  </fieldset>
  <div class="contacts__form-grid">
    <Input label="Full name" bind:value={aName} required />
    <Input label="Organization" bind:value={aOrg} placeholder="Theatre, festival…" />
    <Input label="Email" type="email" bind:value={aEmail} />
    <Input label="Phone" type="tel" bind:value={aPhone} />
    <Select label="Status" options={addStatusOptions} bind:value={aStatus} />
  </div>
  <div class="contacts__form-grid">
    <Input label="Next action" type="date" bind:value={aNextAt} />
    <Input label="Next action note" bind:value={aNextNote} placeholder="Call back after summer…" />
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (addOpen = false)}>Cancel</Button>
    <Button onclick={submitAdd} loading={$addMutation.isPending}>Add contact</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .contacts {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }

    .contacts__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .contacts__controls {
      display: flex;
      gap: var(--space-m);
      align-items: end;
      flex-wrap: wrap;
    }

    .contacts__search {
      flex: 1;
      min-inline-size: 16rem;
      max-inline-size: 28rem;
    }

    .contacts__dialog-hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    /* Multi-space picker — projects grouped under their space. */
    .contacts__spaces {
      border: 0;
      padding: 0;
      margin-block-start: var(--space-m);
    }
    .contacts__field-label {
      padding: 0;
      font-size: var(--text-s);
      color: var(--text-color);
    }
    .contacts__field-hint {
      color: var(--text-faint);
    }
    .contacts__space-groups {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: var(--space-s) var(--space-m);
      margin-block-start: var(--space-s);
    }
    .contacts__space-group {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }
    /* Per-project line select — indented under its project checkbox. */
    .contacts__line {
      margin-inline-start: var(--space-l);
      max-inline-size: 12rem;
    }

    .contacts__space-name {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-faint);
      margin-block-end: var(--space-2xs);
    }

    .contacts__form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: var(--space-s) var(--space-m);
      margin-block-start: var(--space-s);
    }
  }
</style>
