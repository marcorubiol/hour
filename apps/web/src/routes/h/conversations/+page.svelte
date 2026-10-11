<script lang="ts">
  /**
   * Conversations lens — Phase 0.3 item 1, v1 (ADR-044). The difusión work
   * surface inside the shell: conversation list filtered by the sidebar
   * selection (ADR-038 union; empty = everything RLS allows), free-text
   * search over person name/organization, status filter, and the ADR-040
   * inline editors via the shared ConversationTable.
   *
   * "Add conversation" (ADR-051) captures a person + conversation in one step:
   * POST /api/conversations with inline person fields — the RPC
   * find-or-creates the person on email, so re-typing a known email links
   * the existing file instead of duplicating it.
   */

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { fetchJSON, mutateJSON, ApiError } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import LensHeader from '$lib/components/LensHeader.svelte';
  import LensTitle from '$lib/components/LensTitle.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import ConversationTable from '$lib/components/ConversationTable.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { CONVERSATION_STATUSES, conversationWhoBody, statusLabel, type ConversationItem } from '$lib/conversation';
  import { appLocale, t } from '$lib/i18n';
  import { organizationNames, organizationsQueryOptions } from '$lib/organizations';
  import { usePins } from '$lib/stores/pins.svelte';
  import { spaceName } from '$lib/utils/identity';
  import {
    buildLineIndex,
    buildProjectIndex,
    resolveScope,
    projectsInScope,
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
  const locale = appLocale();

  const workspacesQuery = createQuery(workspacesQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  const organizationsQuery = createQuery(organizationsQueryOptions());

  let workspaces = $derived<NavWorkspace[]>($workspacesQuery.data?.items ?? []);
  let workspaceSlugById = $derived(new Map(workspaces.map((w) => [w.id, w.slug])));

  function personHref(item: ConversationItem): string | null {
    const workspaceSlug = workspaceSlugById.get(item.workspace_id);
    return workspaceSlug && item.person?.slug
      ? `/h/${workspaceSlug}/person/${item.person.slug}`
      : null;
  }

  /** ADR-102: the file of a conversation, also one without a person. */
  function conversationHref(item: ConversationItem): string | null {
    const workspaceSlug = workspaceSlugById.get(item.workspace_id);
    return workspaceSlug ? `/h/${workspaceSlug}/conversation/${item.id}` : null;
  }

  // ── Pins → scope (Adaptive Digest) ────────────────────────────────────
  let projectIndex = $derived(buildProjectIndex(workspaces, $projectsQuery.data?.items ?? []));
  let lineIndex = $derived(buildLineIndex(workspaces, ($linesQuery.data?.items as RawLine[]) ?? []));
  let scope = $derived(resolveScope(pins.pins, workspaces, lineIndex, projectIndex));
  // Project pins scope directly; a line pin scopes conversations through its
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

  // Debounced search — the raw input updates instantly, the query key
  // only after the pause.
  let qRaw = $state('');
  let q = $state('');
  $effect(() => {
    const next = qRaw;
    const timer = setTimeout(() => {
      q = next.trim();
    }, 300);
    return () => clearTimeout(timer);
  });

  let statusFilter = $state('any');
  let statusOptions = [
    { value: 'any', label: t('conversations.all_statuses', locale) },
    ...CONVERSATION_STATUSES.map((s) => ({ value: s, label: statusLabel(s, locale) })),
  ];

  // aria-busy: until the indexes answer, the pins cannot resolve and the
  // table would fetch the wrong slice. The table says its own busy below.
  let busy = $derived($workspacesQuery.isPending || $projectsQuery.isPending || $linesQuery.isPending);

  let filters = $derived({
    projectIds: filterIds.projectIds,
    workspaceIds: filterIds.workspaceIds,
    q: q || undefined,
    status: statusFilter,
    enabled: !scopeUnresolved,
  });

  // ── Add conversation (ADR-051) ────────────────────────────────────────
  const queryClient = useQueryClient();

  let addOpen = $state(false);
  // A contact can live in several spaces at once (person is global, deduped
  // on email; belonging to a space = an conversation in one of its projects).
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

  // The picker offers only the projects of the current scope (drop 11-10):
  // a space offers its projects, a project or line that project, Everything
  // all of them.
  let scopedProjects = $derived<RawProject[]>(
    projectsInScope(scope, $projectsQuery.data?.items ?? []),
  );
  // Projects grouped under the space (workspace) they belong to — the picker
  // reads as "which spaces (and which project inside them)".
  let projectGroups = $derived.by(() => {
    const wsName = new Map(workspaces.map((w) => [w.id, w.name]));
    const byWs = new Map<string, { wsId: string; wsName: string; projects: { id: string; name: string }[] }>();
    for (const p of scopedProjects) {
      let g = byWs.get(p.workspace_id);
      if (!g) {
        // Chokepoint: the only place this group's space label is built.
        g = { wsId: p.workspace_id, wsName: spaceName(wsName.get(p.workspace_id) ?? t('workspace.fallback', locale)), projects: [] };
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
  let addStatusOptions = CONVERSATION_STATUSES.map((s) => ({
    value: s,
    label: statusLabel(s, locale),
  }));

  function toggleProject(id: string) {
    aProjectIds = aProjectIds.includes(id)
      ? aProjectIds.filter((x) => x !== id)
      : [...aProjectIds, id];
  }

  // ADR-102: the organization completes from those of the chosen spaces (all
  // of yours while none is chosen).
  let orgSuggestions = $derived.by(() => {
    const chosen = new Set(aProjectIds);
    const wsIds = ($projectsQuery.data?.items ?? []).filter((p) => chosen.has(p.id)).map((p) => p.workspace_id);
    return organizationNames($organizationsQuery.data?.items ?? [], wsIds);
  });

  /** The 409 of a person whose organization already has a conversation in that
      project: offered as «Añadir como contacto» instead of «ya existía». */
  type Join = { conversationId: string; projectName: string };
  let aJoin = $state<Join[]>([]);
  let aJoinPersonId = $state<string | null>(null);

  function openAdd() {
    aJoin = [];
    aJoinPersonId = null;
    // Open fresh every time — leftover text from a cancelled attempt must
    // never ride into a new contact.
    aName = '';
    aEmail = '';
    aPhone = '';
    aOrg = '';
    aNextAt = '';
    aNextNote = '';
    aStatus = CONVERSATION_STATUSES[0];
    // Pre-select when the scope collapses to
    // a single project — otherwise start empty and let the user pick spaces.
    // A single pinned line also preselects that line for its project.
    aProjectIds =
      scope.lines.length === 1
        ? [scope.lines[0].projectId]
        : scopedProjects.length === 1
          ? [scopedProjects[0].id]
          : [];
    aLineByProject =
      scope.lines.length === 1 ? { [scope.lines[0].projectId]: scope.lines[0].id } : {};
    addOpen = true;
  }

  type AddResult = { created: number; existed: number; failed: string[]; joinable: Join[]; personId: string | null };

  const addMutation = createMutation({
    // One contact, N spaces → N conversations. Sequential, not parallel: the
    // first insert find-or-creates the person (by email) and returns its id;
    // every later insert links that same person_id. This keeps a no-email
    // contact from spawning a duplicate person per space, and avoids a race
    // on the citext-unique email.
    mutationFn: async (): Promise<AddResult> => {
      const targets = [...aProjectIds];
      const lineFor = { ...aLineByProject };
      // ADR-102: the person is optional; the organization alone is enough.
      const who = conversationWhoBody({ name: aName, email: aEmail, phone: aPhone, organization: aOrg }) ?? {};
      const base = {
        status: aStatus,
        next_action_at: aNextAt || null,
        next_action_note: aNextNote.trim() || null,
      };
      let personId: string | null = null;
      const out: AddResult = { created: 0, existed: 0, failed: [], joinable: [], personId: null };
      const projectName = (id: string) =>
        ($projectsQuery.data?.items ?? []).find((p) => p.id === id)?.name ?? t('conversations.conversation', locale);

      for (const projectId of targets) {
        const line_id = lineFor[projectId] || null;
        const body: Record<string, unknown> = personId
          ? { project_id: projectId, person_id: personId, line_id, ...base }
          : { project_id: projectId, ...who, line_id, ...base };
        try {
          const data = await mutateJSON<{ conversation?: { person_id?: string } }>(
            'POST',
            '/api/conversations',
            body,
          );
          out.created += 1;
          if (!personId && data?.conversation?.person_id) personId = data.conversation.person_id;
        } catch (e) {
          const clash = e instanceof ApiError && e.status === 409 ? e.body?.conversation_id : null;
          if (typeof clash === 'string' && ('person' in who || Boolean(personId))) {
            // Its organization already talks with this project: offer the
            // person as a contact of that conversation (ADR-102).
            out.joinable.push({ conversationId: clash, projectName: projectName(projectId) });
          } else if (e instanceof ApiError && e.status === 409) {
            // Already has a conversation in this project — not an error.
            out.existed += 1;
          } else {
            out.failed.push(e instanceof Error ? e.message : t('perf.unexpected', locale));
          }
        }
      }
      // Nothing landed and something broke → surface it as an error.
      out.personId = personId;
      if (out.created === 0 && out.existed === 0 && out.joinable.length === 0 && out.failed.length > 0) {
        throw new Error(out.failed[0]);
      }
      return out;
    },
    onSuccess: (r) => {
      if (r.joinable.length > 0) {
        // The dialog stays open with the offer; what was created is already in.
        aJoin = r.joinable;
        aJoinPersonId = r.personId;
        if (r.created) void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['organizations'] });
        return;
      }
      addOpen = false;
      aName = '';
      aEmail = '';
      aPhone = '';
      aOrg = '';
      aNextAt = '';
      aNextNote = '';
      aProjectIds = [];
      aLineByProject = {};
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      const parts: string[] = [];
      if (r.created)
        parts.push(
          t(r.created === 1 ? 'conversations.added_one' : 'conversations.added_other', locale, {
            n: r.created,
          }),
        );
      if (r.existed) parts.push(t('conversations.already_in', locale, { n: r.existed }));
      if (r.failed.length) parts.push(t('conversations.failed_n', locale, { n: r.failed.length }));
      addToast({
        tone: r.failed.length ? 'warning' : 'success',
        message: `${parts.join(' · ')}.`,
      });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('conversations.not_added', locale),
        message: `${err instanceof Error ? err.message : t('perf.unexpected', locale)}`,
      });
    },
  });

  const joinMutation = createMutation({
    mutationFn: async () => {
      const body = aJoinPersonId
        ? { person_id: aJoinPersonId }
        : { person: { full_name: aName.trim(), email: aEmail.trim() || null, phone: aPhone.trim() || null } };
      for (const j of aJoin) {
        await mutateJSON('POST', `/api/conversations/${j.conversationId}/contacts`, body);
      }
    },
    onSuccess: () => {
      addToast({ tone: 'success', message: t('conversations.contact_added', locale, { name: aName.trim() }) });
      addOpen = false;
      aJoin = [];
      aJoinPersonId = null;
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('conversations.not_added', locale),
        message: `${err instanceof Error ? err.message : t('perf.unexpected', locale)}`,
      });
    },
  });

  function submitAdd() {
    if (aProjectIds.length === 0) {
      addToast({ tone: 'warning', message: t('conversations.pick_space', locale) });
      return;
    }
    if (!aName.trim() && !aOrg.trim()) {
      addToast({ tone: 'warning', message: t('conversations.needs_name', locale) });
      return;
    }
    $addMutation.mutate();
  }
