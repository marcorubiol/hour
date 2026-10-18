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
   *
   * Selection mode (envío en bloque, plan § 10): checkboxes over the filtered
   * list and a bar «Escribir a N», which creates the draft (POST /api/mailout)
   * and opens the mailout screen. A mailout belongs to one project, so the
   * bar asks for conversations of a single project.
   *
   * Two projections (ADR-106, patrón ADR-076), neither secondary: «con quién
   * hablas» (this list, difusión) and «de qué se habla» (`?view=threads`, the
   * internal threads the viewer can read, ThreadFeed; ADR-116). Same scope.
   *
   * «Con quién hablas» opens on its dashboard (ADR-117, propuesta A): the
   * ConversationOverview blocks above the list. Each block is a filter of the
   * list, carried in the URL (`?turno=`, `?temp=`, `?temporada=actual`) and
   * shown as a removable chip; «Escribir a estas» preloads the selection.
   */

  import { docTitle } from '$lib/doc-title';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { fetchJSON, mutateJSON, ApiError } from '$lib/api';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import Button from '$lib/components/Button.svelte';
  import LensHeader from '$lib/components/LensHeader.svelte';
  import LensTitle from '$lib/components/LensTitle.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import ConversationTable from '$lib/components/ConversationTable.svelte';
  import ConversationOverview from '$lib/components/ConversationOverview.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import { tick } from 'svelte';
  import { toStore } from 'svelte/store';
  import { parseListFilter } from '$lib/conversation-overview';
  import ThreadFeed from '$lib/components/ThreadFeed.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import {
    CONVERSATION_STATUSES,
    conversationWhoBody,
    statusLabel,
    type ConversationItem,
    type ConversationStatus,
  } from '$lib/conversation';
  import { appLocale, t } from '$lib/i18n';
  import { organizationNames, organizationsQueryOptions } from '$lib/organizations';
  import { conversationAccessQueryOptions } from '$lib/conversation-access';
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
  // ADR-124: without `read` in any project the lens says so; without `edit`
  // it offers no add, select or import, and never asks for the directory (the
  // autocomplete of «Añadir», which RLS no longer gives without Converses).
  // Only an explicit «no» hides: while pending or on failure it shows.
  const accessQuery = createQuery(conversationAccessQueryOptions());
  let noAccess = $derived($accessQuery.data?.read === false);
  let canEdit = $derived($accessQuery.data?.edit !== false);
  // The directory, though, waits for an explicit yes.
  const organizationsQuery = createQuery(
    toStore(() => organizationsQueryOptions($accessQuery.data?.edit === true)),
  );

  let workspaces = $derived<NavWorkspace[]>($workspacesQuery.data?.items ?? []);
  let workspaceSlugById = $derived(new Map(workspaces.map((w) => [w.id, w.slug])));
  let projectNameById = $derived(
    new Map(($projectsQuery.data?.items ?? []).map((p) => [p.id, p.name ?? p.slug])),
  );

  /** The projection travels in the URL, so a link says which one it shows. */
  let view = $derived<'people' | 'threads'>(page.url.searchParams.get('view') === 'threads' ? 'threads' : 'people');

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

  // The status travels in the URL too (`?estado=`, ADR-126 § 4): a block's
  // link carries only its own filter, so following one clears the status and
  // the list counts what the block counts; a season segment carries both.
  let statusFilter = $derived.by(() => {
    const raw = page.url.searchParams.get('estado');
    return raw && (CONVERSATION_STATUSES as readonly string[]).includes(raw) ? raw : 'any';
  });

  function setStatus(next: string) {
    const params = new URLSearchParams(page.url.searchParams);
    if (next === 'any') params.delete('estado');
    else params.set('estado', next);
    const qs = params.toString();
    void goto(`${page.url.pathname}${qs ? `?${qs}` : ''}`, { noScroll: true, keepFocus: true, replaceState: true });
  }

  // ── Dashboard filters (ADR-117): in the URL, so a block's link is the filter ──
  let listFilter = $derived(parseListFilter(page.url.searchParams));
  let lineIds = $derived(scope.lines.map((l) => l.id));
  const TEMP_CHIP: Record<string, string> = {
    caliente: 'overview.hot',
    fria: 'overview.cold',
    ronda: 'overview.cold_round_chip',
    parada: 'overview.cold_stalled_chip',
    'sin-fecha': 'overview.undated_chip',
  };
  /** The chip names the block filter the list wears; a season segment, with its status. */
  function chipLabel(f: typeof listFilter, status: string): string | null {
    if (f.temporada && status !== 'any') {
      return `${statusLabel(status as ConversationStatus, locale)} · ${t('overview.this_season', locale).toLowerCase()}`;
    }
    if (f.turno === 'nuestro') return t('overview.due', locale);
    if (f.turno === 'suyo') return t('overview.turn_theirs_cap', locale);
    if (f.temp) return t(TEMP_CHIP[f.temp], locale);
    if (f.envio && f.r) return t(f.r === 'respuestas' ? 'overview.mailout_replies_chip' : 'overview.mailout_bounced_chip', locale);
    return f.temporada ? t('overview.this_season', locale) : null;
  }
  let filterChip = $derived(chipLabel(listFilter, statusFilter));

  function clearListFilter() {
    const params = new URLSearchParams(page.url.searchParams);
    // A season segment is status + season: its chip names both, and goes as one.
    if (listFilter.temporada) params.delete('estado');
    for (const k of ['turno', 'temp', 'temporada', 'envio', 'r']) params.delete(k);
    const qs = params.toString();
    // The chip goes away with the focus on it: the focus goes to the list.
    void goto(`${page.url.pathname}${qs ? `?${qs}` : ''}`, { noScroll: true, keepFocus: true }).then(() =>
      listHeading?.focus({ preventScroll: true }),
    );
  }

  // After a filter the focus lands on the list's title, not on `body`: the
  // next Tab goes into the list, not back to the top (móvil #3).
  let listHeading = $state<HTMLElement>();
  async function showList() {
    await tick();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('lista')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    listHeading?.focus({ preventScroll: true });
  }
  // A block's link (`?turno=nuestro#lista`) is a plain link: the browser
  // scrolls, the focus follows here.
  afterNavigate(({ to }) => {
    if (to?.url.hash === '#lista') listHeading?.focus({ preventScroll: true });
  });

  /** A season segment: that status, in the season (and the pinned lines). */
  async function filterSeasonStatus(status: ConversationStatus) {
    await goto(`?temporada=actual&estado=${status}`, { noScroll: true, keepFocus: true });
    await showList();
  }

  /** «Escribir a estas»: the cooling list, already picked, ready for «Escribir a N». */
  async function writeTo(picks: { id: string; project_id: string }[]) {
    picking = true;
    picked = picks;
    await goto('?temp=ronda', { noScroll: true, keepFocus: true });
    await showList();
  }
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
    ...listFilter,
    lineIds,
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
    if (aProjectIds.includes(id)) {
      aProjectIds = aProjectIds.filter((x) => x !== id);
      return;
    }
    // The line Select binds `aLineByProject[id]`: binding `undefined` to a
    // prop with a fallback throws (svelte props_invalid_value), so a checked
    // project always has a key; '' is «No line».
    aLineByProject = { ...aLineByProject, [id]: aLineByProject[id] ?? '' };
    aProjectIds = [...aProjectIds, id];
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
      scope.lines.length === 1
        ? { [scope.lines[0].projectId]: scope.lines[0].id }
        : Object.fromEntries(aProjectIds.map((id) => [id, '']));
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
          const data = await mutateJSON<{ primary_person_id?: string | null }>(
            'POST',
            '/api/conversations',
            body,
          );
          out.created += 1;
          if (!personId && data?.primary_person_id) personId = data.primary_person_id;
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

  // ── Selection → mailout (plan § 10) ───────────────────────────────────
  let picking = $state(false);
  let table = $state<ReturnType<typeof ConversationTable>>();
  let picked = $state<Pick<ConversationItem, 'id' | 'project_id'>[]>([]);
  let pickedProjects = $derived([...new Set(picked.map((c) => c.project_id))]);

  function togglePicking() {
    picking = !picking;
    picked = [];
  }

  const writeMutation = createMutation({
    mutationFn: () =>
      mutateJSON<{ id: string; workspace_slug: string }>('POST', '/api/mailout', {
        project_id: pickedProjects[0],
        conversation_ids: picked.map((c) => c.id),
      }),
    onSuccess: (r) => {
      if (r) void goto(`/h/${r.workspace_slug}/mailout/${r.id}`);
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('mailout.not_created', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
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
  <title>{docTitle(t('lens.conversations', locale))}</title>
</svelte:head>

<section class="conversations" aria-busy={busy}>
  <LensHeader>
    {#snippet title()}<LensTitle text={t('lens.conversations', locale)} />{/snippet}
    {#snippet sub()}
      <a class="lenshead__frag" href="/h/conversations" aria-current={view === 'people' ? 'page' : undefined}
        >{t('conversations.view_who', locale)}</a
      >
      <a class="lenshead__frag" href="/h/conversations?view=threads" aria-current={view === 'threads' ? 'page' : undefined}
        >{t('conversations.view_what', locale)}</a
      >
      {#if view === 'people'}
        <!-- On a phone the list starts a screen and a half down: a way straight to it (móvil #11). -->
        <a class="lenshead__frag conversations__skip" href="#lista">{t('overview.go_to_list', locale)}</a>
      {/if}
    {/snippet}
  </LensHeader>

  {#if view === 'threads'}
    <ThreadFeed
      filters={{ projectIds: filterIds.projectIds, workspaceIds: filterIds.workspaceIds, enabled: !scopeUnresolved }}
      {workspaceSlugById}
      {projectNameById}
      {locale}
    />
  {:else if noAccess}
    <p class="conversations__state" data-testid="conversations-no-access">{t('conversations.no_access', locale)}</p>
  {:else}
    <ConversationOverview
      filters={{ projectIds: filterIds.projectIds, workspaceIds: filterIds.workspaceIds, lineIds, enabled: !scopeUnresolved }}
      {workspaceSlugById}
      {projectNameById}
      {locale}
      onstatus={filterSeasonStatus}
      onwrite={canEdit ? writeTo : undefined}
    />

    <div class="conversations__list-head" id="lista">
      <BlockHead title={t('overview.list', locale)} focusable bind:el={listHeading} />
    </div>
    <div class="conversations__controls">
      <div class="conversations__search">
        <Input
          label={t('conversations.search', locale)}
          type="search"
          placeholder={t('conversations.search_ph', locale)}
          bind:value={qRaw}
        />
      </div>
      <Select label={t('edit.status', locale)} options={statusOptions} bind:value={() => statusFilter, setStatus} />
      {#if filterChip}
        <Chip selected onRemove={clearListFilter} removeLabel={t('overview.clear_filter', locale)}>{filterChip}</Chip>
      {/if}
      {#if canEdit}
        <Button size="s" onclick={openAdd}>{t('conversations.add', locale)}</Button>
        <Button size="s" variant="outline" onclick={togglePicking}>
          {picking ? t('mailout.pick_done', locale) : t('mailout.pick', locale)}
        </Button>
      {/if}
    </div>

    <ConversationTable
      bind:this={table}
      {filters}
      {personHref}
      {conversationHref}
      groupable
      turnColumn
      importEmptyState={canEdit}
      editable={canEdit}
      selectable={picking}
      bind:selected={picked}
    />

    {#if picking}
      <div class="action-bar" role="region" aria-label={t('mailout.pick_bar', locale)}>
        <!-- Picking and unpicking is announced (móvil #2). -->
        <p class="action-bar__note" aria-live="polite">
          {#if pickedProjects.length > 1}
            {t('mailout.one_project', locale)}
            <!-- The way out in one click (uso #6): keep one project's picks. -->
            {#each pickedProjects as pid (pid)}
              <button type="button" class="action-bar__keep" onclick={() => (picked = picked.filter((c) => c.project_id === pid))}
                >{t('mailout.keep_project', locale, {
                  project: projectNameById.get(pid) ?? '',
                  n: picked.filter((c) => c.project_id === pid).length,
                })}</button
              >
            {/each}
          {:else}
            {t(picked.length === 1 ? 'mailout.picked_one' : 'mailout.picked_other', locale, { n: picked.length })}
          {/if}
        </p>
        <!-- On a phone the bar is where the thumb is: the page's «all» and the way out live here too. -->
        <span class="action-bar__more">
          <Button size="s" variant="outline" onclick={() => table?.togglePage()}>{t('mailout.pick_page_short', locale)}</Button>
          <Button size="s" variant="outline" onclick={togglePicking}>{t('mailout.pick_done', locale)}</Button>
        </span>
        <Button
          size="s"
          disabled={picked.length === 0 || pickedProjects.length !== 1}
          loading={$writeMutation.isPending}
          onclick={() => $writeMutation.mutate()}
        >
          {t('mailout.write_to', locale, { n: picked.length })}
        </Button>
      </div>
    {/if}
  {/if}
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

    /* One height for the search, the status and the two buttons (diseño M9). */
    .conversations__controls :global(.field__control),
    .conversations__controls > :global(button) {
      block-size: var(--control-size-m);
    }

    .conversations__list-head {
      scroll-margin-block-start: var(--space-l);
      margin-block-start: var(--space-m);
    }
    .action-bar__more {
      display: flex;
      gap: var(--space-xs);
    }
    .action-bar__keep {
      margin-inline-start: var(--space-s);
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-decoration: underline;
      text-underline-offset: 0.2em;
      cursor: pointer;
    }
    @media (pointer: coarse) {
      .action-bar__keep {
        min-block-size: var(--touch-target);
      }
    }

    .conversations__state {
      font-size: var(--text-s);
      color: var(--text-muted);
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

    .conversations__skip {
      display: none;
    }
    @media (max-width: 47.999rem) {
      .conversations__skip {
        display: inline-flex;
      }
    }
    /* Touch: the two projections at the finger's size (móvil #8). */
    @media (pointer: coarse) {
      .conversations :global(.lenshead__frag) {
        display: inline-flex;
        align-items: center;
        min-block-size: var(--touch-target);
      }
    }
  }
</style>
