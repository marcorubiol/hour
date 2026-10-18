<script lang="ts">
  /**
   * Desk as a dashboard (ADR-117, proposal A; ADR-121). «What asks for my
   * attention today, of everything», in four bands:
   *
   *   1 · Lo siguiente  — the rail's NEXT with room ($lib/pulse, same feeds)
   *   2 · Te espera     — the short list by weight ($lib/desk-feed rankWaiting)
   *   3 · Ha cambiado   — since your last visit ($lib/desk-bands changesSince)
   *   4 · La temporada  — one door per lens, in the lens's own arithmetic
   *
   * Desktop: two columns, what you act on (1, 2) on the left and what you
   * look at (4, 3) on the right. Phone: one column in the same order as the
   * DOM, 1, 2, 4, 3, so focus and reading follow what is seen. Calm keeps 1 and 2.
   * Each band loads and fails on its own; none of them is the page's error.
   *
   * Bands 2–4 follow the scope like every lens; band 1 does not, like the rail
   * (ADR-096 § 5). The math is pure and tested in $lib; this file fetches,
   * scopes and hands down. Queries share their keys with the lenses they
   * summarise (Books, Conversations, the thread feed, the rail) — one cache.
   */
  import { docTitle } from '$lib/doc-title';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { tick } from 'svelte';
  import { fetchJSON, mutateJSON, ApiError } from '$lib/api';
  import { addToast } from '$lib/components/Toast.svelte';
  import TaskComposer from '$lib/components/TaskComposer.svelte';
  import LensHeader from '$lib/components/LensHeader.svelte';
  import LensTitle from '$lib/components/LensTitle.svelte';
  import DeskNext from '$lib/components/desk/DeskNext.svelte';
  import DeskWaiting from '$lib/components/desk/DeskWaiting.svelte';
  import DeskChanged from '$lib/components/desk/DeskChanged.svelte';
  import DeskSeason from '$lib/components/desk/DeskSeason.svelte';
  import { accentVarFor } from '$lib/utils/accent';
  import { spaceName } from '$lib/utils/identity';
  import { detectLocale, LOCALE_TAG, t } from '$lib/i18n';
  import { localeDayMonth } from '$lib/datetime';
  import { addDaysIso, dayKeyInTz, plannerDayHref } from '$lib/planner';
  import { usePins } from '$lib/stores/pins.svelte';
  import { useCalm } from '$lib/stores/calm.svelte';
  import { buildLineIndex, buildProjectIndex, resolveScope, type NavWorkspace, type RawLine } from '$lib/nav';
  import { workspacesQueryOptions, activeProjectsQueryOptions, allLinesQueryOptions, teamQueryOptions } from '$lib/nav-queries';
  import { moneyAccessAnyQueryOptions } from '$lib/bolo-queries';
  import { conversationAccessQueryOptions } from '$lib/conversation-access';
  import { lensOn } from '$lib/lenses.svelte';
  import type { DeskConversation } from '$lib/components/DeskBoard.svelte';
  import { taskProjectId, type TaskItem, type TasksCache, type TaskTarget } from '$lib/task';
  import {
    buildDeskFeed,
    goingItem,
    laterSummary,
    rankWaiting,
    GOING_DAYS,
    type DeskConvInput,
    type DeskItem,
  } from '$lib/desk-feed';
  import { changesSince, elapsedSince, goingAsks, paymentNews, plannerDoor, sinceInstant, type RecordedPayment } from '$lib/desk-bands';
  import { daysAgoLabel } from '$lib/conversation';
  import { computePulse } from '$lib/pulse';
  import { createPulseFeeds, pulseSlipContext } from '$lib/pulse-feeds.svelte';
  import { dateSlip, perfDayKey, performanceSlip, type DateEvent, type PerformanceEvent, type SlipKind } from '$lib/month-events';
  import { clashesInSeason, seasonWindow } from '$lib/season';
  import { createPlannerEngine } from '$lib/planner-engine.svelte';
  import { seasonAvailabilityQueryOptions } from '$lib/planner-feeds.svelte';
  import { currentSeason, type OverviewResponse } from '$lib/conversation-overview';
  import type { ThreadFeedView } from '$lib/threads';
  import { setCommitment } from '$lib/commitments';
  import {
    invoicesByBolo,
    fmtCurrency,
    isContracted,
    moneyPosition,
    observedPayerTermsDays,
    seasonOf as moneySeasonOf,
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
  const locale = detectLocale(navigator.language);
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

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
  $effect(() => {
    const save = () => {
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

  // ── Band 1 · Lo siguiente — the rail's feeds, the rail's answer ────────
  const feeds = createPulseFeeds(() => today);
  let pulse = $derived(
    computePulse({ performances: feeds.performances, dates: feeds.dates, viewerTz, axis: feeds.axis }, clockNow),
  );
  /** A second thing within 48 h of the first: the same answer, the first removed. */
  let then = $derived.by(() => {
    const first = pulse.next;
    if (!first) return null;
    const second = computePulse(
      {
        performances: feeds.performances.filter((p) => p.id !== first.ref.id),
        dates: feeds.dates.filter((d) => d.id !== first.ref.id),
        viewerTz,
        axis: feeds.axis,
      },
      clockNow,
    ).next;
    return second && second.day <= addDaysIso(first.day, 2) ? second : null;
  });
  /**
   * The eve of a show that comes with a trip: the card is the show's day (its
   * hours, its road sheet) and the trip that leads to it is the line before.
   * Otherwise the card is the next thing and the line what follows.
   */
  let lead = $derived.by(() => {
    const a = pulse.next;
    const b = then;
    if (a && b && a.day === b.day && a.ref.of !== 'performance' && b.ref.of === 'performance')
      return { card: b, line: a, before: true };
    return { card: a, line: b, before: false };
  });
  const kindLabel = (kind: SlipKind) => t(`planner.kind_${kind}`, locale);
  let slipCtx = $derived(pulseSlipContext(feeds.workspaces, viewerTz, kindLabel));
  // Who goes, by name: the Planner's team feed (same key, one cache). Null
  // until it lands, so the card never says «sin reparto» while it loads.
  const teamQuery = createQuery(toStore(() => teamQueryOptions(feeds.workspaces.map((w) => w.id))));
  let personNames = $derived(
    $teamQuery.isSuccess ? new Map(($teamQuery.data?.items ?? []).map((m) => [m.person_id, m.full_name])) : null,
  );

  // ── Band 2 · Te espera ─────────────────────────────────────────────────
  const conversationsQuery = createQuery({
    queryKey: ['conversations', 'today'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: Conversation[] }>('/api/conversations?status=any&limit=100', signal),
  });
  const tasksQuery = createQuery({
    queryKey: ['tasks', 'open'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: TaskItem[] }>('/api/tasks?status=open&limit=200', signal),
  });

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

  let conversations = $derived<Conversation[]>($conversationsQuery.data?.items ?? []);
  let tasks = $derived<TaskItem[]>($tasksQuery.data?.items ?? []);
  let invoices = $derived<MoneyInvoiceItem[]>(readMoney ? ($invoicesQuery.data?.items ?? []) : []);
  let scopedConversations = $derived(conversations.filter((e) => byProject(e.project?.id, e.workspace_id)));
  let scopedTasks = $derived(
    tasks.filter((tk) => !removing.has(tk.id) && byProject(taskProjectId(tk), tk.workspace_id)),
  );
  let scopedPerfs = $derived(feeds.performances.filter((p) => byProject(p.project?.id, p.project?.workspace_id)));
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
    toStore(() => ({
      queryKey: ['conversation-overview', filterIds.projectIds, filterIds.workspaceIds, lineIds] as const,
      enabled: !scopeUnresolved && readConversations,
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        const p = new URLSearchParams(feedParams(filterIds));
        if (lineIds.length > 0) p.set('line_ids', lineIds.join(','));
        return fetchJSON<OverviewResponse>(`/api/conversations/overview?${p}`, signal);
      },
    })),
  );
  let overview = $derived(readConversations ? ($overviewQuery.data ?? null) : null);
  let projectNameById = $derived(new Map(projectIndex.map((p) => [p.id, p.name])));
  let replies = $derived(
    (overview?.due.rows ?? [])
      .filter((r) => r.reason === 'reply')
      .map((r) => {
        const ws = workspaceSlugById.get(r.workspace_id);
        return {
          id: r.id,
          title: r.title,
          projectId: r.project_id,
          projectName: projectNameById.get(r.project_id) ?? '',
          at: r.at,
          href: ws ? `/h/${ws}/conversation/${r.id}` : null,
        };
      }),
  );

  // A document of a deal not yet confirmed is a quote, not a debt (ADR-123):
  // «te espera» leaves it out, as Cuentas and this page's own door do.
  let debtInvoices = $derived.by(() => {
    const statusById = new Map(($bolosQuery.data?.items ?? []).map((b) => [b.id, b.status]));
    return invoices.filter((inv) =>
      inv.lines.every((l) => !l.bolo_id || !statusById.has(l.bolo_id) || isContracted(statusById.get(l.bolo_id)!)),
    );
  });

  /** «Voy · no voy» Hour has for you; band 1 already asks about its own row. */
  let asks = $derived(
    goingAsks(
      { performances: scopedPerfs, dates: scopedDates, axis: feeds.axis, viewerTz },
      today,
      GOING_DAYS,
      new Set(lead.card ? [lead.card.ref.id] : []),
    ).map((a) => {
      const slip =
        a.of === 'performance'
          ? performanceSlip(a.row as PerformanceEvent, slipCtx)
          : dateSlip(a.row as DateEvent, slipCtx);
      return goingItem({
        of: a.of,
        id: a.id,
        day: a.day,
        subject: [slip.name, slip.city].filter(Boolean).join(' · '),
        projectId: a.row.project?.id ?? null,
        projectName: a.row.project?.name ?? '',
        href: slip.href ?? (lensOn('planner') ? plannerDayHref('day', a.day) : null),
      });
    }),
  );
  let feed = $derived(
    buildDeskFeed(
      {
        conversations: (readConversations ? scopedConversations : []) as DeskConvInput[],
        tasks: scopedTasks,
        invoices: readMoney && $invoicesQuery.isSuccess && $bolosQuery.isSuccess ? debtInvoices : undefined,
        showToday: scopedPerfs.some((p) => p.status !== 'cancelled' && perfDayKey(p) === today),
        replies,
        asks,
      },
      clockNow,
      locale,
    ),
  );
  let later = $derived(laterSummary(feed));

  let waiting = $derived(rankWaiting(feed, clockNow, { calm: calm.on }));

  let waitingLoading = $derived(
    $conversationsQuery.isPending ||
      $tasksQuery.isPending ||
      $workspacesQuery.isPending ||
      $accessQuery.isPending ||
      (readConversations && $overviewQuery.isPending),
  );
  let waitingErrored = $derived($conversationsQuery.isError || $tasksQuery.isError);

  // ── Band 3 · Ha cambiado, and the Conversations door ───────────────────
  // The team's threads are the Equipo view of Conversations (ADR-134): with
  // the lens off, the Desk does not read them either (ADR-132 § 3). Not gated
  // by Converses: a thread is read by its own rule (ADR-106).
  let readTeam = $derived(lensOn('conversations'));
  const threadsQuery = createQuery(
    toStore(() => ({
      queryKey: ['thread-feed', filterIds.projectIds, filterIds.workspaceIds] as const,
      enabled: !scopeUnresolved && readTeam,
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
      enabled: readMoney && workspaces.length > 0,
      retry: false,
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
        lastMailout: overview?.last_mailout ?? null,
        payments: paymentsNews,
      },
      since,
      clockNow,
      new Set(replies.map((r) => r.id)),
    ),
  );
  let changedErrored = $derived(
    (readConversations && $overviewQuery.isError) ||
      (readTeam && $threadsQuery.isError) ||
      (readMoney && $paymentsQuery.isError),
  );
  let changedLoading = $derived(
    !changedErrored &&
      ((readConversations && $overviewQuery.isPending) ||
        (readTeam && $threadsQuery.isPending) ||
        (readMoney && $paymentsQuery.isPending)),
  );
  let quietLabel = $derived.by(() => {
    if (!lastVisit) return t('desk.changed_none_first', locale);
    const e = elapsedSince(since, clockNow);
    const ago =
      e.unit === 'min'
        ? t('desk.ago_min', locale, { n: e.n })
        : e.unit === 'h'
          ? t('desk.ago_hours', locale, { n: e.n })
          : daysAgoLabel(e.n, locale);
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
    overview ? { holds: overview.season.counts.hold, live: overview.live, due: overview.due.count } : null,
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
      },
      moneySeasonOf(clockNow.toISOString()),
    );
    const pos = positions.find((p) => p.currency === 'EUR') ?? positions[0];
    if (!pos) return { owed: money(0, 'EUR'), overdue: money(0, 'EUR'), overdueCount: 0 };
    // Other currencies ride behind the main one («60 € + 3.000 US$»): never summed, never hidden.
    const others = positions.filter((p) => p !== pos);
    const withOthers = (main: number, pick: (p: (typeof positions)[number]) => number) =>
      [money(main, pos.currency), ...others.filter((p) => pick(p) > 0).map((p) => money(pick(p), p.currency))].join(' + ');
    return {
      owed: withOthers(pos.owed, (p) => p.owed),
      overdue: withOthers(pos.overdue, (p) => p.overdue),
      overdueCount: positions.reduce((n, p) => n + p.overdueCount, 0),
    };
  });
  let seasonLabel = $derived(t('overview.season_of', locale, { season: currentSeason(clockNow).label }));

  // aria-busy: the containers the pins resolve against and the lists the
  // Desk folds. Read by the E2E (`tests/loaded.ts`) as «the lens has loaded».
  let busy = $derived(
    waitingLoading || $projectsQuery.isPending || $linesQuery.isPending || !feeds.settled,
  );

  // ── Header: the overdue and what waits, in one sentence ────────────────
  // What has no truth draws a dash (ADR-096 § 6): loading or failed, the
  // title claims nothing about what waits.
  let titleKnown = $derived(!waitingLoading && !waitingErrored);
  let titleRest = $derived(
    !titleKnown
      ? '—'
      : waiting.total === 0
      ? t('desk.title_waiting_zero', locale)
      : t(waiting.total === 1 ? 'desk.title_waiting_one' : 'desk.title_waiting_many', locale, { n: waiting.total }),
  );
  let titleOver = $derived(
    titleKnown && waiting.overdue > 0
      ? t(waiting.overdue === 1 ? 'desk.title_overdue_one' : 'desk.title_overdue_many', locale, { n: waiting.overdue })
      : null,
  );
  let dateWords = $derived(
    `${new Intl.DateTimeFormat(LOCALE_TAG[locale], { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${today}T12:00:00Z`))} · ${localeDayMonth(today, LOCALE_TAG[locale])}`,
  );

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

  async function answerGoing(g: NonNullable<DeskItem['going']>, state: 'going' | 'not_going') {
    if (!feeds.personId) return;
    try {
      await setCommitment(queryClient, g.of, g.id, feeds.personId, state);
    } catch (err) {
      addToast({ tone: 'danger', title: t('desk.toast_change_failed', locale), message: err instanceof ApiError ? err.message : t('perf.unexpected', locale) });
    }
  }

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
  async function openComposer() {
    composerOpen = !composerOpen;
    if (!composerOpen) return;
    await tick();
    composerEl?.querySelector<HTMLElement>('input, textarea')?.focus();
  }
  let defaultWsId = $derived(scope.workspaceIds.length === 1 ? scope.workspaceIds[0] : (workspaces[0]?.id ?? ''));
  let composerTarget = $derived.by<TaskTarget>(() => {
    const ws = workspaces.find((w) => w.id === defaultWsId) ?? workspaces[0];
    return ws
      ? { kind: 'space', id: ws.id, name: spaceName(ws.name), accent: accentVarFor(ws) }
      : { kind: 'space', id: '', name: '', accent: 'var(--text-faint)' };
  });
  let composerPerformances = $derived(
    feeds.performances.map((p) => ({
      id: p.id,
      name: [p.venue?.name || p.venue_name || p.project?.name || t('desk.fallback_show', locale), p.city]
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
    return [space, i.projectName, i.lineName].filter((x) => x && x !== '—').join(' · ');
  };
  const conversationHref = (i: DeskItem) => {
    const ws = (i.workspaceId && workspaceSlugById.get(i.workspaceId)) || workspaceSlug;
    return i.conversationId && ws ? `/h/${ws}/conversation/${i.conversationId}` : null;
  };
</script>

<svelte:head><title>{docTitle(t('lens.desk', locale))}</title></svelte:head>

<div class="desk" aria-busy={busy}>
  <LensHeader>
    {#snippet title()}
      <LensTitle
        text={titleOver ? `${titleOver} · ${titleRest}` : titleRest}
      />
    {/snippet}
    {#snippet sub()}
      <!-- One child, so the sub line's «·» separators stay out of it. -->
      <span class="desk__subrow">
        <span class="desk__date eyebrow eyebrow--sub">{dateWords}</span>
        <button type="button" class="desk__add btn--outline btn--s" bind:this={addBtn} aria-expanded={composerOpen} onclick={openComposer}
          >{t('desk.add_task', locale)}</button
        >
      </span>
    {/snippet}
  </LensHeader>

  {#if composerOpen}
    <div class="desk__composer" bind:this={composerEl}>
      <TaskComposer
        {locale}
        target={composerTarget}
        performances={composerPerformances}
        conversations={composerConversations}
        onCreated={onTaskCreated}
      />
    </div>
  {/if}

  <div class="desk__grid">
    <div class="desk__col">
      <div class="slot slot--next">
        <DeskNext
          next={lead.card}
          then={lead.line}
          thenBefore={lead.before}
          settled={feeds.settled}
          errored={feeds.errored}
          onretry={retryFailed}
          {today}
          {viewerTz}
          personId={feeds.personId}
          {slipCtx}
          {personNames}
          {locale}
        />
      </div>
      <div class="slot slot--waits">
        <DeskWaiting
          {waiting}
          {today}
          calm={calm.on}
          {feed}
          {later}
          loading={waitingLoading}
          errored={waitingErrored}
          onretry={retryFailed}
          {locale}
          {contextPath}
          {conversationHref}
          {money}
          {isGhost}
          ontoggle={(id, done) => $patchTask.mutate({ id, patch: { status: done ? 'done' : 'open' } })}
          onremove={removeWithUndo}
          onaccept={(id) => $patchTask.mutate({ id, patch: { origin: 'manual' } })}
          onanswer={answerGoing}
        />
      </div>
    </div>

    {#if calm.on}
      <div class="desk__col">
        <button type="button" class="desk__calm" onclick={() => calm.set(false)}>
          {t('desk.calm_folded', locale)} <span aria-hidden="true">→</span>
        </button>
      </div>
    {:else}
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
        <div class="slot slot--changed">
          <DeskChanged
            {changes}
            loading={changedLoading}
            errored={changedErrored}
          onretry={retryFailed}
            {quietLabel}
            {sinceLabel}
            {workspaceSlugById}
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
    .desk__subrow {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-m);
      inline-size: 100%;
    }
    /* The system's outline button (base.css), a step tighter in the sub line. */
    .desk__add[aria-expanded='true'] {
      --btn-text-color: var(--heading-color);
      --btn-border-color: var(--neutral-semi-light);
    }
    .desk__composer {
      margin-block-start: calc(-1 * var(--space-s));
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
    .desk__calm {
      align-self: start;
      padding: 0;
      border: 0;
      background: none;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-faint);
      cursor: pointer;
      text-align: start;
    }
    .desk__calm:hover {
      color: var(--text-muted);
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
    /* A failure is base.css's `.load-fail`, the one voice of the dashboards. */
    .desk :global(.dband__empty) {
      margin: 0;
      font-family: var(--font-display);
      font-style: italic;
      font-size: var(--text-s);
      color: var(--text-muted);
    }
    .desk :global(.dband__empty a) {
      color: inherit;
    }

    /* Phone: one column, in DOM order (1, 2, 4, 3): no `order`, so the tab
       and the screen reader go where the eye goes (móvil #2). */
    @media (max-width: 47.999rem) {
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