</script>

<svelte:head>
  <title>{t('lens.conversations', locale)} — Hour</title>
</svelte:head>

<section class="conversations" aria-busy={busy}>
  <LensHeader>
    {#snippet title()}<LensTitle text={t('lens.conversations', locale)} />{/snippet}
    <!-- TEMP sub — placeholder until this lens's real subtitle is defined. -->
    {#snippet sub()}<span class="lenshead__todo">temporal · define esta lente</span>{/snippet}
  </LensHeader>

  <div class="conversations__controls">
    <div class="conversations__search">
      <Input
        label={t('conversations.search', locale)}
        type="search"
        placeholder={t('conversations.search_ph', locale)}
        bind:value={qRaw}
      />
    </div>
    <Select label={t('edit.status', locale)} options={statusOptions} bind:value={statusFilter} />
    <Button size="s" onclick={openAdd}>{t('conversations.add', locale)}</Button>
  </div>

  <ConversationTable {filters} {personHref} {conversationHref} groupable importEmptyState />
</section>

<Dialog bind:open={addOpen} title={t('conversations.add', locale)} size="m">
  <p class="conversations__dialog-hint">{t('conversations.add_hint', locale)}</p>
  <fieldset class="conversations__spaces">
    <legend class="conversations__field-label">
      {t('picker.spaces', locale)} <span class="conversations__field-hint">{t('conversations.spaces_hint', locale)}</span>
    </legend>
    {#if projectGroups.length === 0}
      <p class="conversations__field-hint">{t('conversations.no_projects', locale)}</p>
    {:else}
      <div class="conversations__space-groups">
        {#each projectGroups as g (g.wsId)}
          <div class="conversations__space-group">
            <p class="conversations__space-name">{g.wsName}</p>
            {#each g.projects as p (p.id)}
              <Checkbox
                label={p.name}
                checked={aProjectIds.includes(p.id)}
                onchange={() => toggleProject(p.id)}
              />
              {#if aProjectIds.includes(p.id) && (linesByProject.get(p.id)?.length ?? 0) > 0}
                <div class="conversations__line">
                  <Select
                    label={t('create.line', locale)}
                    options={[{ value: '', label: t('create.line_none', locale) }, ...(linesByProject.get(p.id) ?? [])]}
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
  {#if aJoin.length > 0}
    <div class="conversations__join" role="status">
      <p>
        {t('conversations.org_has_conversation', locale, {
          org: aOrg.trim() || t('conversations.col_organization', locale),
          projects: aJoin.map((j) => j.projectName).join(', '),
        })}
      </p>
      <Button size="s" onclick={() => $joinMutation.mutate()} loading={$joinMutation.isPending}>
        {t('conversations.add_as_contact', locale)}
      </Button>
    </div>
  {/if}
  <div class="conversations__form-grid">
    <Input
      label={t('conversations.col_organization', locale)}
      bind:value={aOrg}
      placeholder={t('conversations.org_ph', locale)}
      list="conversations-org-list"
      autocomplete="off"
    />
    <datalist id="conversations-org-list">
      {#each orgSuggestions as name (name)}<option value={name}></option>{/each}
    </datalist>
    <Input label={t('conversations.full_name', locale)} bind:value={aName} />
    <Input label={t('conversations.email', locale)} type="email" bind:value={aEmail} />
    <Input label={t('conversations.phone', locale)} type="tel" bind:value={aPhone} />
    <Select label={t('edit.status', locale)} options={addStatusOptions} bind:value={aStatus} />
  </div>
  <div class="conversations__form-grid">
    <Input label={t('conversations.col_next_action', locale)} type="date" bind:value={aNextAt} />
    <Input
      label={t('conversations.next_note', locale)}
      bind:value={aNextNote}
      placeholder={t('conversations.next_note_ph', locale)}
    />
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (addOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={submitAdd} loading={$addMutation.isPending}>{t('conversations.add', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .conversations {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }

    /* Header is now the shared LensHeader (global .lenshead* classes). */
    .conversations__controls {
      display: flex;
      gap: var(--space-m);
      align-items: end;
      flex-wrap: wrap;
    }

    .conversations__search {
      flex: 1;
      min-inline-size: 16rem;
      max-inline-size: 28rem;
    }

    .conversations__join {
      display: flex;
      gap: var(--space-s);
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      margin-block-start: var(--space-m);
      padding: var(--space-s) var(--space-m);
      border: var(--border);
      border-radius: var(--radius-s);
      font-size: var(--text-s);
    }

    .conversations__dialog-hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    /* Multi-space picker — projects grouped under their space. */
    .conversations__spaces {
      border: 0;
      padding: 0;
      margin-block-start: var(--space-m);
    }
    .conversations__field-label {
      padding: 0;
      font-size: var(--text-s);
      color: var(--text-color);
    }
    .conversations__field-hint {
      color: var(--text-faint);
    }
    .conversations__space-groups {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: var(--space-s) var(--space-m);
      margin-block-start: var(--space-s);
    }
    .conversations__space-group {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }
    /* Per-project line select — indented under its project checkbox. */
    .conversations__line {
      margin-inline-start: var(--space-l);
      max-inline-size: 12rem;
    }

    .conversations__space-name {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.06em;
      /* No uppercase: this label is only ever a space name. */
      color: var(--text-faint);
      margin-block-end: var(--space-2xs);
    }

    .conversations__form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: var(--space-s) var(--space-m);
      margin-block-start: var(--space-s);
    }
  }
</style>
