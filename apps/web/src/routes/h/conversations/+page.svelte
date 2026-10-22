<script lang="ts">
  /**
   * Conversations lens — Phase 0.3 item 1, v1 (ADR-044). The difusión work
   * surface inside the shell: conversation list filtered by the sidebar
   * selection (ADR-038 union; empty = everything RLS allows), free-text
   * search over person name/organization, relation filter, and the ADR-040
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
   * A row of chips in the lens header (ADR-138 § 1 y 2, fase 2; it replaces
   * the two views of ADR-134): Todas · the active tags of the scope in their
   * order (sales in its trade word, Difusión / Contratación) · Equipo, what
   * the team says among itself (ThreadFeed, `thread_feed`, ADR-116). One at a
   * time, in the URL (`?etiqueta=sales|press|…|team`; none is Todas).
   * `?view=team` and `?view=threads` redirect to `?etiqueta=team`. Without
   * Converses there is only Equipo. The tag never decides who sees what.
   *
   * The panel follows the chip (plan § 3): Difusión is the whole dashboard of
   * ADR-117 over the `sales` conversations; Todas, Prensa, Coproducción and
   * the space's own, the common one (te toca); Equipo, the threads. Todas
   * lists conversations and threads in one order (phase 3, ConversationFeed
   * over `conversation_feed`: new first, then te toca, then the latest), and
   * the search reads both; a block filter turns it back into the table.
   * Selection and «Escribir a N» only under Difusión (ADR-138 § 7).
   *
   * Difusión opens on its dashboard (ADR-117, propuesta A): the
   * ConversationOverview blocks above the list. Each block is a filter of the
   * list, carried in the URL (`?turno=`, `?temp=`, `?temporada=actual`) and
   * shown as a removable chip; «Escribir a estas» preloads the selection.
   */

  import { docTitle } from '$lib/doc-title';
  import { createMutation, createQuery } from '@tanstack/svelte-query';
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import Button from '$lib/components/Button.svelte';
  import LensHeader from '$lib/components/LensHeader.svelte';
  import LensTitle from '$lib/components/LensTitle.svelte';
  import ConversationTable from '$lib/components/ConversationTable.svelte';
  import ConversationOverview from '$lib/components/ConversationOverview.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import { tick, untrack } from 'svelte';
  import { toStore } from 'svelte/store';
  import { MAILOUT_PICKS, NO_LINE, hasListFilter, parseListFilter, type MailoutPick } from '$lib/conversation-overview';
  import { DEFAULT_ORDER, ORDERS, parseOrden, type Orden } from '$lib/conversation-order';
  import { dayMonth } from '$lib/datetime';
  import ThreadFeed from '$lib/components/ThreadFeed.svelte';
  import ConversationFeed from '$lib/components/ConversationFeed.svelte';
  import FirstVisitCard from '$lib/components/FirstVisitCard.svelte';
  import ConceptHint from '$lib/components/ConceptHint.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import type { ConversationItem } from '$lib/conversation';
  import { RELATIONS, relationLabel, type Relation } from '$lib/conversation-relation';
  import { appLocale, t } from '$lib/i18n';
  import { conversationAccessQueryOptions } from '$lib/conversation-access';
  import {
    ALL,
    addTagKey,
    canBulkSend,
    chipHref,
    lensChip,
    lensChips,
    panelHref,
    panelOf,
    scopeTags,
  } from '$lib/conversation-tags';
  import { conversationTagsQueryOptions } from '$lib/conversation-tags-query';
  import { usePins } from '$lib/stores/pins.svelte';
  import { useCreation } from '$lib/stores/creation.svelte';
  import { useCalm } from '$lib/stores/calm.svelte';
  import { shows } from '$lib/calm';
  import CalmLine from '$lib/components/CalmLine.svelte';
  import {
    buildLineIndex,
    buildProjectIndex,
    resolveScope,
    inScope,
    type NavWorkspace,
    type RawLine,
  } from '$lib/nav';
  import {
    workspacesQueryOptions,
    activeProjectsQueryOptions,
    allLinesQueryOptions,
  } from '$lib/nav-queries';

  const pins = usePins();
  // Calm (ADR-139 § 5): «Te toca» and «Añadir conversación»; the rest of the
  // overview, the list and the threads fold into one line that leaves calm.
  // The Equipo view is the threads themselves and does not change.
  const calm = useCalm();
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


  /** The chip travels in the URL, so a link says which one it shows. Without
   *  Converses there is no conversation to show: the lens is Equipo (ADR-134 § 4). */
  let chip = $derived(lensChip(page.url.searchParams, !noAccess));
  let panel = $derived(panelOf(chip));
  // The vocabulary is names, not data; it is asked only by who reads conversations.
  const tagsQuery = createQuery(toStore(() => conversationTagsQueryOptions($accessQuery.data?.read !== false)));

  let workspaces = $derived<NavWorkspace[]>($workspacesQuery.data?.items ?? []);
  let workspaceSlugById = $derived(new Map(workspaces.map((w) => [w.id, w.slug])));
  let projectNameById = $derived(
    new Map(($projectsQuery.data?.items ?? []).map((p) => [p.id, p.name ?? p.slug])),
  );

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
  // The chips speak for the spaces on screen: the pinned ones, or all (as `workspacesOnScreen`).
  let scopeWorkspaceIds = $derived(
    scope.isEmpty
      ? workspaces.map((w) => w.id)
      : [...new Set([...scope.workspaceIds, ...scope.projects.map((p) => p.workspaceId), ...scope.lines.map((l) => l.workspaceId)])],
  );
  let tagNames = $derived($tagsQuery.data ? scopeTags($tagsQuery.data, scopeWorkspaceIds) : []);
  let chips = $derived(lensChips(!noAccess, tagNames, locale));
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
  // `?q=` lleva una búsqueda hecha en otro sitio: una organización del ⌘K con
  // varias conversaciones (o ninguna) abre la lente buscando su nombre.
  $effect(() => {
    const fromUrl = page.url.searchParams.get('q');
    if (fromUrl !== null) qRaw = fromUrl;
  });
  let q = $state('');
  $effect(() => {
    const next = qRaw;
    const timer = setTimeout(() => {
      q = next.trim();
    }, 300);
    return () => clearTimeout(timer);
  });

  // The relation travels in the URL (`?relacion=`, ADR-138; it was the status,
  // `?estado=`, ADR-126 § 4): a block's link carries only its own filter, so
  // following one clears the relation and the list counts what the block
  // counts; a season segment carries both. Derived, like the blocks.
  let listFilter = $derived(parseListFilter(page.url.searchParams));
  let relationFilter = $derived<string>(listFilter.relacion ?? 'any');

  /** A filter of the list's row (plan de la lista § 5): one URL param; its «any» clears it. */
  function setParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(page.url.searchParams);
    for (const [k, v] of Object.entries(next)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    void goto(`${page.url.pathname}${qs ? `?${qs}` : ''}`, { noScroll: true, keepFocus: true, replaceState: true });
  }
  function setRelation(next: string) {
    setParams({ relacion: next === 'any' ? null : next });
  }

  // The order (plan § 4): in the URL, never remembered by the browser (ADR-120 § 2).
  let orden = $derived<Orden>(parseOrden(page.url.searchParams.get('orden')));
  function setOrden(next: string) {
    setParams({ orden: next === DEFAULT_ORDER ? null : next });
  }
  const ORDER_WORD: Record<Orden, string> = {
    pide: 'conversations.order_pide',
    movimiento: 'conversations.order_movimiento',
    paso: 'conversations.order_paso',
    nombre: 'conversations.order_nombre',
  };
  let orderOptions = ORDERS.map((o) => ({ value: o, label: t(ORDER_WORD[o], locale) }));

  // The line (plan § 5): alone now, not only with the season.
  let lineFilter = $derived(listFilter.linea ?? 'any');
  function setLine(next: string) {
    setParams({ linea: next === 'any' ? null : next });
  }

  // The mailout batch (plan § 5): one of the scope's last ten, and who of it.
  let mailoutFilter = $derived(listFilter.envio ?? 'none');
  let mailoutPick = $derived<MailoutPick>(listFilter.r ?? 'todos');
  function setMailout(next: string) {
    setParams(next === 'none' ? { envio: null, r: null } : { envio: next, r: null });
  }
  function setMailoutPick(next: string) {
    setParams({ r: next === 'todos' ? null : next });
  }
  const PICK_WORD: Record<MailoutPick, string> = {
    todos: 'conversations.mailout_pick_all',
    respuestas: 'conversations.mailout_pick_replied',
    'sin-respuesta': 'conversations.mailout_pick_silent',
    rebotes: 'conversations.mailout_pick_bounced',
  };
  let mailoutPickOptions = MAILOUT_PICKS.map((p) => ({ value: p, label: t(PICK_WORD[p], locale) }));

  // ── Dashboard filters (ADR-117): in the URL, so a block's link is the filter ──
  let lineIds = $derived(scope.lines.map((l) => l.id));
  // How many season bars the overview will likely draw while it loads (ADR-135):
  // the pinned lines, or every line the scope reaches.
  let lineHint = $derived(
    scope.lines.length > 0
      ? scope.lines.length
      : lineIndex.filter((l) => inScope(scope, { workspaceId: l.workspaceId, projectId: l.projectId })).length,
  );
  function lineLabel(linea: string): string {
    if (linea === NO_LINE) return t('overview.no_line', locale);
    return lineIndex.find((l) => l.id === linea)?.name ?? t('overview.unnamed_line', locale);
  }
  /** The lines of the scope, for the Línea filter and the rows' meta. */
  let scopeLines = $derived(lineIndex.filter((l) => inScope(scope, { workspaceId: l.workspaceId, projectId: l.projectId, lineId: l.id })));
  let lineOptions = $derived([
    { value: 'any', label: t('conversations.all_lines', locale) },
    ...scopeLines.map((l) => ({ value: l.id, label: l.name })),
    { value: NO_LINE, label: t('overview.no_line', locale) },
  ]);
  let scopeProjectCount = $derived(projectIndex.filter((p) => inScope(scope, { workspaceId: p.workspaceId, projectId: p.id })).length);
  let lineNameById = $derived(new Map(lineIndex.map((l) => [l.id, l.name])));

  const mailoutsQuery = createQuery(
    toStore(() => ({
      queryKey: ['mailout-options', filterIds.projectIds, filterIds.workspaceIds] as const,
      enabled: !scopeUnresolved && !noAccess && canBulkSend(chip),
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        const p = new URLSearchParams();
        if (filterIds.projectIds.length > 0) p.set('project_ids', filterIds.projectIds.join(','));
        if (filterIds.workspaceIds.length > 0) p.set('workspace_ids', filterIds.workspaceIds.join(','));
        return fetchJSON<{ items: { id: string; subject: string | null; queued_at: string | null }[] }>(`/api/mailout?${p}`, signal);
      },
    })),
  );
  let mailoutOptions = $derived([
    { value: 'none', label: t('conversations.no_mailout', locale) },
    ...($mailoutsQuery.data?.items ?? []).map((m) => ({
      value: m.id,
      label: [m.queued_at ? dayMonth(m.queued_at) : null, m.subject || t('overview.no_subject', locale)].filter(Boolean).join(' · '),
    })),
    // A mailout from the panel's link that is not among the ten still names itself.
    ...(listFilter.envio && !($mailoutsQuery.data?.items ?? []).some((m) => m.id === listFilter.envio)
      ? [{ value: listFilter.envio, label: t('overview.last_mailout', locale) }]
      : []),
  ]);

  const TEMP_CHIP: Record<string, string> = {
    caliente: 'overview.hot',
    fria: 'overview.cold',
    ronda: 'overview.cold_round_chip',
    parada: 'overview.cold_stalled_chip',
    'sin-fecha': 'overview.undated_chip',
  };
  /** The chip names the block filter the list wears; a season segment, with its relation. */
  function chipLabel(f: typeof listFilter): string | null {
    if (f.temporada && (f.relacion || f.linea)) {
      return [
        f.relacion ? relationLabel(f.relacion, locale) : null,
        f.linea ? lineLabel(f.linea) : null,
        t('overview.this_season', locale).toLowerCase(),
      ]
        .filter(Boolean)
        .join(' · ');
    }
    if (f.turno === 'nuestro') return t('overview.due', locale);
    if (f.turno === 'suyo') return t('overview.turn_theirs_cap', locale);
    if (f.temp) return t(TEMP_CHIP[f.temp], locale);
    return f.temporada ? t('overview.this_season', locale) : null;
  }
  let filterChip = $derived(chipLabel(listFilter));
  /**
   * Todas without a block filter is the common list (fase 3): conversations
   * and threads in one order (`conversation_feed`). A block filter (te toca,
   * a relation, the season…) is about conversations: the table, as under any
   * other chip.
   */
  let mixed = $derived(chip === ALL && !hasListFilter(listFilter) && orden === DEFAULT_ORDER);

  function clearListFilter() {
    const params = new URLSearchParams(page.url.searchParams);
    // A season segment is relation + season: its chip names both, and goes as one.
    if (listFilter.temporada) params.delete('relacion');
    for (const k of ['turno', 'temp', 'temporada', 'linea', 'envio', 'r']) params.delete(k);
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

  /** A season segment: that relation, in the season (and the pinned lines, or its own line). */
  async function filterSeasonRelation(relation: Relation, linea?: string) {
    await goto(panelHref(chip, `temporada=actual&relacion=${relation}${linea ? `&linea=${linea}` : ''}`), { noScroll: true, keepFocus: true });
    await showList();
  }
  /** A line's name in the season: that line, every relation (ADR-135). */
  async function filterSeasonLine(linea: string) {
    await goto(panelHref(chip, `temporada=actual&linea=${linea}`), { noScroll: true, keepFocus: true });
    await showList();
  }

  /** «Escribir a estas»: the cooling list, already picked, ready for «Escribir a N». */
  async function writeTo(picks: { id: string; project_id: string }[]) {
    picking = true;
    picked = picks;
    await goto(panelHref(chip, 'temp=ronda'), { noScroll: true, keepFocus: true });
    await showList();
  }
  let relationOptions = [
    { value: 'any', label: t('conversations.all_relations', locale) },
    ...RELATIONS.map((s) => ({ value: s, label: relationLabel(s, locale) })),
  ];

  // aria-busy: until the indexes answer, the pins cannot resolve and the
  // table would fetch the wrong slice. The table says its own busy below.
  let busy = $derived($workspacesQuery.isPending || $projectsQuery.isPending || $linesQuery.isPending);

  let filters = $derived({
    projectIds: filterIds.projectIds,
    workspaceIds: filterIds.workspaceIds,
    q: q || undefined,
    ...listFilter,
    etiqueta: chip === ALL ? undefined : chip,
    orden,
    lineIds,
    enabled: !scopeUnresolved,
  });

  // ── Add conversation (ADR-051): the shell's one dialog (ADR-056), born
  //    with the chip's tag. ──
  const creation = useCreation();
  function openAdd() {
    creation.openConversation({ tag: addTagKey(chip) });
  }

  // ── Selection → mailout (plan § 10) ───────────────────────────────────
  let picking = $state(false);
  let table = $state<ReturnType<typeof ConversationTable>>();
  let picked = $state<Pick<ConversationItem, 'id' | 'project_id'>[]>([]);
  let pickedProjects = $derived([...new Set(picked.map((c) => c.project_id))]);

  function togglePicking() {
    picking = !picking;
    picked = [];
  }
  // Selection is Difusión's: leaving the chip leaves it.
  $effect(() => {
    if (!canBulkSend(chip)) untrack(() => {
      picking = false;
      picked = [];
    });
  });

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

</script>

<svelte:head>
  <title>{docTitle(t('lens.conversations', locale))}</title>
</svelte:head>

<section class="conversations" class:conversations--calm={calm.on && panel !== 'team'} aria-busy={busy}>
  <LensHeader help={panel === 'team' ? 'team' : 'conversations'}>
    {#snippet title()}<LensTitle text={t('lens.conversations', locale)} />{/snippet}
    {#snippet sub()}
      <!-- The chips (ADR-138 § 2): one at a time, each a link that says where you are. -->
      {#each chips as c (c.chip)}
        <a
          class="lenshead__frag"
          href={chipHref(c.chip, page.url.searchParams)}
          aria-current={chip === c.chip ? 'page' : undefined}
          data-chip={c.chip}>{c.label}</a
        >
      {/each}
      {#if panel !== 'team' && shows('conversations', 'list', calm.on)}
        <!-- On a phone the list starts a screen and a half down: a way straight to it (móvil #11). -->
        <a class="lenshead__frag conversations__skip" href="#lista">{t('overview.go_to_list', locale)}</a>
      {/if}
    {/snippet}
  </LensHeader>

  {#if panel === 'team'}
    <FirstVisitCard section="team" />
  {:else if panel === 'sales'}
    <FirstVisitCard section="conversations" steps={['conv-due', 'conv-season', 'conv-list']} />
  {:else}
    <FirstVisitCard section="conversations" steps={['conv-due', 'conv-list']} />
  {/if}

  {#snippet threads()}
    <ThreadFeed
      filters={{ projectIds: filterIds.projectIds, workspaceIds: filterIds.workspaceIds, enabled: !scopeUnresolved }}
      {workspaceSlugById}
      {projectNameById}
      {locale}
    />
  {/snippet}

  {#if panel === 'team'}
    {@render threads()}
  {:else}
    <ConversationOverview
      filters={{ projectIds: filterIds.projectIds, workspaceIds: filterIds.workspaceIds, lineIds, enabled: !scopeUnresolved }}
      {workspaceSlugById}
      {projectNameById}
      {locale}
      {lineHint}
      {chip}
      panel={panel === 'sales' && shows('conversations', 'sales', calm.on) ? 'sales' : 'common'}
      onrelation={filterSeasonRelation}
      online={filterSeasonLine}
      onwrite={canEdit && canBulkSend(chip) ? writeTo : undefined}
    />

    {#if !shows('conversations', 'list', calm.on)}
      <div class="conversations__calm">
        <CalmLine text={t('conversations.calm_rest', locale)} action={t('calm.see_all', locale)} onclick={() => calm.set(false)} />
        {#if canEdit && shows('conversations', 'add', calm.on)}
          <Button size="s" onclick={openAdd}>{t('conversations.add', locale)}</Button>
        {/if}
      </div>
    {:else}
    <div class="conversations__list-head" id="lista" data-help-step="conv-list">
      <BlockHead title={t('overview.list', locale)} focusable bind:el={listHeading} />
    </div>
    <div class="conversations__controls">
      <div class="conversations__search">
        <Input
          toolbar
          label={t('conversations.search', locale)}
          type="search"
          placeholder={t('conversations.search_ph', locale)}
          bind:value={qRaw}
        />
      </div>
      <span class="conversations__relation">
        <Select toolbar label={t('conversations.relation', locale)} options={relationOptions} bind:value={() => relationFilter, setRelation} />
        <ConceptHint concept="relation" />
      </span>
      {#if scopeLines.length > 0}
        <Select toolbar label={t('conversations.line', locale)} options={lineOptions} bind:value={() => lineFilter, setLine} />
      {/if}
      {#if canBulkSend(chip) && (mailoutOptions.length > 1 || listFilter.envio)}
        <Select toolbar label={t('conversations.mailout', locale)} options={mailoutOptions} bind:value={() => mailoutFilter, setMailout} />
        {#if listFilter.envio}
          <Select toolbar label={t('conversations.mailout_who', locale)} options={mailoutPickOptions} bind:value={() => mailoutPick, setMailoutPick} />
        {/if}
      {/if}
      <Select toolbar label={t('conversations.order', locale)} options={orderOptions} bind:value={() => orden, setOrden} />
      {#if filterChip}
        <Chip selected onRemove={clearListFilter} removeLabel={t('overview.clear_filter', locale)}>{filterChip}</Chip>
      {/if}
      {#if canEdit}
        <Button size="s" onclick={openAdd}>{t('conversations.add', locale)}</Button>
        {#if canBulkSend(chip)}
          <Button size="s" variant="secondary" onclick={togglePicking}>
            {picking ? t('mailout.pick_done', locale) : t('mailout.pick', locale)}
          </Button>
        {/if}
      {/if}
    </div>

    {#if mixed}
      <!-- Todas (fase 3): conversations and threads in one list, one order. -->
      <ConversationFeed
        filters={{ projectIds: filterIds.projectIds, workspaceIds: filterIds.workspaceIds, enabled: !scopeUnresolved }}
        {q}
        {workspaceSlugById}
        {projectNameById}
        {tagNames}
        {locale}
        importEmptyState={canEdit}
      />
    {:else}
      <ConversationTable
        bind:this={table}
        {filters}
        {personHref}
        {conversationHref}
        importEmptyState={canEdit}
        bolosColumn={panel === 'sales'}
        projectName={scopeProjectCount > 1 ? (id) => projectNameById.get(id) ?? null : undefined}
        lineName={panel === 'sales' && scopeLines.length > 1 ? (id) => lineNameById.get(id) ?? null : undefined}
        editable={canEdit}
        selectable={picking}
        bind:selected={picked}
        {tagNames}
        hideTag={chip}
      />
    {/if}
    {/if}

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
          <Button size="s" variant="secondary" onclick={() => table?.togglePage()}>{t('mailout.pick_page_short', locale)}</Button>
          <Button size="s" variant="secondary" onclick={togglePicking}>{t('mailout.pick_done', locale)}</Button>
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


<style>
  @layer components {
    .conversations {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }
    /* Calm: one column at the reading measure, from the same left edge; the
       head keeps the page's width, so the lens switcher does not move. */
    .conversations--calm > :global(:not(.lenshead)) {
      max-inline-size: var(--calm-measure);
    }
    .conversations__calm {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-s) var(--space-m);
    }

    /* Header is now the shared LensHeader (global .lenshead* classes). */
    .conversations__controls {
      display: flex;
      gap: var(--space-m);
      align-items: end;
      flex-wrap: wrap;
    }

    /* The relation filter and its «i»: the «i» level with the control, not the label. */
    .conversations__relation {
      display: inline-flex;
      align-items: flex-end;
    }
    .conversations__relation > :global(.hint) {
      margin-block-end: calc((var(--control-size-m) - 1.4em) / 2);
    }
    /* One height for the search, the status and the two buttons (diseño M9):
       the fields take it from `toolbar`, the buttons from here. */
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

    .conversations__search {
      flex: 1;
      min-inline-size: 16rem;
      max-inline-size: 28rem;
    }

    .conversations__skip {
      display: none;
    }
    @media (max-width: 47.999rem) {
      .conversations__skip {
        display: inline-flex;
      }
    }
    /* Touch: the two views and the skip link at the finger's size (móvil #8). */
    @media (pointer: coarse) {
      .conversations :global(.lenshead__frag) {
        display: inline-flex;
        align-items: center;
        min-block-size: var(--touch-target);
      }
    }
  }
</style>
