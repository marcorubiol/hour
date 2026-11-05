<script lang="ts">
  /**
   * Conversations lens (ADR-044; with the shape of a messaging app since
   * ADR-176). Two views in the header, by the verb: Conversaciones (what goes
   * and comes back) and Envíos (`?view=envios`, what goes out to many:
   * MailoutsView, with the Difusión season on top and the audience lists
   * beside; the old Público chip, `?etiqueta=audience`, redirects there).
   *
   * Conversaciones is a list of chats: one row per conversation or bolo
   * thread (ChatRow), with who, the last word, when, how many unread and
   * whose turn. Over it, the search and the chips Todo · Te toca · Se enfría
   * · Equipo with their figure (the panel of ADR-117 folded into them), which
   * filter the same list without changing the screen (`?turno=nuestro`,
   * `?temp=fria`, `?etiqueta=team`). «Filtrar ▾» holds the tag, the relation,
   * the line, the temperature, a mailout and the order, all in the URL. The
   * order by default is «lo que pide». Todo and Equipo without a filter read
   * `conversation_feed` (ConversationFeed); the rest, and the selection, the
   * server's filtered list (ConversationTable in its chat shape).
   *
   * On a wide screen two panes: the list and the open conversation beside it
   * (`?abierta=<space>/<id>`, its record as the vistazo draws it; a bolo's
   * thread as a group, `?grupo=<space>/<performance>[/<facet>]`). Narrower,
   * a row opens the conversation's page: on a phone, the list is the whole
   * screen and the conversation opens over it. No swiping rows (decided).
   *
   * Selection («Seleccionar» in the header): checkboxes over the filtered
   * list and a bar with what is done ten at a time (No esta vez, Etiquetar,
   * Mover a la línea, Siguiente paso, No pide respuesta) through
   * `POST /api/conversations/bulk`, with «Deshacer». With the Difusión tag,
   * also «Escribir a N» (a mailout draft, one project) and «Invitar a N» (an
   * invitation draft, one space). `?invitacion=<id>` opens the selection to
   * add professionals to that draft; `?seleccionar=1` opens it plain («Nuevo
   * envío › Difusión»). «Añadir conversación» (ADR-051) is the shell's dialog,
   * born with the tag filter. The tag never decides who sees what.
   */

  import { docTitle } from '$lib/doc-title';
  import { createMutation, createQuery } from '@tanstack/svelte-query';
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import LensHeader from '$lib/components/LensHeader.svelte';
  import LensTitle from '$lib/components/LensTitle.svelte';
  import ConversationTable from '$lib/components/ConversationTable.svelte';
  import MailoutsView from '$lib/components/MailoutsView.svelte';
  import { rememberConversationsList } from '$lib/conversations-return.svelte';
  import { parseMailoutType, type MailoutType } from '$lib/mailout-list';
  import { audienceListQueryOptions } from '$lib/audience-query';
  import type { MailoutDetail } from '$lib/mailout';
  import Chip from '$lib/components/Chip.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import { tick, untrack } from 'svelte';
  import { toStore } from 'svelte/store';
  import { MAILOUT_PICKS, NO_LINE, ORG_CLASSES, ZONA_MAX, hasListFilter, parseListFilter, type MailoutPick, type OverviewResponse } from '$lib/conversation-overview';
  import type { ConversationFeedView, FeedConversationView, FeedThreadRow } from '$lib/conversation-feed';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import { lazy } from '$lib/lazy.svelte';
  import { DEFAULT_ORDER, ORDERS, parseOrden, type Orden } from '$lib/conversation-order';
  import { dayMonth } from '$lib/datetime';
  import ConversationFeed from '$lib/components/ConversationFeed.svelte';
  import CallLogDialog from '$lib/components/CallLogDialog.svelte';
  import { accentVarFor } from '$lib/utils/accent';
  import ChatDoneLine from '$lib/components/ChatDoneLine.svelte';
  import FirstVisitCard from '$lib/components/FirstVisitCard.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import NextActionDialog from '$lib/components/NextActionDialog.svelte';
  import NotNowDialog from '$lib/components/NotNowDialog.svelte';
  import { useQueryClient } from '@tanstack/svelte-query';
  import { refreshAfterWrite } from '$lib/query-refresh';
  import {
    MATCHING_MAX,
    bulkBodies,
    bulkDoneTitle,
    bulkFailedLine,
    restoreBodies,
    runBulk,
    type BulkArgs,
    type BulkRequest,
    type BulkResult,
  } from '$lib/conversation-bulk';
  import type { ConversationItem } from '$lib/conversation';
  import { ASKED_KINDS } from '$lib/organization-record';
  import { RELATIONS, relationLabel, type Relation } from '$lib/conversation-relation';
  import { appLocale, t } from '$lib/i18n';
  import { conversationAccessQueryOptions } from '$lib/conversation-access';
  import {
    ALL,
    TEAM,
    addTagKey,
    canBulkSend,
    isAudienceLink,
    lensChip,
    lensChips,
    scopeTags,
    tagLabel,
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

  // A record opened from here goes back to the list as it was left (chip, view, filters).
  $effect(() => rememberConversationsList(page.url));

  // ── The two views (ADR-176): in the URL, so a link says which one it shows ──
  let envios = $derived(page.url.searchParams.get('view') === 'envios');
  let mailoutType = $derived(parseMailoutType(page.url.searchParams.get('tipo')));
  // A link to the old Público chip lands on Envíos, where the lists live now.
  $effect(() => {
    if (isAudienceLink(page.url.searchParams)) untrack(() => void goto(viewHref('envios'), { replaceState: true, noScroll: true }));
  });
  /** A view's link: the scope stays, the other view's filters go. */
  function viewHref(view: 'conversations' | 'envios'): string {
    const scopeParam = page.url.searchParams.get('scope');
    const next = new URLSearchParams();
    if (scopeParam) next.set('scope', scopeParam);
    if (view === 'envios') next.set('view', 'envios');
    const qs = next.toString();
    return `/h/conversations${qs ? `?${qs}` : ''}`;
  }
  /** A link into Conversaciones with these filters, from Envíos (the season, a mailout's replies). */
  function conversationsHref(qs: string): string {
    const base = viewHref('conversations');
    return `${base}${base.includes('?') ? '&' : '?'}${qs}`;
  }
  function mailoutTypeHref(type: MailoutType): string {
    const base = viewHref('envios');
    return type === 'todos' ? base : `${base}&tipo=${type}`;
  }
  // The vocabulary is names, not data; it is asked only by who reads conversations.
  const tagsQuery = createQuery(toStore(() => conversationTagsQueryOptions($accessQuery.data?.read !== false)));

  let workspaces = $derived<NavWorkspace[]>($workspacesQuery.data?.items ?? []);
  let workspaceSlugById = $derived(new Map(workspaces.map((w) => [w.id, w.slug])));
  let projectNameById = $derived(
    new Map(($projectsQuery.data?.items ?? []).map((p) => [p.id, p.name ?? p.slug])),
  );
  // A bolo thread is ours: its row wears its show's IdentityMark (ADR-177 § 3).
  let projectMarkById = $derived(
    new Map(
      ($projectsQuery.data?.items ?? []).map((p) => [
        p.id,
        { accent: accentVarFor(p), initials: p.initials ?? null, name: p.name ?? p.slug },
      ]),
    ),
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
  // Who carries the audience of a space on screen sees its lists in Envíos (ADR-173 § 3, ADR-176).
  const audienceQuery = createQuery(toStore(() => audienceListQueryOptions(scopeWorkspaceIds)));
  let canAudience = $derived(Object.values($audienceQuery.data?.access ?? {}).some((a) => a.read));
  let audienceEditable = $derived(
    scopeWorkspaceIds.filter((w) => $audienceQuery.data?.access[w]?.edit),
  );
  // The tag filter (ADR-176): a tag is a filter of the list, in «Filtrar ▾»; `team` is the Equipo chip.
  let tagFilter = $derived(chip === ALL || chip === TEAM ? null : chip);
  let tagOptions = $derived([
    { value: 'any', label: t('conversations.tag_all', locale) },
    ...lensChips(true, tagNames, locale)
      .filter((c) => c.chip !== ALL && c.chip !== TEAM)
      .map((c) => ({ value: c.chip, label: c.label })),
  ]);
  function setTag(next: string) {
    setParams({ etiqueta: next === 'any' ? null : next, envio: null, r: null });
  }
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
  // Selection mode (below): declared first, the common list gives way to it.
  let picking = $state(false);
  let qRaw = $state('');
  // `?q=` lleva una búsqueda hecha en otro sitio: una organización del ⌘K con
  // varias conversaciones (o ninguna) abre la lente buscando su nombre.
  // Derived first: the effect runs when `?q=` changes, not on every navigation
  // (opening a row beside rewrites the URL, and must not overwrite what is typed).
  let qFromUrl = $derived(page.url.searchParams.get('q'));
  $effect(() => {
    const fromUrl = qFromUrl;
    if (fromUrl !== null) untrack(() => (qRaw = fromUrl));
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
    ciudad: 'chat.order_city',
  };
  let orderOptions = ORDERS.map((o) => ({ value: o, label: t(ORDER_WORD[o], locale) }));

  // Zona y Tipo (ADR-177): a city, and a kind of organization or «por libre».
  // The city is typed (a list of every city of the scope does not exist yet)
  // and applies on change; the type is a select of the kinds, never «other».
  let zonaDraft = $state('');
  $effect(() => {
    zonaDraft = listFilter.zona ?? '';
  });
  function setZona(next: string) {
    const v = next.trim();
    if (v !== (listFilter.zona ?? '')) setParams({ zona: v || null });
  }
  let claseOptions = $derived([
    { value: 'any', label: t('chat.any', locale) },
    ...ORG_CLASSES.map((c) => ({ value: c, label: c === 'solo' ? t('chat.solo', locale) : t(`organization.kind_${c}`, locale) })),
  ]);
  function setClase(next: string) {
    setParams({ clase: next === 'any' ? null : next });
  }

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
      ? [{ value: listFilter.envio, label: t('chat.this_mailout', locale) }]
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
    // The temperature is a filter of the sheet (its own chip below); te toca and se enfría, chips of the list.
    if (f.turno === 'suyo') return t('overview.turn_theirs_cap', locale);
    return f.temporada ? t('overview.this_season', locale) : null;
  }
  let filterChip = $derived(chipLabel(listFilter));

  // ── The list's chips (ADR-176 § 4, amended by ADR-177): Todo · Sin
  //    contactar · Nos toca · Sin noticias · Equipo, with their figure. They
  //    filter the same list; none changes the screen. Nos toca and Sin
  //    noticias are the panel's blocks of ADR-117 folded into a chip
  //    (`?turno=nuestro`, `?temp=fria`, the links the Desk already uses);
  //    Sin contactar is the relation `never` (`?relacion=never`), a chip only
  //    while it is most of the list (the first season: 150 cold contacts);
  //    Equipo is the bolos' threads (`?etiqueta=team`). A chip at 0 is not
  //    shown, unless it is the one on. ──
  type ListChip = 'todo' | 'nunca' | 'tetoca' | 'enfria' | 'equipo';
  const LIST_CHIPS: ListChip[] = ['todo', 'nunca', 'tetoca', 'enfria', 'equipo'];
  const LIST_CHIP_WORD: Record<ListChip, string> = {
    todo: 'chat.chip_all',
    nunca: 'chat.chip_never',
    tetoca: 'chat.chip_due',
    enfria: 'chat.chip_cold',
    equipo: 'conversations.view_team',
  };
  let listChip = $derived<ListChip>(
    chip === TEAM
      ? 'equipo'
      : listFilter.turno === 'nuestro'
        ? 'tetoca'
        : listFilter.temp === 'fria'
          ? 'enfria'
          : listFilter.relacion === 'never' && !listFilter.temporada
            ? 'nunca'
            : 'todo',
  );
  /** A chip's link: the scope and the filters stay, the other chips' params go. */
  function listChipHref(c: ListChip): string {
    const params = new URLSearchParams(page.url.searchParams);
    for (const k of ['turno', 'temp', 'view', 'tipo']) params.delete(k);
    if (listChip === 'nunca') params.delete('relacion');
    if (c === 'equipo') {
      for (const k of ['relacion', 'linea', 'envio', 'r', 'temporada', 'orden', 'zona', 'clase']) params.delete(k);
      params.set('etiqueta', TEAM);
    } else if (params.get('etiqueta') === TEAM) params.delete('etiqueta');
    if (c === 'nunca') {
      // A season segment is relation + season: Sin contactar replaces it whole, so the chip on is this one.
      if (params.has('temporada')) for (const k of ['temporada', 'linea']) params.delete(k);
      params.set('relacion', 'never');
    }
    if (c === 'tetoca') params.set('turno', 'nuestro');
    if (c === 'enfria') params.set('temp', 'fria');
    const qs = params.toString();
    return `/h/conversations${qs ? `?${qs}` : ''}`;
  }

  // The figures: the panel's read (one request, ADR-117) for te toca, se
  // enfría and the total, with the tag filter; the team's, what is new in
  // the bolos' threads (the same read as the Equipo chip's list).
  const countsQuery = createQuery(
    toStore(() => ({
      queryKey: ['conversation-overview', filterIds.projectIds, filterIds.workspaceIds, lineIds, tagFilter ?? ALL] as const,
      enabled: !scopeUnresolved && !noAccess,
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        const p = new URLSearchParams();
        if (filterIds.projectIds.length > 0) p.set('project_ids', filterIds.projectIds.join(','));
        if (filterIds.workspaceIds.length > 0) p.set('workspace_ids', filterIds.workspaceIds.join(','));
        if (lineIds.length > 0) p.set('line_ids', lineIds.join(','));
        if (tagFilter) p.set('etiqueta', tagFilter);
        return fetchJSON<OverviewResponse>(`/api/conversations/overview?${p}`, signal);
      },
      placeholderData: (prev: OverviewResponse | undefined) => prev,
    })),
  );
  const teamQuery = createQuery(
    toStore(() => ({
      queryKey: ['conversation-feed', filterIds.projectIds, filterIds.workspaceIds, '', 100, TEAM] as const,
      enabled: !scopeUnresolved,
      staleTime: 0,
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        const p = new URLSearchParams({ etiqueta: TEAM, limit: '100' });
        if (filterIds.projectIds.length > 0) p.set('project_ids', filterIds.projectIds.join(','));
        if (filterIds.workspaceIds.length > 0) p.set('workspace_ids', filterIds.workspaceIds.join(','));
        return fetchJSON<ConversationFeedView>(`/api/conversations/feed?${p}`, signal);
      },
    })),
  );
  // The panel's read knows no area or type (ADR-177): with either on, its
  // figures would not be the list's, so the chips go without a figure.
  let placed = $derived(Boolean(listFilter.zona || listFilter.clase));
  let counts = $derived(placed ? null : ($countsQuery.data ?? null));
  let chipCount = $derived<Record<ListChip, number | null>>({
    todo: counts?.total ?? null,
    nunca: counts?.never ?? null,
    tetoca: counts?.due.count ?? null,
    enfria: counts?.cold.count ?? null,
    equipo: $teamQuery.data
      ? $teamQuery.data.items.filter((r) => r.kind === 'thread' && r.anchor_kind !== 'conversation' && r.unread_count > 0).length
      : null,
  });
  /** Sin contactar is a chip while it dominates; any other at 0 is not shown (ADR-177). The one on always is. */
  function chipShown(c: ListChip): boolean {
    if (c === listChip || c === 'todo') return true;
    const n = chipCount[c];
    // Whether it dominates is a fact of the scope, not of the area or type picked.
    const all = $countsQuery.data;
    if (c === 'nunca') return all?.never !== undefined && all.never * 2 > all.total;
    // Equipo's figure is what is new; the chip goes only when there is no bolo thread at all.
    if (c === 'equipo') return !$teamQuery.data || $teamQuery.data.items.some((r) => r.kind === 'thread' && r.anchor_kind !== 'conversation');
    return n !== 0;
  }
  let shownChips = $derived(noAccess ? (['equipo'] as ListChip[]) : LIST_CHIPS.filter(chipShown));

  /**
   * Todo and Equipo without a filter of the sheet are the common list
   * (`conversation_feed`): conversations and the bolos' threads in one order.
   * Te toca, Se enfría, a filter (relation, line, a mailout, the season, an
   * order) or the selection are about conversations: the server's filtered
   * list (ConversationTable), drawn with the same chat row.
   */
  let mixed = $derived(
    !picking && (listChip === 'equipo' || (listChip === 'todo' && !hasListFilter(listFilter) && orden === DEFAULT_ORDER)),
  );

  // ── Two panes on a wide screen (ADR-176; the vistazo of ADR-139 p1 fixed
  //    in this lens): the list on the left, the open conversation beside it
  //    (`?abierta=<space>/<id>`). Narrower, a row's link opens its page. ──
  let wide = $state(false);
  $effect(() => {
    const mq = matchMedia('(min-width: 75rem)');
    wide = mq.matches;
    const on = () => (wide = mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });
  let openRaw = $derived(page.url.searchParams.get('abierta'));
  let opened = $derived.by(() => {
    const [ws, id] = (openRaw ?? '').split('/');
    return ws && id ? { ws, id } : null;
  });
  const conversationRecord = lazy(() => import('$lib/components/record/ConversationRecord.svelte'));
  $effect(() => {
    if (wide && opened) void conversationRecord.load();
  });
  // The pane is a region the keyboard can reach and leave (ADR-176): opened
  // with Enter, the focus goes into it; Esc or «Cerrar» close it and give the
  // focus back to the row it came from.
  let paneEl = $state<HTMLElement>();
  let openedFrom: HTMLElement | null = null;
  async function afterOpen(event: MouseEvent) {
    openedFrom = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    // `detail` is 0 for a click the keyboard made (Enter on the link).
    if (event.detail === 0) {
      await tick();
      paneEl?.focus({ preventScroll: true });
    }
  }
  function closePane() {
    setParams({ abierta: null, grupo: null });
    const back = openedFrom;
    openedFrom = null;
    void tick().then(() => back?.focus({ preventScroll: true }));
  }
  function openBeside(workspaceId: string, id: string, event: MouseEvent) {
    const ws = workspaceSlugById.get(workspaceId);
    if (!wide || !ws || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    setParams({ abierta: `${ws}/${id}`, grupo: null });
    void afterOpen(event);
  }
  // A bolo's thread opens as a group (BoloGroup, the record lane's): beside on a wide screen.
  let groupRaw = $derived(page.url.searchParams.get('grupo'));
  let group = $derived.by(() => {
    const [ws, performanceId, facetId] = (groupRaw ?? '').split('/');
    return ws && performanceId ? { ws, performanceId, facetId: facetId || null } : null;
  });
  const boloGroup = lazy(() => import('$lib/components/BoloGroup.svelte'));
  $effect(() => {
    if (wide && group) void boloGroup.load();
  });
  function openThread(th: FeedThreadRow, event: MouseEvent) {
    const ws = workspaceSlugById.get(th.workspace_id);
    const performanceId = th.bolo?.performance_id;
    if (!wide || !ws || !performanceId || th.anchor_kind !== 'bolo') return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    setParams({ grupo: [ws, performanceId, th.facet_id].filter(Boolean).join('/'), abierta: null });
    void afterOpen(event);
  }
  const openFeedRow = (c: FeedConversationView, e: MouseEvent) => openBeside(c.workspace_id, c.id, e);
  const openTableRow = (c: ConversationItem, e: MouseEvent) => openBeside(c.workspace_id, c.id, e);

  // The pane at rest (diseño 2026-11-05): how many wait on us and the one that
  // waits longest (the panel's read sorts them, `sortDue`), not a grey line.
  let dueCount = $derived(chipCount.tetoca);
  let oldestDue = $derived($countsQuery.data?.due.rows[0] ?? null);
  function openOldest() {
    const row = oldestDue;
    const ws = row ? workspaceSlugById.get(row.workspace_id) : null;
    if (!row || !ws) return;
    setParams({ abierta: `${ws}/${row.id}`, grupo: null });
    void tick().then(() => paneEl?.focus({ preventScroll: true }));
  }

  function clearListFilter() {
    const params = new URLSearchParams(page.url.searchParams);
    // A season segment is relation + season: its chip names both, and goes as one.
    if (listFilter.temporada) params.delete('relacion');
    for (const k of blockKeys(listFilter)) params.delete(k);
    const qs = params.toString();
    // The chip goes away with the focus on it: the focus goes to the list.
    void goto(`${page.url.pathname}${qs ? `?${qs}` : ''}`, { noScroll: true, keepFocus: true }).then(() =>
      listHeading?.focus({ preventScroll: true }),
    );
  }

  /** What the removable chip takes off: the block filter it names, never the list's chip. */
  function blockKeys(f: typeof listFilter): string[] {
    // A season segment is the season and its line (its relation goes above); the rest are the sheet's own.
    const keys = f.temporada ? ['temporada', 'linea'] : [];
    if (f.turno === 'suyo') keys.push('turno');
    return keys;
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

  /** A season segment, in Envíos: Conversaciones with that relation in the season (and its line). */
  async function filterSeasonRelation(relation: Relation, linea?: string) {
    await goto(conversationsHref(`etiqueta=sales&temporada=actual&relacion=${relation}${linea ? `&linea=${linea}` : ''}`));
    await showList();
  }
  /** A line's name in the season: that line, every relation (ADR-135). */
  async function filterSeasonLine(linea: string) {
    await goto(conversationsHref(`etiqueta=sales&temporada=actual&linea=${linea}`));
    await showList();
  }

  // Caliente, Ronda, Parada, Sin fecha: the panel's other filters, in the sheet now (ADR-176).
  const TEMP_OPTIONS = ['caliente', 'ronda', 'parada', 'sin-fecha'] as const;
  let tempOptions = $derived([
    { value: 'any', label: t('chat.temp_any', locale) },
    ...TEMP_OPTIONS.map((v) => ({ value: v, label: t(TEMP_CHIP[v], locale) })),
  ]);
  let tempFilter = $derived(listFilter.temp && listFilter.temp !== 'fria' ? listFilter.temp : 'any');
  function setTemp(next: string) {
    setParams({ temp: next === 'any' ? null : next, turno: null });
  }
  let relationOptions = [
    { value: 'any', label: t('conversations.all_relations', locale) },
    ...RELATIONS.map((s) => ({ value: s, label: relationLabel(s, locale) })),
  ];

  // ── The filters' sheet (density review § 3): on a phone the four selects
  //    fold into «Filtrar», a sheet with the same fields; what is on shows
  //    under the search as chips that take it off. Each still lives in the
  //    URL and applies at once: the sheet holds nothing to save. ──
  let filtersOpen = $state(false);
  const optionLabel = (options: { value: string; label: string }[], value: string) =>
    options.find((o) => o.value === value)?.label ?? value;
  let sheetFilters = $derived(
    [
      tagFilter ? { key: 'etiqueta', label: optionLabel(tagOptions, tagFilter), clear: () => setTag('any') } : null,
      listFilter.relacion && !listFilter.temporada && listChip !== 'nunca'
        ? { key: 'relacion', label: relationLabel(listFilter.relacion, locale), clear: () => setRelation('any') }
        : null,
      listFilter.linea && !listFilter.temporada && scopeLines.length > 0
        ? { key: 'linea', label: optionLabel(lineOptions, listFilter.linea), clear: () => setLine('any') }
        : null,
      listFilter.envio
        ? { key: 'envio', label: optionLabel(mailoutOptions, listFilter.envio), clear: () => setMailout('none') }
        : null,
      listFilter.envio && listFilter.r
        ? { key: 'r', label: t(PICK_WORD[mailoutPick], locale), clear: () => setMailoutPick('todos') }
        : null,
      listFilter.temp && listFilter.temp !== 'fria'
        ? { key: 'temp', label: t(TEMP_CHIP[listFilter.temp], locale), clear: () => setTemp('any') }
        : null,
      listFilter.zona ? { key: 'zona', label: listFilter.zona, clear: () => setZona('') } : null,
      listFilter.clase ? { key: 'clase', label: optionLabel(claseOptions, listFilter.clase), clear: () => setClase('any') } : null,
      orden !== DEFAULT_ORDER ? { key: 'orden', label: t(ORDER_WORD[orden], locale), clear: () => setOrden(DEFAULT_ORDER) } : null,
    ].filter((f) => f !== null),
  );
  /** «Quitar los filtros»: the sheet's own; a season segment's relation and line are the block's chip. */
  function clearSheetFilters() {
    const season = listFilter.temporada;
    setParams({
      relacion: season || listChip === 'nunca' ? (listFilter.relacion ?? null) : null,
      linea: season ? (listFilter.linea ?? null) : null,
      envio: null,
      r: null,
      orden: null,
      zona: null,
      clase: null,
      temp: listChip === 'enfria' ? 'fria' : null,
      etiqueta: listChip === 'equipo' ? TEAM : null,
    });
  }

  // aria-busy: until the indexes answer, the pins cannot resolve and the
  // table would fetch the wrong slice. The table says its own busy below.
  let busy = $derived($workspacesQuery.isPending || $projectsQuery.isPending || $linesQuery.isPending);

  let filters = $derived({
    projectIds: filterIds.projectIds,
    workspaceIds: filterIds.workspaceIds,
    q: q || undefined,
    ...listFilter,
    etiqueta: tagFilter ?? undefined,
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

  /** «Apuntar llamada» (121 A, ADR-182). */
  let callOpen = $state(false);

  // ── Selection (plan § 10; plan de la lista § 6.2) ─────────────────────
  let table = $state<ReturnType<typeof ConversationTable>>();
  let picked = $state<Pick<ConversationItem, 'id' | 'project_id'>[]>([]);
  let pickedProjects = $derived([...new Set(picked.map((c) => c.project_id))]);

  function togglePicking() {
    picking = !picking;
    picked = [];
    if (!picking && selectFromUrl) setParams({ seleccionar: null });
  }
  /** Esc, or «Dejar de seleccionar»: the focus goes back to the list's title. */
  function leavePicking() {
    picking = false;
    picked = [];
    if (selectFromUrl) setParams({ seleccionar: null });
    void tick().then(() => listHeading?.focus({ preventScroll: true }));
  }
  // Equipo and Envíos have no conversations to pick: going there leaves the selection.
  $effect(() => {
    if (listChip === 'equipo' || envios) untrack(() => {
      picking = false;
      picked = [];
    });
  });

  // What the bar needs of the page on screen (ConversationTable's `onpage`).
  let listPage = $state({ total: 0, size: 0, full: false });
  let matchCount = $derived(Math.min(listPage.total, MATCHING_MAX));
  // «Seleccionar las N que coinciden»: the page is all picked and the filter has more.
  let offerMatching = $derived(listPage.full && listPage.total > listPage.size && picked.length < matchCount);
  let matchingBusy = $state(false);
  async function pickMatching() {
    if (!table) return;
    matchingBusy = true;
    try {
      await table.pickMatching();
    } catch {
      addToast({ tone: 'danger', message: t('conversations.load_error', locale) });
    } finally {
      matchingBusy = false;
    }
  }

  // ── Bulk actions (plan de la lista § 6.2): one endpoint, in chunks ─────
  const queryClient = useQueryClient();
  let bulkBusy = $state(false);
  let notNowOpen = $state(false);
  let nextOpen = $state(false);
  let pickedWho = $derived(t(picked.length === 1 ? 'mailout.picked_one' : 'mailout.picked_other', locale, { n: picked.length }));

  function postBulk(body: BulkRequest): Promise<BulkResult> {
    return mutateJSON<BulkResult>('POST', '/api/conversations/bulk', body).then((r) => {
      if (!r) throw new Error(t('conversations.unexpected_response', locale));
      return r;
    });
  }

  function refreshLists() {
    for (const key of ['conversations', 'conversation-overview', 'conversation-feed', 'line-eng-stats', 'conversation', 'organization']) {
      void refreshAfterWrite(queryClient, [key]);
    }
  }

  async function undoBulk(result: BulkResult) {
    const back = await runBulk(restoreBodies(result.undo), postBulk);
    refreshLists();
    if (back.failed.length === 0) addToast({ tone: 'success', message: t('ui.undone', locale) });
    else addToast({ tone: 'danger', title: t('ui.not_undone', locale), message: bulkFailedLine(back, locale) ?? '' });
  }

  async function bulk(args: BulkArgs) {
    if (picked.length === 0 || bulkBusy) return;
    bulkBusy = true;
    try {
      const result = await runBulk(bulkBodies(args, picked.map((p) => p.id)), postBulk);
      refreshLists();
      const failed = bulkFailedLine(result, locale);
      if (result.done.length === 0) {
        addToast({ tone: 'danger', title: t('conversations.change_not_saved', locale), message: failed ?? '' });
        return;
      }
      addToast({
        tone: failed ? 'warning' : 'success',
        title: bulkDoneTitle(args.action, result.done.length, locale),
        message: failed ?? '',
        // Time to read it and reach «Deshacer».
        duration: 8000,
        ...(result.undo.length > 0 ? { action: { label: t('ui.undo', locale), run: () => void undoBulk(result) } } : {}),
      });
    } finally {
      bulkBusy = false;
    }
  }

  /** «Etiquetar»: put or take one tag of the scope, the rest untouched. */
  let tagActions = $derived([
    ...tagNames.map((tag) => ({
      label: t('bulk.tag_add', locale, { tag: tagLabel(tag, locale) }),
      onclick: () => void bulk({ action: 'tag', key: tag.key, op: 'add' }),
    })),
    ...tagNames.map((tag) => ({
      label: t('bulk.tag_remove', locale, { tag: tagLabel(tag, locale) }),
      onclick: () => void bulk({ action: 'tag', key: tag.key, op: 'remove' }),
    })),
  ]);

  /**
   * «Mover a la línea…» (ADR-169, punto 93): the lines of the picked
   * conversations' projects, and «out of any line». A line belongs to one
   * project, so a conversation of another one stays where it was and says so.
   */
  let lineActions = $derived([
    ...lineIndex
      .filter((l) => pickedProjects.includes(l.projectId))
      .map((l) => ({
        label: pickedProjects.length > 1 ? `${l.name} · ${l.projectName}` : l.name,
        onclick: () => void bulk({ action: 'line', line_id: l.id }),
      })),
    { label: t('bulk.line_none', locale), onclick: () => void bulk({ action: 'line', line_id: null }) },
  ]);

  /** «Tipo» (ADR-177 § 2, punto 115): the kind of each picked conversation's organization. */
  let kindActions = $derived(
    ASKED_KINDS.map((k) => ({ label: t(`organization.kind_${k}`, locale), onclick: () => void bulk({ action: 'kind', kind: k }) })),
  );

  // «Invitar a N» (ADR-173 § 10): professionals of any project, of one space.
  let pickedWorkspaces = $derived([
    ...new Set(pickedProjects.map((pid) => projectIndex.find((p) => p.id === pid)?.workspaceId).filter(Boolean)),
  ] as string[]);
  const inviteMutation = createMutation({
    mutationFn: () =>
      mutateJSON<{ id: string; workspace_slug: string }>('POST', '/api/mailout/invitation', {
        workspace_id: pickedWorkspaces[0],
        conversation_ids: picked.map((c) => c.id),
      }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['mailout-list'] });
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

  // «Añadir profesionales» from an invitation draft: the selection opens, and
  // «Añadir a la invitación» puts the picks next to the ones it had.
  let invitationId = $derived(page.url.searchParams.get('invitacion'));
  // «Nuevo envío › Difusión» opens the selection once: a derived, so leaving it does not reopen it on the next navigation.
  let selectFromUrl = $derived(page.url.searchParams.get('seleccionar') === '1');
  $effect(() => {
    if (invitationId || selectFromUrl) untrack(() => (picking = true));
  });
  const addToInvitation = createMutation({
    mutationFn: async () => {
      const d = await fetchJSON<MailoutDetail>(`/api/mailout/${invitationId}`);
      const had = (d?.recipients ?? []).map((r) => r.conversation_id).filter((x): x is string => x !== null);
      await mutateJSON('PUT', `/api/mailout/${invitationId}/recipients`, {
        conversation_ids: [...new Set([...had, ...picked.map((c) => c.id)])],
      });
      return d?.workspace.slug ?? '';
    },
    // The invitation's cached detail still holds the old list: mark it stale
    // first, or the draft opens on «Profesionales · 0» until a reload.
    onSuccess: async (slug) => {
      await refreshAfterWrite(queryClient, ['mailout', invitationId]);
      void goto(`/h/${slug}/mailout/${invitationId}`);
    },
    // The list is replaced whole: a professional another editor added from a
    // project the caller does not edit makes the whole change a «not found».
    onError: (err) =>
      addToast({
        tone: 'danger',
        title: t('mailout.action_failed', locale),
        message:
          err instanceof ApiError && err.status === 404
            ? t('mailout.err_pros_not_yours', locale)
            : err instanceof Error
              ? err.message
              : t('perf.unexpected', locale),
      }),
  });

  const writeMutation = createMutation({
    mutationFn: () =>
      mutateJSON<{ id: string; workspace_slug: string }>('POST', '/api/mailout', {
        project_id: pickedProjects[0],
        conversation_ids: picked.map((c) => c.id),
      }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['mailout-list'] });
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

  // «Nuevo envío» (ADR-176): difusión opens the selection under Difusión
  // (a mailout is born with its recipients); an invitation is born empty in
  // a space whose audience the caller edits (`create_invitation`).
  const newInvitation = createMutation({
    mutationFn: (workspaceId: string) =>
      mutateJSON<{ id: string; workspace_slug: string }>('POST', '/api/mailout/invitation', { workspace_id: workspaceId }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['mailout-list'] });
      if (r) void goto(`/h/${r.workspace_slug}/mailout/${r.id}`);
    },
    onError: (err) =>
      addToast({
        tone: 'danger',
        title: t('mailout.not_created', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      }),
  });
  let workspaceName = $derived(new Map(workspaces.map((w) => [w.id, w.name])));
  let newMailoutItems = $derived([
    ...(canEdit && !noAccess
      ? [{ label: t('envios.new_outreach', locale), onclick: () => void goto(conversationsHref('etiqueta=sales&seleccionar=1')) }]
      : []),
    ...audienceEditable.map((w) => ({
      label:
        audienceEditable.length > 1
          ? t('envios.new_invitation_in', locale, { space: workspaceName.get(w) ?? '' })
          : t('envios.new_invitation', locale),
      onclick: () => $newInvitation.mutate(w),
    })),
  ]);
</script>

<svelte:head>
  <title>{docTitle(t('lens.conversations', locale))}</title>
</svelte:head>

<section class="conversations" class:conversations--calm={calm.on && listChip !== 'equipo' && !envios} aria-busy={busy}>
  <LensHeader help={envios ? undefined : listChip === 'equipo' ? 'team' : 'conversations'}>
    {#snippet title()}<LensTitle text={t('lens.conversations', locale)} />{/snippet}
    {#snippet tools()}
      {#if envios && newMailoutItems.length > 0}
        <Menu items={newMailoutItems} align="end" label={t('envios.new', locale)} triggerClass="btn--primary btn--s">
          {#snippet trigger()}<span class="conversations__add-long">{t('envios.new', locale)}</span><span
              class="conversations__caret conversations__add-long"
              aria-hidden="true">▾</span
            ><span
              class="conversations__add-short"
              aria-hidden="true">+</span
            >{/snippet}
        </Menu>
      {:else if !envios && canEdit && !noAccess}
        {#if listChip !== 'equipo' && shows('conversations', 'list', calm.on)}
          <span class="conversations__pick-door" class:conversations__pick-door--idle={!picking}>
            <Button size="s" variant="secondary" onclick={togglePicking}>
              {picking ? t('mailout.pick_done', locale) : t('mailout.pick', locale)}
            </Button>
          </span>
        {/if}
        {#if listChip !== 'equipo'}
          <!-- 121 A (ADR-182): una llamada sin buscar antes la conversación. Palabras, no un glifo. -->
          <Button size="s" variant="secondary" onclick={() => (callOpen = true)}>{t('call.open', locale)}</Button>
        {/if}
        <Button size="s" onclick={openAdd} label={t('conversations.add', locale)}
          ><span class="conversations__add-long">{t('conversations.add', locale)}</span><span class="conversations__add-short" aria-hidden="true">+</span></Button
        >
      {/if}
    {/snippet}
    {#snippet sub()}
      <!-- The two views (ADR-176): by the verb, what goes and comes back, what goes out to many.
           One child of the sub line, so it takes no «·»: tabs, a rule under the one you are on. -->
      <nav class="viewtabs" aria-label={t('chat.views_label', locale)}>
        <a class="viewtabs__tab" href={viewHref('conversations')} aria-current={envios ? undefined : 'page'} data-view="conversations"
          >{t('lens.conversations', locale)}</a
        >
        <a class="viewtabs__tab" href={viewHref('envios')} aria-current={envios ? 'page' : undefined} data-view="envios"
          >{t('envios.view', locale)}</a
        >
      </nav>
    {/snippet}
  </LensHeader>

  {#if envios}
    <!-- Envíos has no first-visit card of its own yet. -->
  {:else if listChip === 'equipo'}
    <FirstVisitCard section="team" />
  {:else}
    <FirstVisitCard section="conversations" steps={['conv-due', 'conv-list']} />
  {/if}

  {#if envios}
    {#if !noAccess || canAudience}
      <MailoutsView
        filters={{ projectIds: filterIds.projectIds, workspaceIds: filterIds.workspaceIds, lineIds, enabled: !scopeUnresolved }}
        {scopeWorkspaceIds}
        {workspaces}
        {workspaceSlugById}
        {locale}
        canRead={!noAccess}
        {canAudience}
        type={mailoutType}
        typeHref={mailoutTypeHref}
        {conversationsHref}
        onrelation={filterSeasonRelation}
        online={filterSeasonLine}
      />
    {:else if $audienceQuery.isSuccess}
      <p class="conversations__none">{t('envios.no_access', locale)}</p>
    {/if}
  {:else if !shows('conversations', 'list', calm.on)}
    <!-- Calm (ADR-139 § 5): what is yours to answer, and the rest in one line that leaves calm. -->
    <ConversationTable
      filters={{ ...filters, turno: 'nuestro', temp: undefined }}
      {personHref}
      {conversationHref}
      editable={canEdit}
      {tagNames}
      chat
      counted
    />
    <div class="conversations__calm">
      <CalmLine text={t('conversations.calm_rest', locale)} action={t('calm.see_all', locale)} onclick={() => calm.set(false)} />
    </div>
  {:else}
    <div class="conversations__panes" class:conversations__panes--two={wide}>
      <div class="conversations__list" id="lista" data-help-step="conv-list">
        <h2 class="visually-hidden" tabindex="-1" bind:this={listHeading}>{t('overview.list', locale)}</h2>
        <div class="conversations__chips">
          <nav class="listfilter conversations__chiprow" aria-label={t('chat.chips_label', locale)}>
            {#each shownChips as c (c)}
              <a
                class="listfilter__opt conversations__chip"
                href={listChipHref(c)}
                aria-current={listChip === c ? 'page' : undefined}
                data-chip={c}
                data-help-step={c === 'tetoca' ? 'conv-due' : undefined}
                >{t(LIST_CHIP_WORD[c], locale)}{#if chipCount[c] !== null}<span class="listfilter__n conversations__chip-n">{chipCount[c]}</span>{/if}</a
              >
            {/each}
          </nav>
          {#if !noAccess}
            <!-- Search the list: a word with its glass in the chips' row, no box (the
                 bar at the top is the app's search); it opens as it takes the focus. -->
            <label class="conversations__search" class:is-on={qRaw !== ''}>
              <svg class="conversations__glass" viewBox="0 0 16 16" aria-hidden="true"
                ><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg
              >
              <input type="search" aria-label={t('chat.search_ph', locale)} placeholder={t('conversations.search', locale)} bind:value={qRaw} />
            </label>
          {/if}
          {#if listChip !== 'equipo' && !noAccess}
            <button
              type="button"
              class="conversations__filter-open"
              aria-haspopup="dialog"
              aria-expanded={filtersOpen}
              aria-label={sheetFilters.length === 0
                ? undefined
                : sheetFilters.length === 1
                  ? t('conversations.filter_on_one', locale)
                  : t('conversations.filter_on', locale, { n: sheetFilters.length })}
              onclick={() => (filtersOpen = true)}
              >{t('conversations.filter', locale)}{#if sheetFilters.length > 0}<span class="conversations__filter-n" aria-hidden="true"
                  >{sheetFilters.length}</span
                >{/if}<span class="conversations__caret" aria-hidden="true">▾</span></button
            >
          {/if}
        </div>
        {#if filterChip || sheetFilters.length > 0}
          <div class="conversations__active">
            {#if filterChip}
              <Chip selected onRemove={clearListFilter} removeLabel={t('overview.clear_filter', locale)}>{filterChip}</Chip>
            {/if}
            {#each sheetFilters as f (f.key)}
              <Chip onRemove={f.clear} removeLabel={t('conversations.filter_remove', locale, { filter: f.label })}>{f.label}</Chip>
            {/each}
          </div>
        {/if}

        {#if canEdit}<ChatDoneLine {locale} onclose={() => listHeading?.focus({ preventScroll: true })} />{/if}
        {#if mixed}
          <ConversationFeed
            filters={{ projectIds: filterIds.projectIds, workspaceIds: filterIds.workspaceIds, enabled: !scopeUnresolved }}
            {q}
            tag={listChip === 'equipo' ? TEAM : tagFilter}
            {workspaceSlugById}
            {projectNameById}
            showProject={scopeProjectCount > 1}
            {tagNames}
            {locale}
            importEmptyState={canEdit}
            editable={canEdit}
            projectMark={(id) => projectMarkById.get(id) ?? null}
            onchange={refreshLists}
            activeId={wide ? (opened?.id ?? null) : null}
            onopen={openFeedRow}
            activeThread={wide && group ? `${group.performanceId}/${group.facetId ?? ''}` : null}
            onopenthread={openThread}
          />
        {:else}
          <ConversationTable
            bind:this={table}
            {filters}
            {personHref}
            {conversationHref}
            importEmptyState={canEdit}
            projectName={scopeProjectCount > 1 ? (id) => projectNameById.get(id) ?? null : undefined}
            lineName={scopeLines.length > 1 ? (id) => lineNameById.get(id) ?? null : undefined}
            editable={canEdit}
            selectable={picking}
            bind:selected={picked}
            {tagNames}
            hideTag={tagFilter ?? undefined}
            onpage={(p) => (listPage = p)}
            onexit={leavePicking}
            chat
            counted
            activeId={wide ? (opened?.id ?? null) : null}
            onopen={openTableRow}
            onchange={refreshLists}
          />
        {/if}
      </div>

      {#if wide}
        <!-- The open conversation beside the list: its record, as the vistazo draws it. -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <section
          class="conversations__pane"
          data-testid="conversation-pane"
          bind:this={paneEl}
          tabindex="-1"
          aria-label={t(group ? 'chat.pane_group' : 'chat.pane_conversation', locale)}
          onkeydown={(e) => {
            if (e.key === 'Escape' && (opened || group) && !e.defaultPrevented && !(e.target as HTMLElement).closest('[role="menu"], [role="dialog"]')) {
              e.preventDefault();
              closePane();
            }
          }}
        >
          {#if opened || group}
            <div class="conversations__pane-bar">
              <button type="button" class="block-head__act" aria-keyshortcuts="Escape" onclick={closePane}>{t('peek.close', locale)}</button>
            </div>
          {/if}
          {#if group && boloGroup.component}
            {#key groupRaw}
              <boloGroup.component workspaceSlug={group.ws} performanceId={group.performanceId} facetId={group.facetId} inPeek />
            {/key}
          {:else if opened && conversationRecord.component}
            {#key openRaw}
              <conversationRecord.component workspaceSlug={opened.ws} slug={opened.id} inPeek />
            {/key}
          {:else if !opened && !group}
            <!-- Nothing open: what waits, said calmly, and the one that waits longest one click away. -->
            <div class="conversations__rest" data-testid="pane-summary">
              {#if dueCount !== null && dueCount > 0}
                <p class="conversations__rest-big">{t(dueCount === 1 ? 'chat.pane_due_one' : 'chat.pane_due', locale, { n: dueCount })}</p>
                {#if oldestDue}
                  <p class="conversations__rest-sub">
                    {t('chat.pane_oldest', locale, { name: oldestDue.title, date: dayMonth(oldestDue.at) })}
                  </p>
                  <button type="button" class="conversations__rest-open" onclick={openOldest}
                    >{t('chat.pane_open', locale, { name: oldestDue.title })}</button
                  >
                {/if}
              {:else}
                {#if dueCount === 0}<p class="conversations__rest-big">{t('chat.pane_calm', locale)}</p>{/if}
                <p class="conversations__rest-sub">{t('chat.pick_one', locale)}</p>
              {/if}
            </div>
          {/if}
        </section>
      {/if}
    </div>

    {#snippet filterFields()}
      {#if tagOptions.length > 2}
        <Select label={t('chat.tag', locale)} options={tagOptions} bind:value={() => tagFilter ?? 'any', setTag} />
      {/if}
      <!-- What each relation means lives in the lens's «?» (ADR-145 § 2). -->
      <Select label={t('conversations.relation', locale)} options={relationOptions} bind:value={() => relationFilter, setRelation} />
      {#if scopeLines.length > 0}
        <Select label={t('conversations.line', locale)} options={lineOptions} bind:value={() => lineFilter, setLine} />
      {/if}
      <Select label={t('chat.temp', locale)} options={tempOptions} bind:value={() => tempFilter, setTemp} />
      <Input
        label={t('chat.zone', locale)}
        maxlength={ZONA_MAX}
        bind:value={zonaDraft}
        onchange={() => setZona(zonaDraft)}
      />
      <Select label={t('chat.kind', locale)} options={claseOptions} bind:value={() => listFilter.clase ?? 'any', setClase} />
      {#if canBulkSend(chip) && (mailoutOptions.length > 1 || listFilter.envio)}
        <Select label={t('conversations.mailout', locale)} options={mailoutOptions} bind:value={() => mailoutFilter, setMailout} />
        {#if listFilter.envio}
          <Select label={t('conversations.mailout_who', locale)} options={mailoutPickOptions} bind:value={() => mailoutPick, setMailoutPick} />
        {/if}
      {/if}
      <Select label={t('conversations.order', locale)} options={orderOptions} bind:value={() => orden, setOrden} />
    {/snippet}

    <!-- «Filtrar ▾»: a sheet at every width (ADR-176), apart from the chips and in another shape;
         the fields apply as they change, so nothing asks on close. -->
    <Dialog bind:open={filtersOpen} title={t('conversations.filter', locale)} size="s" keepsDraft>
      {#if filtersOpen}
        <div class="conversations__sheet">{@render filterFields()}</div>
      {/if}
      {#snippet lead()}
        {#if sheetFilters.length > 0}
          <button type="button" class="btn--quiet btn--s" onclick={clearSheetFilters}>{t('conversations.filters_clear', locale)}</button>
        {/if}
      {/snippet}
      {#snippet actions()}
        <Button onclick={() => (filtersOpen = false)}>{t('conversations.filters_done', locale)}</Button>
      {/snippet}
    </Dialog>

    {#if picking}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="action-bar"
        role="region"
        aria-label={t('mailout.pick_bar', locale)}
        onkeydown={(e) => {
          if (e.key === 'Escape' && !(e.target as HTMLElement).closest('[role="menu"]')) {
            e.preventDefault();
            leavePicking();
          }
        }}
      >
        <!-- Picking and unpicking is announced (móvil #2). -->
        <p class="action-bar__note" aria-live="polite">
          {#if canBulkSend(chip) && pickedProjects.length > 1}
            {t('mailout.one_project', locale)}
          {:else}
            {pickedWho}
          {/if}
          {#if offerMatching}
            <button type="button" class="action-bar__keep" disabled={matchingBusy} onclick={pickMatching}
              >{t('bulk.pick_matching', locale, { n: matchCount })}</button
            >
          {/if}
          {#if canBulkSend(chip) && pickedProjects.length > 1}
            <!-- The way out in one click (uso #6): keep one project's picks. -->
            {#each pickedProjects as pid (pid)}
              <button type="button" class="action-bar__keep" onclick={() => (picked = picked.filter((c) => c.project_id === pid))}
                >{t('mailout.keep_project', locale, {
                  project: projectNameById.get(pid) ?? '',
                  n: picked.filter((c) => c.project_id === pid).length,
                })}</button
              >
            {/each}
          {/if}
        </p>
        <!-- On a phone the bar is where the thumb is: the page's «all» and the way out live here too. -->
        <span class="action-bar__more">
          <Button size="s" variant="secondary" onclick={() => table?.togglePage()}>{t('mailout.pick_page_short', locale)}</Button>
          <Button size="s" variant="secondary" onclick={leavePicking}>{t('mailout.pick_done', locale)}</Button>
        </span>
        <div class="action-bar__acts" role="toolbar" aria-label={t('bulk.actions', locale)}>
          <Button size="s" variant="secondary" disabled={picked.length === 0 || bulkBusy} onclick={() => (notNowOpen = true)}
            >{t('conversations.relation_not_now', locale)}</Button
          >
          {#if tagActions.length > 0 && picked.length > 0 && !bulkBusy}
            <Menu items={tagActions} direction="up" align="end" label={t('bulk.tag', locale)}>
              {#snippet trigger()}{t('bulk.tag', locale)}<span class="action-bar__caret" aria-hidden="true">▾</span>{/snippet}
            </Menu>
          {:else if tagActions.length > 0}
            <Button size="s" variant="secondary" disabled>{t('bulk.tag', locale)}</Button>
          {/if}
          {#if picked.length > 0 && !bulkBusy}
            <Menu items={lineActions} direction="up" align="end" label={t('bulk.line', locale)}>
              {#snippet trigger()}{t('bulk.line', locale)}<span class="action-bar__caret" aria-hidden="true">▾</span>{/snippet}
            </Menu>
          {:else}
            <Button size="s" variant="secondary" disabled>{t('bulk.line', locale)}</Button>
          {/if}
          {#if picked.length > 0 && !bulkBusy}
            <Menu items={kindActions} direction="up" align="end" label={t('bulk.kind', locale)}>
              {#snippet trigger()}{t('bulk.kind', locale)}<span class="action-bar__caret" aria-hidden="true">▾</span>{/snippet}
            </Menu>
          {:else}
            <Button size="s" variant="secondary" disabled>{t('bulk.kind', locale)}</Button>
          {/if}
          <Button size="s" variant="secondary" disabled={picked.length === 0 || bulkBusy} onclick={() => (nextOpen = true)}
            >{t('conversations.col_next_action', locale)}</Button
          >
          <Button size="s" variant="secondary" disabled={picked.length === 0 || bulkBusy} onclick={() => void bulk({ action: 'settle' })}
            >{t('overview.settle', locale)}</Button
          >
          {#if invitationId}
            <Button size="s" disabled={picked.length === 0} loading={$addToInvitation.isPending} onclick={() => $addToInvitation.mutate()}>
              {t('mailout.invitation_add_n', locale, { n: picked.length })}
            </Button>
          {:else if canBulkSend(chip)}
            <Button
              size="s"
              variant="secondary"
              disabled={picked.length === 0 || pickedWorkspaces.length !== 1}
              loading={$inviteMutation.isPending}
              onclick={() => $inviteMutation.mutate()}
            >
              {t('mailout.invite_selection', locale, { n: picked.length })}
            </Button>
            <Button
              size="s"
              disabled={picked.length === 0 || pickedProjects.length !== 1}
              loading={$writeMutation.isPending}
              onclick={() => $writeMutation.mutate()}
            >
              {t('mailout.write_to', locale, { n: picked.length })}
            </Button>
          {/if}
        </div>
      </div>
      <NotNowDialog bind:open={notNowOpen} {locale} who={pickedWho} onsave={(until) => void bulk({ action: 'not_now', until })} />
      <NextActionDialog
        bind:open={nextOpen}
        who={pickedWho}
        date=""
        note=""
        {locale}
        onsave={(next) => void bulk({ action: 'next_step', ...next })}
      />
    {/if}
  {/if}
  <CallLogDialog bind:open={callOpen} workspaceIds={scopeWorkspaceIds} {locale} />
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
    .conversations__none {
      margin: 0;
      color: var(--text-dark-muted);
      font-size: var(--text-s);
    }
    .conversations__calm {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-s) var(--space-m);
    }
    /* «Seleccionar» sits in the tools' box like «Añadir»: a flex box, not an
       inline span on the tools' tall title line, which dropped it a few px. */
    .conversations__pick-door {
      display: inline-flex;
    }
    /* On a phone the selection waits for a wider screen: the head keeps the title and «Añadir». */
    @media (max-width: 47.999rem) {
      .conversations__pick-door--idle,
      .conversations__add-long {
        display: none;
      }
      .conversations .conversations__add-short {
        display: inline;
      }
      /* On a phone the search is its glass until it takes the focus. */
      .conversations__search:not(:focus-within, .is-on) input {
        inline-size: 0;
      }
    }
    .conversations__add-short {
      display: none;
    }
    .conversations__caret {
      margin-inline-start: var(--space-2xs);
    }

    /* Two panes on a wide screen (ADR-176): the list at its measure, the
       open conversation beside it, each with its own scroll under the bar.
       The page fills the screen and does not scroll itself (it gives back
       the shell's air at the foot), so the pane's field is always in view. */
    .conversations:has(> .conversations__panes--two) {
      block-size: calc(100dvh - var(--header-height) - var(--space-l));
      margin-block-end: calc(-1 * var(--space-xxl));
    }
    .conversations__panes--two {
      flex: 1;
      min-block-size: 0;
      display: grid;
      grid-template-columns: var(--chat-list-inline) minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
      gap: 0;
    }
    .conversations__list {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      min-inline-size: 0;
      scroll-margin-block-start: var(--space-l);
    }
    .conversations__panes--two .conversations__list {
      overflow-y: auto;
      padding-block-start: var(--space-m);
      padding-inline-end: var(--space-m);
      border-inline-end: var(--border);
    }
    .conversations__pane:focus {
      outline: none;
    }
    .conversations__pane-bar {
      display: flex;
      justify-content: flex-end;
    }
    .conversations__pane {
      display: flex;
      flex-direction: column;
      min-block-size: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: var(--space-m) 0 var(--space-s) var(--space-l);
    }
    /* A conversation in the pane, as a chat: its head on top, the field at
       the foot, always in view, and only the thread between them scrolls. */
    .conversations__pane > :global(.chat) {
      flex: 1;
      min-block-size: 0;
    }
    .conversations__pane > :global(.chat > *) {
      flex-shrink: 0;
    }
    .conversations__pane > :global(.chat > .flow) {
      flex: 1;
      min-block-size: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    /* The chips with their figure, and «Filtrar ▾» apart, in another shape:
       a quiet word with its caret, never a chip among chips. */
    .conversations__chips {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s);
    }
    .conversations__chiprow {
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: none;
    }
    /* From a tablet up a chip never gives way: the search shrinks to its
       glass first. On a phone the chips slide, as they did. */
    @media (min-width: 48rem) {
      .conversations__chiprow {
        flex-shrink: 0;
      }
    }
    /* Search the list: the glass and a word, no box; it grows as it takes the
       focus or holds a query, and the chips give it their room. */
    .conversations__search {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      flex: 0 1 auto;
      min-inline-size: calc(1em + 2 * var(--space-xs));
      overflow: hidden;
      margin-inline-start: auto;
      padding: var(--space-2xs) var(--space-xs);
      border-radius: var(--radius-s);
      color: var(--text-faint);
      cursor: text;
      transition: background-color var(--transition);
    }
    .conversations__search:hover {
      color: var(--text-muted);
    }
    .conversations__search:focus-within,
    .conversations__search.is-on {
      flex: 1 1 auto;
      background: var(--bg-light);
      color: var(--text-muted);
    }
    .conversations__glass {
      flex-shrink: 0;
      inline-size: 1em;
      block-size: 1em;
      fill: none;
      stroke: currentColor;
      stroke-width: var(--line-thin);
    }
    .conversations__search input {
      inline-size: 4.5em;
      min-inline-size: 0;
      padding: 0;
      border: 0;
      background: none;
      color: var(--text-color);
      font: inherit;
      font-size: var(--text-s);
      outline: none;
    }
    .conversations__search:focus-within input,
    .conversations__search.is-on input {
      inline-size: 100%;
    }
    .conversations__search:focus-within {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: calc(-1 * var(--focus-width));
    }
    .conversations__search input::placeholder {
      color: var(--text-faint);
    }
    .conversations__search input::-webkit-search-cancel-button {
      appearance: none;
    }
    .conversations__filter-open {
      flex-shrink: 0;
      padding: var(--space-2xs) 0;
      border: 0;
      border-block-end: var(--line-hairline) solid var(--border-color-dark);
      background: none;
      color: var(--text-muted);
      font: inherit;
      font-size: var(--text-s);
      cursor: pointer;
    }
    .conversations__filter-open:hover {
      color: var(--text-color);
    }
    .conversations__filter-n {
      margin-inline-start: var(--space-xs);
      font-variant-numeric: tabular-nums;
    }
    .conversations__filter-n::before {
      content: '·';
      margin-inline-end: var(--space-xs);
    }
    .conversations__active {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
    }
    /* In the sheet: one field under another, at the sheet's width. */
    .conversations__sheet {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }
    .conversations__sheet > :global(*) {
      inline-size: 100%;
    }

    /* The pane at rest: a short digest in the middle of the empty paper. */
    .conversations__pane:has(.conversations__rest) {
      display: grid;
      place-items: center;
    }
    .conversations__rest {
      max-inline-size: var(--chat-rest-measure);
    }
    .conversations__rest p {
      margin: 0;
    }
    .conversations__rest-big {
      font-family: var(--font-display);
      font-style: italic;
      font-size: var(--text-xl);
      line-height: var(--display-line-height);
    }
    .conversations__rest-sub {
      margin-block-start: var(--space-xs);
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    .conversations__rest-open {
      margin-block-start: var(--space-s);
      padding: 0;
      border: 0;
      background: none;
      color: var(--text-color);
      font: inherit;
      font-size: var(--text-s);
      text-decoration: underline;
      text-decoration-color: var(--border-color-dark);
      text-underline-offset: 0.25em;
      cursor: pointer;
    }
    .conversations__rest-open:hover {
      text-decoration-color: currentColor;
    }
    .action-bar__more,
    .action-bar__acts {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-xs);
    }
    .action-bar__caret {
      margin-inline-start: var(--space-2xs);
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
      .action-bar__keep,
      .conversations__filter-open {
        min-block-size: var(--touch-target);
      }
    }
  }
</style>
