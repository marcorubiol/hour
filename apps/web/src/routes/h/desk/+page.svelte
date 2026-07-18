<script lang="ts">
  /**
   * Desk (ADR-065/068/069/070 · converged design 2026-07-18) — the catch-up
   * surface reached by the hall door. ONE ranked feed, FOUR concerns
   * (tasks → agenda → conversations → money), grouped in day buckets, fixed
   * within-day order mirroring the lens nav. Today's/tomorrow's gig is the
   * bucket banner. The feed math is pure and tested in $lib/desk-feed; this
   * file fetches, scopes by pins, and renders.
   *
   * The gutter carries the type (a door to that lens); rows carry no marks.
   * Only tasks are stored — every other row is a call derived from state
   * (invoice overdue → "remind", conversation due → "reply") that vanishes
   * when the state changes. AI-proposed tasks (origin='ai') are the consent
   * inbox (ADR-069): real rows, accept/dismiss, never invented.
   *
   * Query keys ['conversations','today'], ['today-performances'], ['tasks','open']
   * are SHARED with the hall/HomeView — one cache. Chrome copy is i18n
   * (locale-resolved), matching the Catalan hall.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { fetchJSON, mutateJSON, ApiError } from '$lib/api';
  import { addToast } from '$lib/components/Toast.svelte';
  import TaskComposer from '$lib/components/TaskComposer.svelte';
  import LensSwitcher from '$lib/components/LensSwitcher.svelte';
  import { accentVar, accentVarFor } from '$lib/utils/accent';
  import { detectLocale, t } from '$lib/i18n';
  import { dayMonth } from '$lib/datetime';
  import { usePins } from '$lib/stores/pins.svelte';
  import { useCalm } from '$lib/stores/calm.svelte';
  import {
    buildLineIndex,
    buildProjectIndex,
    resolveScope,
    type NavWorkspace,
    type RawLine,
  } from '$lib/nav';
  import {
    workspacesQueryOptions,
    activeProjectsQueryOptions,
    allLinesQueryOptions,
  } from '$lib/nav-queries';
  import type { DeskConversation } from '$lib/components/DeskBoard.svelte';
  import { taskProjectId, type TaskItem, type TaskTarget } from '$lib/task';
  import {
    buildDeskFeed,
    deskSummary,
    type DeskConcern,
    type DeskConvInput,
    type DeskDateInput,
    type DeskInvoiceInput,
    type DeskItem,
    type DeskPerfInput,
    type ShowAnchor,
  } from '$lib/desk-feed';

  type Conversation = DeskConversation & { workspace_id: string };
  type DeskPerf = DeskPerfInput & {
    project: { id: string; slug: string | null; name: string; workspace_id: string } | null;
  };
  type DeskDate = DeskDateInput & {
    project: { id: string; slug: string | null; name: string; workspace_id: string } | null;
  };
  type DeskInvoice = DeskInvoiceInput & { project: { id: string; slug: string | null; name: string } | null };

  const pins = usePins();
  const calm = useCalm();
  const queryClient = useQueryClient();
  const locale = detectLocale(navigator.language);
  const todayParam = new Date().toISOString().slice(0, 10);

  // Tick on the minute so buckets roll over at midnight (shell-clock idiom).
  let clockNow = $state(new Date());
  $effect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(() => {
        clockNow = new Date();
        tick();
      }, 60_000 - (Date.now() % 60_000));
    };
    tick();
    return () => clearTimeout(timer);
  });

  const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const fmtTime = (iso: string | null) => (iso ? timeFmt.format(new Date(iso)) : '');
  const money = (n: number, cur: string | null) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: cur || 'EUR', maximumFractionDigits: 0 }).format(n);

  // ── Data ─────────────────────────────────────────────────────────────
  const workspacesQuery = createQuery(workspacesQueryOptions());
  let workspaceSlug = $derived($workspacesQuery.data?.items[0]?.slug ?? '');
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());
  const conversationsQuery = createQuery({
    queryKey: ['conversations', 'today'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: Conversation[] }>('/api/conversations?status=any&limit=100', signal),
  });
  const performancesQuery = createQuery({
    queryKey: ['today-performances'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: DeskPerf[] }>(`/api/performances?status=any&from=${todayParam}&limit=200`, signal),
  });
  const datesQuery = createQuery({
    queryKey: ['desk-dates', todayParam],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: DeskDate[] }>(`/api/dates?from=${todayParam}&limit=200`, signal),
  });
  const tasksQuery = createQuery({
    queryKey: ['tasks', 'open'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: TaskItem[] }>('/api/tasks?status=open&limit=200', signal),
  });
  // Money is fee-gated: a viewer without read:money gets 403 → isError → the
  // whole money concern (rows + € pulse) is suppressed silently (masked and
  // unset are indistinguishable by design).
  const invoicesQuery = createQuery({
    queryKey: ['desk-invoices'],
    retry: false,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: DeskInvoice[] }>('/api/invoices?limit=200', signal),
  });

  let workspaces = $derived<NavWorkspace[]>($workspacesQuery.data?.items ?? []);
  let projectIndex = $derived(buildProjectIndex(workspaces, $projectsQuery.data?.items ?? []));
  let lineIndex = $derived(buildLineIndex(workspaces, ($linesQuery.data?.items as RawLine[]) ?? []));
  let conversations = $derived<Conversation[]>($conversationsQuery.data?.items ?? []);
  let performances = $derived<DeskPerf[]>($performancesQuery.data?.items ?? []);
  let dates = $derived<DeskDate[]>($datesQuery.data?.items ?? []);
  let tasks = $derived<TaskItem[]>($tasksQuery.data?.items ?? []);
  let feeVisible = $derived($invoicesQuery.isSuccess);
  let invoices = $derived<DeskInvoice[]>(feeVisible ? ($invoicesQuery.data?.items ?? []) : []);

  // ── Scope by pins (empty = everything the user can see) ───────────────
  let scope = $derived(resolveScope(pins.pins, workspaces, lineIndex, projectIndex));
  let scopedProjectIds = $derived(new Set(scope.projectIds));
  const byProject = (pid: string | null | undefined, wsId?: string | null) => {
    if (scope.isEmpty) return true;
    if (wsId && scope.workspaceIds.includes(wsId)) return true;
    return !!pid && scopedProjectIds.has(pid);
  };

  let scopedConversations = $derived(
    conversations.filter((e) => byProject(e.project?.id, e.workspace_id)),
  );
  let scopedTasks = $derived(tasks.filter((tk) => byProject(taskProjectId(tk), tk.workspace_id)));
  let scopedPerformances = $derived(performances.filter((p) => byProject(p.project?.id, p.project?.workspace_id)));
  let scopedDates = $derived(dates.filter((d) => byProject(d.project?.id, d.project?.workspace_id)));
  let scopedInvoices = $derived(invoices.filter((i) => byProject(i.project?.id)));

  let feedInput = $derived({
    conversations: scopedConversations as DeskConvInput[],
    tasks: scopedTasks,
    performances: scopedPerformances as DeskPerfInput[],
    dates: scopedDates as DeskDateInput[],
    invoices: feeVisible ? (scopedInvoices as DeskInvoiceInput[]) : undefined,
  });
  let feed = $derived(buildDeskFeed(feedInput, clockNow, locale));
  let summary = $derived(deskSummary(feedInput, clockNow));

  let loading = $derived(
    $conversationsQuery.isPending || $tasksQuery.isPending || $performancesQuery.isPending || $datesQuery.isPending,
  );
  let errored = $derived($conversationsQuery.isError || $tasksQuery.isError || $performancesQuery.isError);

  // ── Calm mode — the toggle lives in the shell sidebar (by the clock); the
  //    Desk only consumes the shared store to fold the feed. ──────────────
  const bucketCount = (b: (typeof feed)[number]) => b.runs.reduce((n, r) => n + r.items.length, 0);
  // Count shown on the right of each day header (the show banner counts as one).
  const bucketTotal = (b: (typeof feed)[number]) => bucketCount(b) + (b.anchor ? 1 : 0);

  // ── Collapsible day buckets ────────────────────────────────────────────
  // Every day header folds (click); the count on its right says what's hidden.
  // Persisted by labelKey so folding the OVERDUE backlog once keeps it folded.
  const COLLAPSE_KEY = 'hour_desk_collapsed';
  function loadCollapsed(): Set<string> {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  }
  let collapsed = $state(loadCollapsed());
  function toggleCollapse(key: string) {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    collapsed = next;
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
    } catch {
      /* storage disabled — in-session fold still works */
    }
  }
  let visibleBuckets = $derived(calm.on ? feed.filter((b) => b.sortKey === 0) : feed);
  let foldedRest = $derived(
    calm.on ? feed.filter((b) => b.sortKey > 0).reduce((n, b) => n + bucketCount(b), 0) : 0,
  );
  let calmFolded = $derived(calm.on ? summary.overdue + foldedRest : 0);
  let headline = $derived(
    calm.on ? visibleBuckets.reduce((n, b) => n + bucketCount(b), 0) : summary.needYou,
  );

  // ── Gutter labels are doors to their lens (scope rides in the pins store). ──
  const LENS_HREF: Record<DeskConcern, string | null> = {
    task: null,
    agenda: '/h/calendar',
    conversation: '/h/conversations',
    money: '/h/money',
  };
  const concernLabel = (c: DeskConcern) => t(`desk.concern_${c}`, locale);
  const needYouText = (n: number) =>
    n === 0 ? t('desk.need_you_zero', locale) : n === 1 ? t('desk.need_you_one', locale) : t('desk.need_you_many', locale, { n });
  const personHref = (slug: string | null) => (slug && workspaceSlug ? `/h/${workspaceSlug}/person/${slug}` : null);

  let pulse = $derived.by(() => {
    const f: { text: string; href: string }[] = [];
    if (summary.live)
      f.push({
        text: summary.live === 1 ? t('desk.pulse_live_one', locale) : t('desk.pulse_live_many', locale, { n: summary.live }),
        href: '/h/conversations',
      });
    if (summary.holds)
      f.push({
        text: summary.holds === 1 ? t('desk.pulse_holds_one', locale) : t('desk.pulse_holds_many', locale, { n: summary.holds }),
        href: '/h/conversations',
      });
    if (summary.pipeline != null && summary.pipeline > 0)
      f.push({ text: t('desk.pulse_pipeline', locale, { amount: money(summary.pipeline, summary.currency) }), href: '/h/money' });
    if (summary.nextShowCity)
      f.push({ text: t('desk.pulse_next_show', locale, { place: summary.nextShowCity }), href: '/h/calendar' });
    return f;
  });

  // ── Task + proposal mutations (TaskBoard contract; optimistic toggle). ──
  type TasksCache = { items: TaskItem[] };
  const toggleTask = createMutation({
    mutationFn: ({ id, status }: { id: string; status: 'open' | 'done' }) =>
      mutateJSON<{ task: TaskItem }>('PATCH', `/api/tasks/${id}`, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const snapshots = queryClient.getQueriesData<TasksCache>({ queryKey: ['tasks'] });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        queryClient.setQueryData(key, { ...data, items: data.items.map((tk) => (tk.id === id ? { ...tk, status } : tk)) });
      }
      return { snapshots };
    },
    onError: (err, _v, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) queryClient.setQueryData(key, data);
      addToast({ tone: 'danger', title: 'Change not saved', message: err instanceof ApiError ? err.message : 'Unexpected error' });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
  const removeTask = createMutation({
    mutationFn: (id: string) => mutateJSON('DELETE', `/api/tasks/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (err) =>
      addToast({ tone: 'danger', title: 'Task not removed', message: err instanceof ApiError ? err.message : 'Unexpected error' }),
  });

  // AI consent inbox: dismiss = complete it (real PATCH). Accept = keep as a
  // normal task; `origin` is not in the PATCH whitelist, so acceptance is a
  // client acknowledgment for this session only — persistent accept needs an
  // origin-edit path (whitelist or a dedicated endpoint). KNOWN GAP.
  let accepted = $state(new Set<string>());
  function acceptProposal(id: string) {
    accepted.add(id);
    accepted = new Set(accepted);
  }

  // ── Composer — TaskComposer owns the POST + cache. The default target
  //    follows the pins (a free space task, the parentless authoring home);
  //    the picker attaches to any project / line / show / conversation. ─────
  let defaultWsId = $derived(
    scope.workspaceIds.length === 1 ? scope.workspaceIds[0] : (workspaces[0]?.id ?? ''),
  );
  let composerTarget = $derived.by<TaskTarget>(() => {
    const ws = workspaces.find((w) => w.id === defaultWsId) ?? workspaces[0];
    return ws
      ? { kind: 'space', id: ws.id, name: ws.name, accent: accentVarFor(ws) }
      : { kind: 'space', id: '', name: '', accent: 'var(--text-faint)' };
  });
  // Parents the Desk already has in cache — handed to the picker, no new fetch.
  let composerPerformances = $derived(
    performances.map((p) => ({
      id: p.id,
      name: [p.venue?.name || p.venue_name || p.project?.name || 'Show', p.city]
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
        'Conversation',
    })),
  );
  function onTaskCreated(task: TaskItem) {
    if (byProject(taskProjectId(task), task.workspace_id)) return;
    const space = workspaces.find((w) => w.id === task.workspace_id);
    addToast({
      tone: 'info',
      title: t('composer.outside_scope_title', locale),
      message: t('composer.outside_scope_msg', locale, {
        space: space?.name ?? t('composer.outside_scope_fallback', locale),
      }),
    });
  }

  // On the cross-space (Everything) view, prepend the space so rows from
  // different spaces don't blur; when scoped to one space it's redundant.
  let spaceNameByProjectId = $derived(new Map(projectIndex.map((p) => [p.id, p.workspaceName])));
  const contextPath = (i: DeskItem) => {
    const space = scope.isEmpty && i.projectId ? spaceNameByProjectId.get(i.projectId) : null;
    return [space, i.projectName, i.lineName].filter(Boolean).join(' · ');
  };
  const isGhost = (i: DeskItem) => i.concern === 'task' && i.isProposal && i.taskId != null && !accepted.has(i.taskId);
  // The show banner's road-sheet link: /h/<space>/performance/<slug>/roadsheet.
  const roadsheetHref = (a: ShowAnchor) => {
    const ws = workspaces.find((w) => w.id === a.workspaceId)?.slug;
    return ws && a.performanceSlug ? `/h/${ws}/performance/${a.performanceSlug}/roadsheet` : null;
  };
</script>

<svelte:head><title>Desk — Hour</title></svelte:head>

<div class="desk" class:desk--calm={calm.on}>
  <header class="desk__head">
    <div class="desk__titlerow">
      <p class="desk__count">
        {needYouText(headline)}{#if calm.on && calmFolded}<span class="desk__rest">{t('desk.rest_waits', locale)}</span>{/if}
      </p>
      <LensSwitcher />
    </div>
    {#if !loading && !errored}
      <p class="desk__pulse">
        {#each pulse as frag (frag.text)}<a class="desk__pulse-frag" href={frag.href}>{frag.text}</a>{/each}
      </p>
    {/if}
  </header>

  <TaskComposer
    {locale}
    target={composerTarget}
    performances={composerPerformances}
    conversations={composerConversations}
    onCreated={onTaskCreated}
  />

  {#if loading}
    <p class="desk__empty">{t('desk.loading', locale)}</p>
  {:else if errored}
    <p class="desk__empty desk__empty--err">{t('desk.error', locale)}</p>
  {:else if feed.length === 0}
    <div class="desk__caughtup">
      <p class="desk__caughtup-g" aria-hidden="true">·</p>
      <p class="desk__caughtup-l">{t('desk.caughtup_l', locale)}</p>
      <p class="desk__caughtup-s">{t('desk.caughtup_s', locale)}</p>
    </div>
  {:else}
    <div class="timeline">
      {#each visibleBuckets as bucket (bucket.sortKey)}
        <section class="bucket" class:bucket--today={bucket.sortKey === 0}>
          <button
            type="button"
            class="bucket__head"
            class:bucket__head--overdue={bucket.overdue}
            aria-expanded={!collapsed.has(bucket.labelKey)}
            onclick={() => toggleCollapse(bucket.labelKey)}
          >
            <span class="bucket__label"
              >{bucket.labelKey === 'weekday' ? bucket.weekday : t(`desk.bucket_${bucket.labelKey}`, locale)}</span
            >
            <span class="bucket__caret" aria-hidden="true">›</span>
            {#if bucket.dateLabel}<span class="bucket__date">{bucket.dateLabel}</span>{/if}
            <span class="bucket__count">{bucketTotal(bucket)}</span>
          </button>

          {#if !collapsed.has(bucket.labelKey)}
          {#if bucket.anchor}
            {@const rsHref = roadsheetHref(bucket.anchor)}
            <div class="anchor" style={`--c: ${accentVar(bucket.anchor.accentSlug)}`}>
              <div class="anchor__eye">
                {t('desk.anchor_show_today', locale, { project: bucket.anchor.projectName })}
              </div>
              <div class="anchor__venue">
                {bucket.anchor.venue}{bucket.anchor.city ? ` · ${bucket.anchor.city}` : ''}
              </div>
              <div class="anchor__foot">
                <div class="anchor__slots">
                  {#if bucket.anchor.loadInAt}<span
                      ><span class="anchor__k">{t('desk.anchor_loadin', locale)}</span> {fmtTime(bucket.anchor.loadInAt)}</span
                    >{/if}
                  {#if bucket.anchor.soundcheckAt}<span
                      ><span class="anchor__k">{t('desk.anchor_soundcheck', locale)}</span>
                      {fmtTime(bucket.anchor.soundcheckAt)}</span
                    >{/if}
                  {#if bucket.anchor.startAt}<span
                      ><span class="anchor__k">{t('desk.anchor_show', locale)}</span> {fmtTime(bucket.anchor.startAt)}</span
                    >{/if}
                  {#if bucket.anchor.loadOutAt}<span
                      ><span class="anchor__k">{t('desk.anchor_loadout', locale)}</span> {fmtTime(bucket.anchor.loadOutAt)}</span
                    >{/if}
                  {#if bucket.anchor.wrapAt}<span
                      ><span class="anchor__k">{t('desk.anchor_wrap', locale)}</span> {fmtTime(bucket.anchor.wrapAt)}</span
                    >{/if}
                </div>
                {#if rsHref}
                  <a class="anchor__rs" href={rsHref}>{t('desk.roadsheet', locale)} ↗</a>
                {/if}
              </div>
            </div>
          {/if}

          {#each bucket.runs as run (run.concern + run.items[0].id)}
            <div class="run run--{run.concern}">
              {#if LENS_HREF[run.concern]}
                <a class="run__label" href={LENS_HREF[run.concern]}>{concernLabel(run.concern)}</a>
              {:else}
                <span class="run__label">{concernLabel(run.concern)}</span>
              {/if}
              <div class="run__rows">
                {#each run.items as item (item.id)}
                  {#if isGhost(item)}
                    <div class="ghost">
                      <div class="ghost__head">
                        <span class="ghost__badge">{t('desk.proposed', locale)}</span>
                        <span class="ghost__subject">{item.subject}</span>
                      </div>
                      {#if item.reason}<p class="ghost__reason">{item.reason}</p>{/if}
                      <div class="ghost__actions">
                        <button type="button" class="ghost__add" onclick={() => item.taskId && acceptProposal(item.taskId)}
                          >{t('desk.proposal_add', locale)}</button
                        >
                        <button
                          type="button"
                          class="ghost__dismiss"
                          onclick={() => item.taskId && $toggleTask.mutate({ id: item.taskId, status: 'done' })}
                          >{t('desk.proposal_dismiss', locale)}</button
                        >
                      </div>
                    </div>
                  {:else if item.concern === 'task'}
                    <div class="drow drow--task" class:drow--overdue={item.overdue}>
                      <input
                        type="checkbox"
                        class="drow__check"
                        aria-label={item.subject}
                        checked={item.taskDone}
                        onchange={(e) =>
                          item.taskId && $toggleTask.mutate({ id: item.taskId, status: (e.currentTarget as HTMLInputElement).checked ? 'done' : 'open' })}
                      />
                      <span class="drow__subject">{item.subject}</span>
                      <span class="drow__tail">
                        {#if item.dueLabel}<span class="drow__due" class:drow__due--overdue={item.overdue}
                            >{t(`desk.due_${item.dueLabel}`, locale)}</span
                          >{:else if item.surfacesDay}<span class="drow__surfaces"
                            >{t('desk.surfaces', locale, { day: dayMonth(item.surfacesDay) })}</span
                          >{/if}
                        {#if contextPath(item)}<span class="drow__ctx">{contextPath(item)}</span>{/if}
                        <button
                          type="button"
                          class="drow__remove"
                          aria-label={`Remove: ${item.subject}`}
                          onclick={() => item.taskId && $removeTask.mutate(item.taskId)}>×</button
                        >
                      </span>
                    </div>
                  {:else}
                    <div class="drow" class:drow--overdue={item.overdue} class:drow--proposal={item.isProposal}>
                      <span class="drow__lead">
                        {#if item.concern === 'agenda'}{item.allDay
                            ? t('desk.all_day', locale)
                            : item.atISO
                              ? fmtTime(item.atISO)
                              : '—'}{:else}{t(`desk.verb_${item.verbKey}`, locale)}{/if}
                      </span>
                      {#if personHref(item.personSlug)}
                        <a class="drow__subject" href={personHref(item.personSlug)}>{item.subject}</a>
                      {:else if item.href}
                        <a class="drow__subject" href={item.href}>{item.subject}</a>
                      {:else}
                        <span class="drow__subject">{item.subject}</span>
                      {/if}
                      <span class="drow__tail">
                        {#if item.amount != null}<span class="drow__amount">{money(item.amount, item.currency)}</span>{/if}
                        {#if contextPath(item)}<span class="drow__ctx">{contextPath(item)}</span>{/if}
                      </span>
                    </div>
                  {/if}
                {/each}
              </div>
            </div>
          {/each}
          {/if}
        </section>
      {/each}

      {#if calm.on && calmFolded}
        <button type="button" class="calmfoot" onclick={() => calm.set(false)}>
          <span
            >{#if summary.overdue}<span class="calmfoot__over">{t('desk.calm_overdue', locale, { n: summary.overdue })}</span
              >{/if}{#if summary.overdue && foldedRest} {t('desk.calm_and', locale)} {/if}{#if foldedRest}{t('desk.calm_more', locale, {
                n: foldedRest,
              })}{/if} {t('desk.calm_tail', locale)}</span
          >
          <span class="calmfoot__arrow" aria-hidden="true">→</span>
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  @layer components {
    .desk {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
      /* per-concern tints (subtle — identity is textual, this is a whisper) */
      --c-task: var(--text-muted);
      --c-agenda: color-mix(in oklch, var(--info) 60%, var(--text-muted));
      --c-conversation: color-mix(in oklch, var(--primary) 60%, var(--text-muted));
      --c-money: color-mix(in oklch, var(--success) 60%, var(--text-muted));
    }

    /* ── Header ── */
    .desk__head {
      display: flex;
      flex-direction: column;
    }
    .desk__titlerow {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-m);
      /* The separator lives BETWEEN the title row and the pulse (design). */
      padding-block-end: var(--space-s);
      border-block-end: 1px solid var(--border-color-light);
    }
    .desk__count {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--text-xxl);
      line-height: 1;
      color: var(--heading-color);
    }
    .desk__rest {
      color: var(--text-faint);
      font-style: italic;
    }
    .desk__pulse {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs) var(--space-s);
      margin: var(--space-s) 0 0;
      font-size: var(--text-s);
    }
    .desk__pulse-frag {
      color: var(--text-muted);
      text-decoration: none;
      transition: color var(--transition);
    }
    .desk__pulse-frag:hover {
      color: var(--text-color);
    }
    .desk__pulse-frag + .desk__pulse-frag::before {
      content: '·';
      margin-inline-end: var(--space-s);
      color: var(--text-faint);
    }
    /* Calm quiets the whole surface one contrast step (overdue red survives). */
    .desk--calm {
      --border-color-dark: color-mix(in oklch, var(--neutral) 12%, transparent);
      --text-color: var(--text-muted);
    }

    /* ── Timeline ── */
    .timeline {
      display: flex;
      flex-direction: column;
    }
    .bucket {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      /* The rule reads as the HEADER's top edge, not the previous box's
         bottom: generous space ABOVE the line, a thin gap to the title below
         it. Every day gets one — OVERDUE included. */
      margin-block-start: var(--space-l);
      padding-block-start: var(--space-s);
      border-block-start: 1px solid var(--border-color-light);
    }
    .bucket:first-child {
      margin-block-start: 0;
    }
    /* The whole day header is the collapse toggle. */
    .bucket__head {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
      inline-size: 100%;
      padding: 0;
      background: none;
      border: 0;
      text-align: start;
      cursor: pointer;
    }
    /* Whisper-quiet disclosure caret, to the right of the word. */
    .bucket__caret {
      color: color-mix(in oklch, var(--text-faint) 50%, transparent);
      font-size: var(--text-xs);
      line-height: 1;
      transition:
        transform var(--transition),
        color var(--transition);
    }
    .bucket__head[aria-expanded='true'] .bucket__caret {
      transform: rotate(90deg);
    }
    .bucket__head:hover .bucket__caret {
      color: var(--text-faint);
    }
    .bucket__count {
      margin-inline-start: auto;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
    }
    .bucket__label {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .bucket--today .bucket__label {
      color: var(--primary);
    }
    .bucket__head--overdue .bucket__label {
      color: var(--danger);
    }
    .bucket__date {
      font-family: var(--font-display);
      font-style: italic;
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    /* ── Show anchor (banner) ── */
    .anchor {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      padding: var(--space-s) var(--space-m);
      border: 1px solid color-mix(in oklch, var(--c) 30%, var(--border-color-light));
      background: color-mix(in oklch, var(--c) 6%, var(--bg-ultra-light));
      border-radius: var(--radius-l);
    }
    .anchor__eye {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: color-mix(in oklch, var(--c) 70%, var(--text-muted));
    }
    .anchor__venue {
      font-family: var(--font-display);
      font-size: var(--text-l);
      color: var(--heading-color);
    }
    .anchor__slots {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .anchor__k {
      color: var(--text-faint);
      text-transform: uppercase;
      letter-spacing: var(--mono-letter-spacing-loose);
    }
    .anchor__foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-m);
      margin-block-start: var(--space-2xs);
    }
    .anchor__rs {
      flex: none;
      display: inline-flex;
      align-items: center;
      padding-block: var(--space-2xs);
      padding-inline: var(--space-s);
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius);
      background: var(--bg-ultra-light);
      font-size: var(--text-s);
      color: var(--text-muted);
      text-decoration: none;
      white-space: nowrap;
      transition:
        color var(--transition),
        border-color var(--transition);
    }
    .anchor__rs:hover {
      color: var(--text-color);
      border-color: var(--text-muted);
    }

    /* ── Concern runs: the gutter carries the type (a door), hairline rail ── */
    .run {
      display: grid;
      grid-template-columns: 7rem 1fr;
      align-items: start;
      --gut: var(--text-faint);
    }
    .run--task {
      --gut: var(--c-task);
    }
    .run--agenda {
      --gut: var(--c-agenda);
    }
    .run--conversation {
      --gut: var(--c-conversation);
    }
    .run--money {
      --gut: var(--c-money);
    }
    .run__label {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--gut);
      text-decoration: none;
      padding-block: var(--space-s) 0;
      transition: color var(--transition);
    }
    a.run__label:hover {
      color: var(--text-color);
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .run__rows {
      border-inline-start: 1px solid color-mix(in oklch, var(--gut) 30%, var(--border-color-light));
    }

    /* ── Rows: no leading marks; one line; context is textual ── */
    .drow {
      display: grid;
      grid-template-columns: 4.5rem 1fr auto;
      align-items: baseline;
      gap: var(--space-s);
      padding-block: var(--space-xs);
      padding-inline-start: var(--space-m);
    }
    .drow--task {
      grid-template-columns: auto 1fr auto;
    }
    .drow--proposal {
      font-style: italic;
      color: var(--text-muted);
    }
    .drow__check {
      inline-size: 0.95rem;
      block-size: 0.95rem;
      accent-color: var(--primary);
      cursor: pointer;
    }
    .drow__lead {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--gut, var(--text-faint));
      text-transform: lowercase;
    }
    .drow--overdue .drow__lead {
      color: var(--danger);
    }
    .drow__subject {
      font-size: var(--text-s);
      color: var(--text-color);
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      min-inline-size: 0;
    }
    a.drow__subject:hover {
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .drow__tail {
      display: inline-flex;
      align-items: baseline;
      gap: var(--space-s);
      min-inline-size: 0;
    }
    .drow__ctx {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-faint);
      white-space: nowrap;
    }
    .drow__due,
    .drow__surfaces,
    .drow__amount {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
      white-space: nowrap;
    }
    .drow__due--overdue {
      color: var(--danger);
    }
    /* Row actions on hover only — persistent in overdue (spec). */
    .drow__remove {
      border: 0;
      padding: 0;
      background: none;
      color: var(--text-faint);
      font-size: var(--text-m);
      line-height: 1;
      cursor: pointer;
      opacity: 0;
      transition: color var(--transition), opacity var(--transition);
    }
    .drow:hover .drow__remove,
    .drow--overdue .drow__remove,
    .drow__remove:focus-visible {
      opacity: 1;
    }
    .drow__remove:hover {
      color: var(--danger);
    }

    /* ── AI proposal ghost (consent inbox) ── */
    .ghost {
      margin-inline-start: var(--space-m);
      margin-block: var(--space-xs);
      padding: var(--space-s) var(--space-m);
      border: 1px dashed color-mix(in oklch, var(--accent-7) 45%, var(--border-color-dark));
      background: color-mix(in oklch, var(--accent-7) 5%, var(--bg-ultra-light));
      border-radius: var(--radius-l);
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }
    .ghost__head {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
    }
    .ghost__badge {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--accent-7);
    }
    .ghost__subject {
      font-size: var(--text-s);
      color: var(--text-color);
    }
    .ghost__reason {
      margin: 0;
      font-family: var(--font-display);
      font-style: italic;
      font-size: var(--text-s);
      color: var(--text-muted);
    }
    .ghost__actions {
      display: flex;
      gap: var(--space-s);
      margin-block-start: var(--space-2xs);
    }
    .ghost__add,
    .ghost__dismiss {
      border: 0;
      background: none;
      padding: 0;
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      cursor: pointer;
      transition: color var(--transition);
    }
    .ghost__add {
      color: var(--accent-7);
      font-weight: 500;
    }
    .ghost__dismiss {
      color: var(--text-faint);
    }
    .ghost__dismiss:hover {
      color: var(--text-muted);
    }

    /* ── Calm footer ── */
    .calmfoot {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      margin-block-start: var(--space-s);
      padding-block: var(--space-s) 0;
      border-block-start: 1px solid var(--border-color-light);
      background: none;
      border-inline: 0;
      border-block-end: 0;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-faint);
      cursor: pointer;
      transition: color var(--transition);
    }
    .calmfoot:hover {
      color: var(--text-muted);
    }
    .calmfoot__over {
      color: var(--danger);
    }
    .calmfoot__arrow {
      transition: transform var(--transition);
    }
    .calmfoot:hover .calmfoot__arrow {
      transform: translateX(3px);
    }

    /* ── Empty / caught-up ── */
    .desk__empty {
      margin: 0;
      color: var(--text-muted);
      font-style: italic;
      font-family: var(--font-display);
      padding-block: var(--space-m);
      text-align: center;
    }
    .desk__empty--err {
      color: var(--danger);
    }
    .desk__caughtup {
      text-align: center;
      padding-block: var(--space-xl);
      color: var(--text-faint);
    }
    .desk__caughtup-g {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--text-xxl);
    }
    .desk__caughtup-l {
      margin: var(--space-xs) 0 0;
      font-family: var(--font-display);
      font-style: italic;
      font-size: var(--text-l);
      color: var(--text-muted);
    }
    .desk__caughtup-s {
      margin: var(--space-2xs) 0 0;
      font-size: var(--text-s);
    }

    @media (max-width: 47.999rem) {
      .run {
        grid-template-columns: 1fr;
      }
      .run__label {
        padding-block: var(--space-s) var(--space-2xs);
      }
      .run__rows {
        border-inline-start: 0;
      }
      .drow {
        grid-template-columns: 3.5rem 1fr;
        padding-inline-start: 0;
      }
      .drow--task {
        grid-template-columns: auto 1fr;
      }
      .drow__ctx {
        display: none;
      }
    }
  }
</style>
