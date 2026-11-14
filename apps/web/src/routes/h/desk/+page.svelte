<script lang="ts">
  /**
   * HOY (ADR-117; redrawn by ADR-202 and ADR-203, tareas 144 y 145): three
   * blocks in a fixed order, the same on every width.
   *
   *   1 · El día        the one filled piece, the agenda inside it ($lib/day-agenda)
   *   2 · Lo que viene  day tiles, two weeks or ten at most, four on a phone ($lib/hoy comingTiles)
   *   3 · Te espera     one pill per kind, the rows of most weight ($lib/desk-feed rankWaiting)
   *
   * On a desktop «Ha cambiado» (since your last visit, $lib/desk-bands) and
   * «La temporada» (one door per lens) stay (ADR-202 § 15); on a phone they
   * leave (§ 1). Ahora is no longer a screen: on a gig day the piece opens
   * with what it showed (§ 5), and `?mode=ahora` lands here.
   *
   * Calm (ADR-139 § 5, ADR-203 § 5, `$lib/calm`) keeps the day, what comes
   * and the pills, without rows. Each block loads and fails on its own.
   *
   * EVERYTHING FOLLOWS THE SCOPE (ADR-202 § 13), the day and what comes too;
   * a notice never does (§ 14). The math is pure and tested in $lib; this
   * file fetches, scopes and hands down. Queries share their keys with the
   * lenses they summarise (Books, Conversations, the thread feed, the rail):
   * one cache.
   */
  import { docTitle } from '$lib/doc-title';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { tick } from 'svelte';
  import { fetchJSON, mutateJSON, ApiError } from '$lib/api';
  import { addToast } from '$lib/components/Toast.svelte';
  import { lazy } from '$lib/lazy.svelte';
  import { scopeDoor } from '$lib/scope-door';
  import LensHeader from '$lib/components/LensHeader.svelte';
  import FirstVisitCard from '$lib/components/FirstVisitCard.svelte';
  import StartList from '$lib/components/desk/StartList.svelte';
  import { startTarget, type StartPhase } from '$lib/first-day';
  import DeskDay from '$lib/components/desk/DeskDay.svelte';
  import DeskComing from '$lib/components/desk/DeskComing.svelte';
  import DeskWaiting from '$lib/components/desk/DeskWaiting.svelte';
  import DeskChanged from '$lib/components/desk/DeskChanged.svelte';
  import DeskSeason from '$lib/components/desk/DeskSeason.svelte';
  import LateNoticeBand from '$lib/components/desk/LateNoticeBand.svelte';
  import { COMING_TILES, COMING_TILES_PHONE, comingTiles, nextAfterToday, outsideToday, scopePulseInput, waitingRowCount } from '$lib/hoy';
  import { MediaQuery } from 'svelte/reactivity';
  import { MOBILE_QUERY } from '$lib/breakpoints';
  import { goto } from '$app/navigation';
  import { accentVarFor } from '$lib/utils/accent';
  import { spaceName } from '$lib/utils/identity';
  import { appLocale, LOCALE_TAG, t, tradeFor } from '$lib/i18n';
  import { viewerTimeZone } from '$lib/datetime';
  import { dayKeyInTz, plannerDayHref } from '$lib/planner';
  import { page } from '$app/state';
  import { usePins } from '$lib/stores/pins.svelte';
  import { useCalm } from '$lib/stores/calm.svelte';
  import { buildLineIndex, buildProjectIndex, resolveScope, workspacesOnScreen, type NavWorkspace, type RawLine } from '$lib/nav';
  import { workspacesQueryOptions, activeProjectsQueryOptions, allLinesQueryOptions } from '$lib/nav-queries';
  import { moneyAccessAnyQueryOptions } from '$lib/bolo-queries';
  import { conversationAccessQueryOptions } from '$lib/conversation-access';
  import { otherTagsName, scopeTags } from '$lib/conversation-tags';
  import { chatLine } from '$lib/chat-row';
  import type { ConversationItem } from '$lib/conversation';
  import { conversationTagsQueryOptions } from '$lib/conversation-tags-query';
  import { lensOn } from '$lib/lenses.svelte';
  import { taskWorkspaces } from '$lib/workspace-role';
  import type { DeskConversation } from '$lib/components/DeskBoard.svelte';
  import { taskProjectId, type TaskItem, type TasksCache, type TaskTarget } from '$lib/task';
  import {
    buildDeskFeed,
    laterSummary,
    overviewReplies,
    rankWaiting,
    type DeskConvInput,
    type DeskDecisionInput,
    type DeskItem,
    type DeskOption,
  } from '$lib/desk-feed';
  import { dueOption, type Decision } from '$lib/planner';
  import { invalidatePerformanceFeeds } from '$lib/plan-create';
  import {
    changedBandLoading,
    changesSince,
    elapsedSince,
    paymentNews,
    paymentsSinceEarlier,
    plannerDoor,
    sinceInstant,
    type RecordedPayment,
  } from '$lib/desk-bands';
  import { shows } from '$lib/calm';
  import { blockDrawn } from '$lib/dashboard-blocks';
  import { daysAgoLabel } from '$lib/conversation';
  import { upcoming } from '$lib/pulse';
  import { agendaDay, agendaPoints, dayAgenda } from '$lib/day-agenda';
  import { createPulseFeeds, pulseSlipContext } from '$lib/pulse-feeds.svelte';
  import { perfDayKey, perfWorkspaceId, type SlipKind } from '$lib/month-events';
  import { clashesInSeason, seasonWindow } from '$lib/season';
  import { createPlannerEngine } from '$lib/planner-engine.svelte';
  import { seasonAvailabilityQueryOptions } from '$lib/planner-feeds.svelte';
  import { currentSeason } from '$lib/season-year';
  import { screenSeasonStart, seasonStarts } from '$lib/season-start.svelte';
  import {
    conversationOverviewQueryOptions,
    lastMailoutQueryOptions,
    waitingConversationsQueryOptions,
    waitingTasksQueryOptions,
  } from '$lib/waiting-feeds';
  import { boardUnread, type BoardView, type ThreadFeedView } from '$lib/threads';
  import { restoredFromDevice } from '$lib/offline';
  import { markHoyContent } from '$lib/vitals';
  import {
    invoicesByBolo,
    fmtCurrency,
    isContracted,
    moneyPosition,
    observedPayerTermsDays,
    type InvoicingMode,
    type MoneyBolo,
    type MoneyInvoiceItem,
  } from '$lib/money';

  type Conversation = DeskConversation & { workspace_id: string };

  const pins = usePins();
  const calm = useCalm();
  const queryClient = useQueryClient();
  // «Reintentar» on any band: read again exactly what failed, nothing else.
  const retryFailed = () => void queryClient.refetchQueries({ predicate: (q) => q.state.status === 'error' });
  const locale = appLocale();
  const viewerTz = viewerTimeZone();

  // Tick on the minute so buckets roll over at midnight (shell-clock idiom).
  let clockNow = $state(new Date());
  $effect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      timer = setTimeout(() => {
        clockNow = new Date();
        step();
      }, 60_000 - (Date.now() % 60_000));
    };
    step();
    return () => clearTimeout(timer);
  });
  let today = $derived(dayKeyInTz(clockNow.toISOString(), viewerTz));

  const money = (n: number, cur: string | null) => fmtCurrency(n, cur, locale);

  // ── «Since your last visit»: per device, in this browser (Phase 0: one
  //    device is enough). Read once on arrival; written on the way out, so a
  //    reload does not wipe what you have not looked at yet. ──────────────
  const VISIT_KEY = 'hour.desk.last-visit';
  function readVisit(): string | null {
    try {
      return localStorage.getItem(VISIT_KEY);
    } catch {
      return null;
    }
  }
  const lastVisit = readVisit();
  const since = sinceInstant(lastVisit, new Date());
  // A visit counts once Hoy has shown what changed: leaving before that (a
  // remount, a quick tap away) keeps the last visit, so nothing unseen is lost.
  let shown = false;
  $effect(() => {
    if (feeds.settled) shown = true;
  });
  $effect(() => {
    const save = () => {
      if (!shown) return;
      try {
        localStorage.setItem(VISIT_KEY, new Date().toISOString());
      } catch {
        /* private window: «since» falls back to a week */
      }
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') save();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      save();
    };
  });
  const sinceLabel = new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(since));

  // ── Containers and scope ──────────────────────────────────────────────
  const workspacesQuery = createQuery(workspacesQueryOptions());
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());
  let workspaces = $derived<NavWorkspace[]>($workspacesQuery.data?.items ?? []);
  let workspaceSlug = $derived(workspaces[0]?.slug ?? '');
  let workspaceSlugById = $derived(new Map(workspaces.map((w) => [w.id, w.slug])));
  let projectIndex = $derived(buildProjectIndex(workspaces, $projectsQuery.data?.items ?? []));
  let lineIndex = $derived(buildLineIndex(workspaces, ($linesQuery.data?.items as RawLine[]) ?? []));
  let scope = $derived(resolveScope(pins.pins, workspaces, lineIndex, projectIndex));
  let scopedProjectIds = $derived(new Set(scope.projectIds));
  let scopeUnresolved = $derived(
    (pins.lineIds().length > 0 && scope.lines.length !== pins.lineIds().length) ||
      (pins.projectIds().length > 0 && scope.projects.length !== pins.projectIds().length),
  );
  let filterIds = $derived({ projectIds: scope.projectIds, workspaceIds: scope.workspaceIds });
  let lineIds = $derived(scope.lines.map((l) => l.id));
  const byProject = (pid: string | null | undefined, wsId?: string | null) => {
    if (scope.isEmpty) return true;
    if (wsId && scope.workspaceIds.includes(wsId)) return true;
    return !!pid && scopedProjectIds.has(pid);
  };
  function feedParams(k: { projectIds: string[]; workspaceIds: string[] }, extra: Record<string, string> = {}): string {
    const p = new URLSearchParams(extra);
    if (k.projectIds.length > 0) p.set('project_ids', k.projectIds.join(','));
    if (k.workspaceIds.length > 0) p.set('workspace_ids', k.workspaceIds.join(','));
    return p.toString();
  }

  // ── The day and what comes: the rail's feeds, the rail's answer ────────
  const feeds = createPulseFeeds(() => today);
  /**
   * THE SCOPE NARROWS THE DAY TOO (ADR-202 § 13, tarea 145; it did not,
   * ADR-096 § 5): the pulse's rows are read unscoped and narrowed here, so
   * the line under the piece counts what of yours today stays out (§ 14,
   * ADR-203 § 8) from the difference, with no second read.
   */
  let rawPulseInput = $derived({ performances: feeds.performances, dates: feeds.dates, viewerTz, axis: feeds.axis });
  let pulseInput = $derived(scopeUnresolved ? { ...rawPulseInput, performances: [], dates: [] } : scopePulseInput(rawPulseInput, scope));
  /**
   * The day as an agenda inside the piece, what is on now opened as its
   * headline (ADR-150): today while anything of it is on or ahead, and only
   * today (ADR-153). Then «Coming up», the days after it (ADR-202 § 6). The
   * pulse's own rows and order (`upcoming`), so the piece, the tiles and the
   * rail never disagree. An option to decide keeps its tile and its «?» even
   * when «Te espera» asks it too (ADR-203 § 10, amends ADR-154 § 4). On a
   * phone, four tiles and then «Planner →»; the desktop column keeps ten
   * (ADR-205).
   */
  let coming = $derived(upcoming(pulseInput, clockNow, 40));
  // `phone` is declared further down: read it inside the closure.
  let tiles = $derived.by(() => comingTiles(coming, today, phone.current ? COMING_TILES_PHONE : COMING_TILES));
  let nextThing = $derived(nextAfterToday(coming, today));
  // Nothing within two weeks: one sentence names what comes (ADR-149).
  let farNext = $derived(tiles.length === 0 ? nextThing : null);
  let agendaOn = $derived(agendaDay(pulseInput, clockNow));
  let agenda = $derived(agendaOn ? dayAgenda(pulseInput, agendaOn, clockNow) : null);
  let todayPoints = $derived(agendaPoints(pulseInput, today));
  // The line of what the scope leaves out takes the scope off (ADR-202 § 14):
  // the frame's field owns clearing it, the line borrows its door.
  const door = scopeDoor();
  /** «1 más hoy fuera de MaMeMi»: what of yours today the scope leaves out. */
  let outsideLine = $derived.by(() => {
    if (scope.isEmpty || scopeUnresolved || !feeds.axisSettled) return null;
    const n = outsideToday(rawPulseInput, scope, today);
    if (n === 0) return null;
    const names = [
      ...workspaces.filter((w) => scope.workspaceIds.includes(w.id)).map((w) => spaceName(w.name)),
      ...scope.projects.map((p) => p.name),
      ...scope.lines.map((l) => l.name),
    ];
    return t(n === 1 ? 'desk.outside_one' : 'desk.outside_many', locale, { n, scope: names.join(', ') });
  });
  /** The performance the piece's actions are about: the focus, else the day's main one. */
  let cardPerformanceId = $derived.by(() => {
    if (!agenda) return '';
    const focus = agenda.focus !== null ? agenda.points[agenda.focus] : null;
    const p = focus?.ref.of === 'performance' ? focus : agenda.points.find((x) => x.main);
    return p?.ref.id ?? '';
  });
  const kindLabel = (kind: SlipKind) => t(`planner.kind_${kind}`, locale);
  let slipCtx = $derived(pulseSlipContext(feeds.workspaces, viewerTz, kindLabel));

  // ── Ahora is no longer a screen (ADR-202 § 5, ADR-203 § 7): a link or a
  //    bookmark with `?mode=ahora` lands on Hoy, whose piece is that day.
  $effect(() => {
    if (page.url.searchParams.get('mode') !== 'ahora') return;
    const u = new URL(page.url);
    u.searchParams.delete('mode');
    void goto(`${u.pathname}${u.search}`, { replaceState: true, noScroll: true, keepFocus: true });
  });

  // Phone: Hoy is three blocks; «Ha cambiado» and «La temporada» stay on a
  // desktop only (ADR-202 § 1 and § 15).
  const phone = new MediaQuery(MOBILE_QUERY, false);
  // «Tablón · N nuevos» (plan 2026-10-22 § 3.3): the card's performance's
  // board, under the record's own key, so opening it costs nothing more.
  // The signal that was missing on the day of the show; no mail, no push.
  let nextPerformanceId = $derived(cardPerformanceId);
  const nextBoardQuery = createQuery(
    toStore(() => ({
      queryKey: ['bolo-board', nextPerformanceId] as const,
      enabled: Boolean(nextPerformanceId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<BoardView>(`/api/boards/${nextPerformanceId}`, signal),
    })),
  );
  let nextBoardNew = $derived(nextPerformanceId ? boardUnread($nextBoardQuery.data) : 0);

  // ── Band 2 · Te espera ─────────────────────────────────────────────────
  // The reads of «Te espera», shared with the Planner's margin (ADR-138 § 6).
  const conversationsQuery = createQuery(waitingConversationsQueryOptions());
  const tasksQuery = createQuery(waitingTasksQueryOptions());

  // Money: the Books keys and URLs, so the Desk and Cuentas share one cache.
  // Only an explicit «yes» to read:money opens it: without it, no trace. A
  // space that does not use Cuentas (ADR-132) leaves no trace either.
  const accessQuery = createQuery(moneyAccessAnyQueryOptions());
  let readMoney = $derived($accessQuery.data?.read_money === true && lensOn('books'));
  const invoicesQuery = createQuery(
    toStore(() => ({
      queryKey: ['invoices', { p: filterIds.projectIds, w: filterIds.workspaceIds }] as const,
      enabled: readMoney && !scopeUnresolved,
      retry: false,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        // Same URL as Cuentas (`limit=200`): one cache key, one answer.
        fetchJSON<{ items: MoneyInvoiceItem[] }>(`/api/invoices?${feedParams(filterIds, { limit: '200' })}`, signal),
    })),
  );
  const bolosQuery = createQuery(
    toStore(() => ({
      queryKey: ['money-bolos', { p: filterIds.projectIds, w: filterIds.workspaceIds }] as const,
      enabled: readMoney && !scopeUnresolved,
      retry: false,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: MoneyBolo[] }>(`/api/money/bolos?${feedParams(filterIds, { limit: '500' })}`, signal),
    })),
  );

  let conversations = $derived(($conversationsQuery.data?.items ?? []) as Conversation[]);
  let tasks = $derived<TaskItem[]>($tasksQuery.data?.items ?? []);
  let invoices = $derived<MoneyInvoiceItem[]>(readMoney ? ($invoicesQuery.data?.items ?? []) : []);
  let scopedConversations = $derived(conversations.filter((e) => byProject(e.project?.id, e.workspace_id)));
  let scopedTasks = $derived(
    tasks.filter((tk) => !removing.has(tk.id) && byProject(taskProjectId(tk), tk.workspace_id)),
  );
  let scopedPerfs = $derived(feeds.performances.filter((p) => byProject(p.project?.id, perfWorkspaceId(p) ?? undefined)));
  let scopedDates = $derived(feeds.dates.filter((d) => byProject(d.project?.id, d.project?.workspace_id)));

  // The Conversations overview: its «te toca» replies wait in band 2, its
  // «caliente» feeds band 3 and its figures the door (one cache with the lens).
  // Conversations exists for whoever reads them somewhere (ADR-124), the
  // LensSwitcher's own flag: only an explicit «no» hides the door.
  const convAccessQuery = createQuery(conversationAccessQueryOptions());
  // And only where the space uses the lens (ADR-132): off, its calls, replies,
  // movement and door leave the Desk with it.
  let readConversations = $derived($convAccessQuery.data?.read !== false && lensOn('conversations'));
  const overviewQuery = createQuery(
    toStore(() => conversationOverviewQueryOptions(filterIds, lineIds, !scopeUnresolved && readConversations)),
  );
  let overview = $derived(readConversations ? ($overviewQuery.data ?? null) : null);
  // The last mailout, its own read (2026-10-24): a band with other news does
  // not wait for it (it joins them when it lands); one with none stays busy
  // until it answers, never «nothing new» before (`changedBandLoading`).
  const lastMailoutQuery = createQuery(
    toStore(() => lastMailoutQueryOptions(filterIds, !scopeUnresolved && readConversations && !phone.current)),
  );
  // Subscribed now (see `waitingLoading`): its readers sit behind `readConversations`.
  void $lastMailoutQuery;
  let lastMailout = $derived(readConversations ? ($lastMailoutQuery.data?.last_mailout ?? null) : null);
  let projectNameById = $derived(new Map(projectIndex.map((p) => [p.id, p.name])));
  // A reply from the press waits as one from a venue (ADR-138 fase 3); the
  // row says its tag when it is not Difusión.
  const tagsQuery = createQuery(toStore(() => conversationTagsQueryOptions(readConversations)));
  let tagNames = $derived(
    $tagsQuery.data
      ? scopeTags(
          $tagsQuery.data,
          // The spaces on screen, as the lens's chips speak for them.
          scope.isEmpty
            ? workspaces.map((w) => w.id)
            : [...new Set([...scope.workspaceIds, ...scope.projects.map((p) => p.workspaceId), ...scope.lines.map((l) => l.workspaceId)])],
        )
      : [],
  );
  let replies = $derived(
    overviewReplies(overview?.due.rows ?? [], workspaceSlugById, projectNameById, (keys) => otherTagsName(keys, tagNames, locale)),
  );

  // A document of a deal not yet confirmed is a quote, not a debt (ADR-123):
  // «te espera» leaves it out, as Cuentas and this page's own door do.
  let debtInvoices = $derived.by(() => {
    const statusById = new Map(($bolosQuery.data?.items ?? []).map((b) => [b.id, b.status]));
    return invoices.filter((inv) =>
      inv.lines.every((l) => !l.bolo_id || !statusById.has(l.bolo_id) || isContracted(statusById.get(l.bolo_id)!)),
    );
  });

  let feed = $derived(
    buildDeskFeed(
      {
        conversations: (readConversations ? scopedConversations : []) as DeskConvInput[],
        tasks: scopedTasks,
        invoices: readMoney && $invoicesQuery.isSuccess && $bolosQuery.isSuccess ? debtInvoices : undefined,
        showToday: scopedPerfs.some((p) => p.status !== 'cancelled' && perfDayKey(p) === today),
        replies,
        decisions: lensOn('planner') ? deskDecisions() : [],
      },
      clockNow,
      locale,
    ),
  );
  let later = $derived(laterSummary(feed));

  // Everything that waits, ranked: the pills count it all, the rows draw
  // its head (ADR-202 § 7): none in calm (ADR-203 § 5) nor on a gig day
  // (§ 9), five on a day with nothing, three otherwise.
  let waiting = $derived(rankWaiting(feed, clockNow, { limit: Infinity }));
  let waitingRows = $derived(
    waitingRowCount({
      calm: calm.on,
      gig: scopedPerfs.some((p) => p.status !== 'cancelled' && perfDayKey(p) === today),
      empty: todayPoints.length === 0,
    }),
  );

  // Every store read before any `||`: a `$query` only read past a pending one
  // is not subscribed yet, and a query nobody subscribes to does not fetch.
  // Short-circuited, `tasks` waited for `conversations` to come back (measured
  // 2026-10-24: 1.8 s later on every open).
  let waitingLoading = $derived.by(() => {
    const pending = [
      $conversationsQuery.isPending,
      $tasksQuery.isPending,
      $workspacesQuery.isPending,
      $accessQuery.isPending,
      $overviewQuery.isPending,
    ];
    return pending[0] || pending[1] || pending[2] || pending[3] || (readConversations && pending[4]);
  });
  let waitingErrored = $derived($conversationsQuery.isError || $tasksQuery.isError);

  // ── Band 3 · Ha cambiado, and the Conversations door ───────────────────
  // The team's threads are the Equipo view of Conversations (ADR-134): with
  // the lens off, the Desk does not read them either (ADR-132 § 3). Not gated
  // by Converses: a thread is read by its own rule (ADR-106).
  let readTeam = $derived(lensOn('conversations'));
  const threadsQuery = createQuery(
    toStore(() => ({
      queryKey: ['thread-feed', filterIds.projectIds, filterIds.workspaceIds] as const,
      enabled: !scopeUnresolved && readTeam && !phone.current,
      staleTime: 0,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<ThreadFeedView>(`/api/threads?${feedParams(filterIds)}`, signal),
    })),
  );
  // «Cobrado»: payments someone else recorded since the last visit (ADR-133),
  // named by the deal through the Books feeds already in cache. Scoped like
  // them: a payment whose deal and invoice are both out of scope is not news here.
  const paymentsQuery = createQuery(
    toStore(() => ({
      queryKey: ['desk-payments', since, workspaces.map((w) => w.id)] as const,
      enabled: readMoney && workspaces.length > 0 && !phone.current,
      retry: false,
      placeholderData: () =>
        paymentsSinceEarlier(
          queryClient.getQueriesData<{ items: RecordedPayment[] }>({ queryKey: ['desk-payments'] }),
          since,
          workspaces.map((w) => w.id),
        ),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: RecordedPayment[] }>(
          `/api/payments?${new URLSearchParams({ workspace_ids: workspaces.map((w) => w.id).join(','), recorded_since: since, others: '1', limit: '50' })}`,
          signal,
        ),
    })),
  );
  let boloById = $derived(new Map(($bolosQuery.data?.items ?? []).map((b) => [b.id, b])));
  let paymentsNews = $derived.by(() => {
    if (!readMoney || !$paymentsQuery.isSuccess || !$bolosQuery.isSuccess || !$invoicesQuery.isSuccess) return [];
    const invoiceById = new Map(invoices.map((i) => [i.id, i]));
    const scoped = ($paymentsQuery.data?.items ?? []).filter(
      (p) => scope.isEmpty || (p.invoice_id && invoiceById.has(p.invoice_id)) || (p.bolo_id && boloById.has(p.bolo_id)),
    );
    return paymentNews(scoped, boloById, invoiceById);
  });
  let changes = $derived(
    changesSince(
      {
        threads: readTeam ? ($threadsQuery.data?.threads ?? []) : [],
        hot: overview?.hot.rows ?? [],
        lastMailout,
        payments: paymentsNews,
      },
      since,
      clockNow,
      new Set(replies.map((r) => r.id)),
    ),
  );
  let changedErrored = $derived(
    (readConversations && ($overviewQuery.isError || $lastMailoutQuery.isError)) ||
      (readTeam && $threadsQuery.isError) ||
      (readMoney && $paymentsQuery.isError),
  );
  let changedLoading = $derived.by(() => {
    // Read up front, as `waitingLoading` does: a store read only behind `||` is not subscribed.
    const overviewPending = $overviewQuery.isPending;
    const mailoutPending = $lastMailoutQuery.isPending;
    const threadsPending = $threadsQuery.isPending;
    const paymentsPending = $paymentsQuery.isPending;
    return changedBandLoading({
      errored: changedErrored,
      pending: [readConversations && overviewPending, readTeam && threadsPending, readMoney && paymentsPending],
      mailoutPending: readConversations && mailoutPending,
      hasChanges: changes.length > 0,
    });
  });
  // A band with nothing in it is not drawn (ADR-145 § 1). «Te espera» is
  // there while anything waits, or while its head carries Hoy's «+»
  // (ADR-203 § 1): then it says «Todo al día.» itself.
  let waitsState = $derived({
    count: feed.reduce((n, b) => n + b.runs.reduce((m, r) => m + r.items.length, 0), 0),
    loading: waitingLoading,
    errored: waitingErrored,
  });
  let changedState = $derived({ count: changes.length, loading: changedLoading, errored: changedErrored });
  // «Todo al día.» would lie while the start list lives (tarea 137, StartList).
  let startPhase = $state<StartPhase>('none');
  let startHolding = $state(false);
  let drawChanged = $derived(!phone.current && shows('desk', 'changed', calm.on) && blockDrawn(changedState));
  let quietLabel = $derived.by(() => {
    if (!lastVisit) return t('desk.changed_none_first', locale);
    const e = elapsedSince(since, clockNow);
    // Under an hour the minutes are noise: you were just here.
    if (e.unit === 'min') return t('desk.changed_none_recent', locale);
    const ago = e.unit === 'h' ? t('desk.ago_hours', locale, { n: e.n }) : daysAgoLabel(e.n, locale);
    return t('desk.changed_none', locale, { ago });
  });

  // ── Band 4 · La temporada ──────────────────────────────────────────────
  // The Planner's own engine over the pulse's rows: its census and its
  // «Choques» (`clashesInSeason`), the Season's rule, never a second one.
  // Its blocks are the Season's feed (same key): an absence clashes here
  // as it does there. Like the Season, nothing before today counts.
  let season = $derived(seasonWindow(today));
  const seasonBlocksQuery = createQuery(
    toStore(() => seasonAvailabilityQueryOptions(season.weeks[0][0], season.to, lensOn('planner'))),
  );
  let seasonBlocks = $derived($seasonBlocksQuery.data?.items ?? []);
  const engine = createPlannerEngine({
    scopedPerfs: () => scopedPerfs,
    scopedDates: () => scopedDates,
    rawPerfs: () => feeds.performances,
    rawDates: () => feeds.dates,
    allBlackouts: () => seasonBlocks,
    visibleBlackouts: () => [],
    window: () => ({ first: season.from, last: season.to, days: season.days }),
    decisionPerfs: () => scopedPerfs,
    viewerTz,
    // The engine reads its day once, as on the Planner (a reload rolls it).
    todayIso: dayKeyInTz(new Date().toISOString(), viewerTz),
  });
  // «Te espera» asks for the Planner's decisions too (ADR-149): two options on
  // one day, or one to let go. The same queue the Season lists, one engine.
  const sideName = (s: Decision['a']) => s.venue || s.city || s.project;
  const isOption = (status: string) => status !== 'confirmed';
  /** A performance's own page, which a lens opens as its vistazo (ADR-139 p1). */
  function performancePage(id: string): string | null {
    const p = scopedPerfs.find((x) => x.id === id);
    const ws = p && workspaceSlugById.get(perfWorkspaceId(p) ?? '');
    return p?.slug && ws ? `/h/${ws}/performance/${p.slug}` : null;
  }
  function deskDecisions(): DeskDecisionInput[] {
    const notice = new Map(scopedPerfs.map((p) => [p.id, p.hold_notice_days]));
    return engine.decisionQueue.decisions.map((d) => {
      // A release: `loose` is the open option, `kept` the confirmed one.
      const flip = d.kind === 'release' && isOption(d.a.status);
      const kept = flip ? d.b : d.a;
      const loose = flip ? d.a : d.b;
      return {
        id: d.id,
        day: d.day,
        decideBy: d.decideBy,
        kind: d.kind,
        a: sideName(kept),
        b: sideName(loose),
        projectName: d.a.project === d.b.project ? d.a.project : `${d.a.project} · ${d.b.project}`,
        // «decidir»: the option that falls due first, in its vistazo; «liberar»
        // is answered on the row, the Planner its fallback (ADR-165).
        href:
          (d.kind === 'choose' ? performancePage(dueOption(d, (id) => notice.get(id)).id) : null) ??
          plannerDayHref('day', d.day),
        option: d.kind === 'release' ? { id: loose.id, status: loose.status } : null,
      };
    });
  }

  // ── «Liberar» on a release row (ADR-165 § 1; only that verb, ADR-167 § 1):
  //    the record's own write (a status PATCH), with «Deshacer» instead of a
  //    question, as the bulk actions. The undo puts back the status it had.
  let deciding = $state<string | null>(null);
  async function setOptionStatus(id: string, status: string) {
    await mutateJSON('PATCH', `/api/performances/${id}`, { status });
    await Promise.all([invalidatePerformanceFeeds(queryClient), queryClient.invalidateQueries({ queryKey: ['performance'] })]);
  }
  async function decide(item: DeskItem) {
    const option: DeskOption | null = item.option;
    if (!option || deciding) return;
    deciding = item.id;
    try {
      await setOptionStatus(option.id, 'cancelled');
      addToast({
        tone: 'success',
        message: t('desk.decision_released', locale, { name: item.subject }),
        // Time to read it and reach «Deshacer».
        duration: 8000,
        action: {
          label: t('ui.undo', locale),
          run: () =>
            void setOptionStatus(option.id, option.status).then(
              () => addToast({ tone: 'info', message: t('ui.undone', locale) }),
              (err: unknown) =>
                addToast({ tone: 'danger', title: t('ui.not_undone', locale), message: err instanceof ApiError ? err.message : t('perf.unexpected', locale) }),
            ),
        },
      });
    } catch (err) {
      addToast({ tone: 'danger', title: t('desk.toast_change_failed', locale), message: err instanceof ApiError ? err.message : t('perf.unexpected', locale) });
    } finally {
      deciding = null;
    }
  }
  let plannerFig = $derived(
    feeds.settled && !$seasonBlocksQuery.isPending
      ? plannerDoor(
          {
            confirmed: engine.stats.confirmed,
            holds: engine.stats.holds,
            clashes: clashesInSeason(engine.conflicts, engine.eventDayById, engine.decisionQueue.decisions, season)
              .length,
          },
          { dates: scopedDates, viewerTz },
          season,
        )
      : null,
  );
  let convFig = $derived(
    overview ? { holds: overview.season.bolos.option, live: overview.live, due: overview.due.count } : null,
  );
  let moneyFig = $derived.by(() => {
    if (!$bolosQuery.isSuccess || !$invoicesQuery.isSuccess) return null;
    const bolos = ($bolosQuery.data?.items ?? []).filter(
      (b) => byProject(b.project?.id, b.project?.workspace_id) || (!!b.line_id && scope.lineIds.includes(b.line_id)),
    );
    const modeById = new Map(
      workspaces.map((w) => [w.id, ((w as NavWorkspace & { invoicing_mode?: string }).invoicing_mode ?? 'legal') as InvoicingMode]),
    );
    const positions = moneyPosition(
      bolos,
      {
        invoicesByBolo: invoicesByBolo(invoices),
        termsByPayer: observedPayerTermsDays(invoices, invoices.flatMap((i) => i.payments)),
        modeOf: (b) => modeById.get(b.project?.workspace_id ?? '') ?? 'legal',
        today: clockNow,
        seasonStarts: seasonStarts(),
      },
      currentSeason(clockNow, screenSeasonStart()).year,
    );
    const pos = positions.find((p) => p.currency === 'EUR') ?? positions[0];
    if (!pos) return { owed: money(0, 'EUR'), overdue: money(0, 'EUR'), overdueCount: 0, nothingOwed: true };
    // Other currencies ride behind the main one («60 € + 3.000 US$»): never summed, never hidden.
    const others = positions.filter((p) => p !== pos);
    const withOthers = (main: number, pick: (p: (typeof positions)[number]) => number) =>
      [money(main, pos.currency), ...others.filter((p) => pick(p) > 0).map((p) => money(pick(p), p.currency))].join(' + ');
    return {
      owed: withOthers(pos.owed, (p) => p.owed),
      overdue: withOthers(pos.overdue, (p) => p.overdue),
      overdueCount: positions.reduce((n, p) => n + p.overdueCount, 0),
      nothingOwed: positions.every((p) => p.owed === 0),
    };
  });
  let seasonLabel = $derived(t('overview.season_of', locale, { season: currentSeason(clockNow, screenSeasonStart()).label }));

  // aria-busy: the containers the pins resolve against and the lists the
  // Desk folds. Read by the E2E (`tests/loaded.ts`) as «the lens has loaded».
  let busy = $derived(
    waitingLoading || $projectsQuery.isPending || $linesQuery.isPending || !feeds.settled,
  );
  // The first time it has drawn its data, a real phone's timing (ADR-157).
  $effect(() => {
    if (!busy) markHoyContent(restoredFromDevice());
  });

  // ── Header: the piece says the day (ADR-202 § 3, ADR-203 § 1) ─────────
  // The lens's title went with the header of the sketch: what it said
  // (ADR-148 § 1, ADR-153 § 2) the piece says now. The heading stays for a
  // screen reader; the frame's new header is another lane (tarea 146).
  let hadToday = $derived(todayPoints.length > 0);
  // ── Task + proposal mutations (TaskBoard contract; optimistic toggle). ──
  // One PATCH for the check (status) and for accepting a proposal (origin).
  const patchTask = createMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<TaskItem, 'status' | 'origin'>> }) =>
      mutateJSON<{ task: TaskItem }>('PATCH', `/api/tasks/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const snapshots = queryClient.getQueriesData<TasksCache>({ queryKey: ['tasks'] });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        queryClient.setQueryData(key, { ...data, items: data.items.map((tk) => (tk.id === id ? { ...tk, ...patch } : tk)) });
      }
      return { snapshots };
    },
    onError: (err, _v, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) queryClient.setQueryData(key, data);
      addToast({ tone: 'danger', title: t('desk.toast_change_failed', locale), message: err instanceof ApiError ? err.message : t('perf.unexpected', locale) });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
  const removeTask = createMutation({
    mutationFn: (id: string) => mutateJSON('DELETE', `/api/tasks/${id}`),
    onSettled: (_d, _e, id) => {
      removing.delete(id);
      removing = new Set(removing);
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err) =>
      addToast({ tone: 'danger', title: t('desk.toast_remove_failed', locale), message: err instanceof ApiError ? err.message : t('perf.unexpected', locale) }),
  });

  // Removing a task is a toast with «Deshacer»: the row leaves at once and
  // the DELETE waits out the toast. Leaving the Desk sends what is pending.
  const UNDO_MS = 5000;
  let removing = $state(new Set<string>());
  const pendingRemovals = new Map<string, ReturnType<typeof setTimeout>>();
  function removeWithUndo(id: string) {
    const title = tasks.find((tk) => tk.id === id)?.title ?? '';
    removing = new Set(removing).add(id);
    pendingRemovals.set(
      id,
      setTimeout(() => {
        pendingRemovals.delete(id);
        $removeTask.mutate(id);
      }, UNDO_MS),
    );
    addToast({
      tone: 'info',
      message: t('desk.toast_removed', locale, { title }),
      duration: UNDO_MS,
      action: {
        label: t('desk.undo', locale),
        run: () => {
          clearTimeout(pendingRemovals.get(id));
          pendingRemovals.delete(id);
          removing.delete(id);
          removing = new Set(removing);
        },
      },
    });
  }
  $effect(() => () => {
    for (const [id, timer] of pendingRemovals) {
      clearTimeout(timer);
      void mutateJSON('DELETE', `/api/tasks/${id}`).finally(() => queryClient.invalidateQueries({ queryKey: ['tasks'] }));
    }
    pendingRemovals.clear();
  });

  // AI consent inbox (ADR-069, ADR-131): «Añadir» makes the proposal a normal
  // task (origin → manual, persisted); «Descartar» removes it, with «Deshacer».
  const isGhost = (i: DeskItem) => i.concern === 'task' && i.isProposal && i.taskId != null;

  // ── «+ Tarea»: the composer is an occasional gesture, so it waits behind
  //    a button. TaskComposer owns the POST + cache; the default target
  //    follows the pins; the picker attaches to a show or a conversation. ──
  let composerOpen = $state(false);
  let composerEl = $state<HTMLDivElement | null>(null);
  let addBtn = $state<HTMLButtonElement | null>(null);
  // Escape folds the composer back behind its button, focus included.
  $effect(() => {
    if (!composerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      composerOpen = false;
      addBtn?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  // Its code arrives with the first «+», not with Hoy ($lib/lazy, ADR-157).
  const composer = lazy(() => import('$lib/components/TaskComposer.svelte'));
  async function openComposer() {
    composerOpen = !composerOpen;
    if (!composerOpen) return;
    await composer.load();
    await tick();
    composerEl?.querySelector<HTMLElement>('input, textarea')?.focus();
  }
  // A task is written where the person may write one (`$lib/workspace-role`):
  // never into a space they are a guest of (a bolo invitation), which would
  // answer 403. Among the spaces on screen (the scope's, or all of them);
  // with none, the button is not drawn.
  let spacesOnScreen = $derived(workspacesOnScreen('', pins.pins, workspaces, lineIndex, projectIndex));
  let taskSpaces = $derived(taskWorkspaces(spacesOnScreen));
  // «Te espera» is drawn while anything waits, or for the «+» in its head.
  let drawWaits = $derived(blockDrawn(waitsState) || (taskSpaces.length > 0 && startPhase === 'none'));
  // Primer día (tarea 137): the start list of the space just made, in the
  // welcome's place while it lives; never two cards at once.
  let startSpace = $derived(startTarget(spacesOnScreen));

  let defaultWsId = $derived(
    scope.workspaceIds.length === 1 && taskSpaces.some((w) => w.id === scope.workspaceIds[0])
      ? scope.workspaceIds[0]
      : (taskSpaces[0]?.id ?? ''),
  );
  let composerTarget = $derived.by<TaskTarget>(() => {
    const ws = taskSpaces.find((w) => w.id === defaultWsId) ?? taskSpaces[0];
    return ws
      ? { kind: 'space', id: ws.id, name: spaceName(ws.name), accent: accentVarFor(ws) }
      : { kind: 'space', id: '', name: '', accent: 'var(--text-faint)' };
  });
  let composerPerformances = $derived(
    feeds.performances.map((p) => ({
      id: p.id,
      workspaceId: perfWorkspaceId(p),
      name: [p.venue?.name || p.venue_name || p.project?.name || t('desk.fallback_show', locale, undefined, tradeFor(perfWorkspaceId(p))), p.city]
        .filter(Boolean)
        .join(' · '),
    })),
  );
  let composerConversations = $derived(
    conversations.map((c) => ({
      id: c.id,
      name:
        c.person?.full_name ||
        c.person?.organization_name ||
        c.next_action_note ||
        c.project?.name ||
        t('desk.fallback_conversation', locale),
    })),
  );
  function onTaskCreated(task: TaskItem) {
    if (byProject(taskProjectId(task), task.workspace_id)) return;
    const space = workspaces.find((w) => w.id === task.workspace_id);
    addToast({
      tone: 'info',
      title: t('composer.outside_scope_title', locale),
      message: t('composer.outside_scope_msg', locale, {
        space: space ? spaceName(space.name) : t('composer.outside_scope_fallback', locale),
      }),
    });
  }

  // On the cross-space (Everything) view, prepend the space so rows from
  // different spaces don't blur. Only the space segment may be lowercased.
  let spaceNameByProjectId = $derived(new Map(projectIndex.map((p) => [p.id, spaceName(p.workspaceName)])));
  const contextPath = (i: DeskItem) => {
    const space = scope.isEmpty && i.projectId ? spaceNameByProjectId.get(i.projectId) : null;
    return [space, i.projectName, i.lineName, i.tagName].filter((x) => x && x !== '—').join(' · ');
  };
  // «Te espera», the chat row (mesa, punto 6; ADR-177 § 8: only this row
  // changes): with whom in words and the last thing said, from the same read
  // as the calls (`waitingConversationsQueryOptions`, its rows carry the turn).
  let conversationById = $derived(
    new Map((($conversationsQuery.data?.items ?? []) as unknown as ConversationItem[]).map((c) => [c.id, c])),
  );
  const deskChat = (i: DeskItem) => {
    const c = i.conversationId ? conversationById.get(i.conversationId) : undefined;
    return c ? chatLine(c, clockNow, locale) : null;
  };
  const conversationHref = (i: DeskItem) => {
    const ws = (i.workspaceId && workspaceSlugById.get(i.workspaceId)) || workspaceSlug;
    return i.conversationId && ws ? `/h/${ws}/conversation/${i.conversationId}` : null;
  };
</script>

<svelte:head><title>{docTitle(t('lens.desk', locale))}</title></svelte:head>

<div class="desk" class:desk--calm={calm.on} aria-busy={busy}>
  <!-- The lens heading, heard and not seen: the piece says the day (ADR-203 § 1). -->
  {#snippet title()}{t('lens.desk', locale)}{/snippet}
  <LensHeader help="desk" heard {title} />

  <!-- 121 B (ADR-183): a late technician comes first, while nobody marked
       «Visto». A notice is never scoped (ADR-202 § 14). -->
  <LateNoticeBand {locale} />

  <StartList workspace={startSpace} bind:phase={startPhase} bind:holding={startHolding} />
  {#if startPhase === 'none' && !startHolding}
    <FirstVisitCard section="desk" steps={['desk-next', 'desk-coming', 'desk-waits']} />
  {/if}

  <!-- «+»: a task is an occasional gesture; it lives in the head of «Te
       espera», where what it makes appears (ADR-203 § 1). Without a space to
       write one in, no «+». -->
  {#snippet addTask()}
    <button
      type="button"
      class="lenshead__act desk__add"
      bind:this={addBtn}
      aria-label={t('desk.add_task', locale)}
      title={t('desk.add_task', locale)}
      aria-expanded={composerOpen}
      onclick={openComposer}><span aria-hidden="true">+</span></button
    >
  {/snippet}
  {#snippet composerSlot()}
    {#if composerOpen && taskSpaces.length > 0 && composer.component}
      <div class="desk__composer" bind:this={composerEl}>
        <composer.component
          {locale}
          target={composerTarget}
          performances={composerPerformances}
          conversations={composerConversations}
          onCreated={onTaskCreated}
        />
      </div>
    {/if}
  {/snippet}

  <!-- THREE BLOCKS, IN A FIXED ORDER (ADR-202 § 1): the day, what comes,
       what waits. On a desktop the news and the season's doors stay (§ 15):
       the news under them, the doors in their own column. -->
  <div class="desk__grid">
    <div class="desk__col">
      <div class="slot slot--next" data-help-step="desk-next">
        <DeskDay
          {agenda}
          todayHad={hadToday}
          next={nextThing}
          outside={outsideLine}
          onclearscope={door?.clear}
          now={clockNow}
          workspaces={feeds.workspaces}
          settled={feeds.settled && !scopeUnresolved}
          errored={feeds.errored}
          onretry={retryFailed}
          {today}
          {viewerTz}
          updatedAt={feeds.updatedAt || null}
          boardNew={nextBoardNew}
          {slipCtx}
          {locale}
        />
      </div>
      <DeskComing
        {tiles}
        far={farNext}
        settled={feeds.settled && !scopeUnresolved}
        errored={feeds.errored}
        {today}
        {viewerTz}
        {slipCtx}
        {locale}
      />
      {#if drawWaits}
      <div class="slot slot--waits" data-help-step="desk-waits">
        <DeskWaiting
          {waiting}
          rows={waitingRows}
          {today}
          add={taskSpaces.length > 0 ? addTask : undefined}
          composer={composerSlot}
          {feed}
          {later}
          loading={waitingLoading}
          errored={waitingErrored}
          onretry={retryFailed}
          {locale}
          {contextPath}
          {conversationHref}
          chat={deskChat}
          {money}
          {isGhost}
          ontoggle={(id, done) => $patchTask.mutate({ id, patch: { status: done ? 'done' : 'open' } })}
          onremove={removeWithUndo}
          onaccept={(id) => $patchTask.mutate({ id, patch: { origin: 'manual' } })}
          {deciding}
          ondecide={decide}
        />
      </div>
      {/if}
      {#if drawChanged}
      <div class="slot slot--changed">
        <DeskChanged
          {changes}
          loading={changedLoading}
          errored={changedErrored}
          onretry={retryFailed}
          {quietLabel}
          {sinceLabel}
          {workspaceSlugById}
          {tagNames}
          {locale}
        />
      </div>
      {/if}
    </div>

    {#if !phone.current && shows('desk', 'season', calm.on)}
      <div class="desk__col">
        <div class="slot slot--season">
          <DeskSeason
            planner={lensOn('planner') ? { value: plannerFig, errored: feeds.errored } : null}
            conversations={readConversations ? { value: convFig, errored: $overviewQuery.isError } : null}
            money={readMoney ? { value: moneyFig, errored: $invoicesQuery.isError || $bolosQuery.isError } : null}
            {seasonLabel}
            {locale}
          />
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  @layer components {
    .desk {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
    }
    .desk__composer {
      margin-block-end: var(--space-s);
    }

    .desk__grid {
      display: grid;
      grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
      gap: var(--space-l) var(--space-xl);
      align-items: start;
    }
    .desk__col {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
      min-inline-size: 0;
    }
    /* Calm: one column at a reading measure, from the lens's own left edge
       (the edge never moves between routes, tokens.css `--page-width`). The
       head keeps the page's width, so the lens switcher does not move. */
    .desk--calm .desk__grid {
      grid-template-columns: minmax(0, 1fr);
      max-inline-size: var(--calm-measure);
    }

    /* The chrome every band shares: the eyebrow, its count or door, the
       empty and error lines. One treatment, here. */
    /* A band is a section, and a top-level section carries page padding
       and a flex gap in the defaults layer: a band is not a page. */
    .desk :global(.dband) {
      display: block;
      padding: 0;
    }
    /* Each band's head is the dashboards' one (BlockHead); here only its place. */
    .desk :global(.dband > .block-head) {
      margin-block-end: var(--space-s);
    }
    /* A failure is base.css's `.load-fail`, the one voice of the dashboards;
       an empty band is EmptyLine, the one voice of every block. */

    /* Wide, the rail's cut (64rem, $lib/breakpoints). Phone and tablet: one column, in DOM order (1, 2, 4, 3): no `order`,
       so the tab and the screen reader go where the eye goes (móvil #2).
       Beside the rail, under 64 rem, two columns left the season's doors
       and the waiting list a word wide (20-10); from 64 rem up, two. */
    @media (max-width: 63.999rem) {
      .desk__grid {
        display: flex;
        flex-direction: column;
        align-items: stretch;
      }
      .desk__col {
        display: contents;
      }
    }
  }
</style>
