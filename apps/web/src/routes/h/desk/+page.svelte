<script lang="ts">
  /**
   * Desk view (ADR-065) — the full, uncapped feed behind the Home's "+N
   * more" link: every conversation with a next action, in the pinned scope
   * (empty pins = everything the user can see; a pinned space scopes to
   * its workspace; a pinned line scopes through its project). Reachable
   * from the Home link and from ⌘K.
   *
   * ADR-068: the Desk also carries the TASKS feed — the verb layer's
   * global surface (open tasks in scope + a quick-add for free workspace
   * tasks; parent-attached tasks are created where the parent lives, e.g.
   * the Tasks line module). Free tasks have no container editor anywhere,
   * so this composer IS their authoring home — recorded in
   * structure-model.md, not silent drift. Whether Desk should MIX tasks
   * into the agenda's day buckets is an explicitly open question
   * (structure-model § Re-evaluate); until Marco decides, they are
   * separate sections.
   *
   * The `['conversations','today']` query key below is shared with HomeView
   * on purpose — same data, one cache entry. Rename it in both or in
   * neither.
   */

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { fetchJSON, mutateJSON, ApiError } from '$lib/api';
  import DeskBoard from '$lib/components/DeskBoard.svelte';
  import TaskBoard from '$lib/components/TaskBoard.svelte';
  import Button from '$lib/components/Button.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
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
  } from '$lib/nav';
  import {
    workspacesQueryOptions,
    activeProjectsQueryOptions,
    allLinesQueryOptions,
  } from '$lib/nav-queries';
  import type { DeskConversation } from '$lib/components/DeskBoard.svelte';
  import { taskProjectId, taskSurfaceState, type TaskItem } from '$lib/task';

  type Conversation = DeskConversation & { workspace_id: string };

  const pins = usePins();
  const queryClient = useQueryClient();

  const workspacesQuery = createQuery(workspacesQueryOptions());
  // Browsing context for link-building only (ADR-067): lens routes carry no
  // space segment; entity links borrow the default (first) workspace.
  let workspaceSlug = $derived($workspacesQuery.data?.items[0]?.slug ?? '');
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());
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

  let workspaces = $derived<NavWorkspace[]>($workspacesQuery.data?.items ?? []);
  let projectIndex = $derived(buildProjectIndex(workspaces, $projectsQuery.data?.items ?? []));
  let lineIndex = $derived(buildLineIndex(workspaces, ($linesQuery.data?.items as RawLine[]) ?? []));
  let conversations = $derived<Conversation[]>($conversationsQuery.data?.items ?? []);
  let tasks = $derived<TaskItem[]>($tasksQuery.data?.items ?? []);

  let scope = $derived(resolveScope(pins.pins, workspaces, lineIndex, projectIndex));
  let scopedProjectIds = $derived(new Set(scope.projectIds));

  function engInScope(e: Conversation): boolean {
    if (scope.isEmpty) return true;
    if (scope.workspaceIds.includes(e.workspace_id)) return true;
    if (e.project && scopedProjectIds.has(e.project.id)) return true;
    return false;
  }
  let scopedConversations = $derived(conversations.filter(engInScope));

  // Tasks reach pin scope the same way conversations do: by workspace, or
  // through their effective project (resolved via whichever parent embed).
  function taskInScope(t: TaskItem): boolean {
    if (scope.isEmpty) return true;
    if (scope.workspaceIds.includes(t.workspace_id)) return true;
    const pid = taskProjectId(t);
    if (pid && scopedProjectIds.has(pid)) return true;
    return false;
  }
  let scopedTasks = $derived(tasks.filter(taskInScope));

  // ADR-070 surfacing: the Desk NEVER renders dormant tasks; the rest rank
  // by derived urgency (overdue → urgent → open, due-day order), with the
  // anytime queue as the quiet tail.
  const now = new Date();
  const STATE_RANK = { overdue: 0, urgent: 1, open: 2, anytime: 3 } as const;
  let visibleTasks = $derived(
    scopedTasks
      .map((t) => ({ t, s: taskSurfaceState(t, now) }))
      .filter(({ s }) => s.state !== 'dormant' && s.state !== 'done')
      .sort((a, b) => {
        const rank =
          STATE_RANK[a.s.state as keyof typeof STATE_RANK] -
          STATE_RANK[b.s.state as keyof typeof STATE_RANK];
        if (rank !== 0) return rank;
        const aDay = a.t.due_at?.slice(0, 10) ?? a.s.surfacesAt ?? '9999-12-31';
        const bDay = b.t.due_at?.slice(0, 10) ?? b.s.surfacesAt ?? '9999-12-31';
        return aDay < bDay ? -1 : aDay > bDay ? 1 : 0;
      })
      .map(({ t }) => t),
  );

  // ── Quick-add (free workspace task) ──────────────────────────────────
  let tTitle = $state('');
  let tDue = $state('');
  // Space select: derived default that follows the pins (a single pinned
  // space wins, else the first workspace), overridden the moment the user
  // picks — no state+effect sync, and a pin change re-aims an untouched
  // composer instead of silently writing into the stale space.
  let tSpaceChoice = $state('');
  let tSpaceDefault = $derived(
    scope.workspaceIds.length === 1 ? scope.workspaceIds[0] : (workspaces[0]?.id ?? ''),
  );
  let tSpace = $derived(tSpaceChoice || tSpaceDefault);
  let spaceOptions = $derived(workspaces.map((w) => ({ value: w.id, label: w.name })));

  const addTask = createMutation({
    mutationFn: () =>
      mutateJSON<{ task: TaskItem }>('POST', '/api/tasks', {
        title: tTitle.trim(),
        due_at: tDue || null,
        workspace_id: tSpace,
      }),
    onSuccess: (res) => {
      tTitle = '';
      tDue = '';
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      // The task exists but the current pins hide it — say so, or it
      // looks lost the moment the composer clears.
      if (res && !taskInScope(res.task)) {
        const space = workspaces.find((w) => w.id === res.task.workspace_id);
        addToast({
          tone: 'info',
          title: 'Added outside your scope',
          message: `The task lives in ${space?.name ?? 'another space'} — your current pins hide it.`,
        });
      }
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Task not added',
        message: err instanceof ApiError ? err.message : 'Unexpected error',
      });
    },
  });

  function submitAdd() {
    if (!tTitle.trim()) {
      addToast({ tone: 'warning', title: 'Title required', message: 'Say what has to happen.' });
      return;
    }
    if (!tSpace) {
      addToast({ tone: 'warning', title: 'Space required', message: 'Pick a space for the task.' });
      return;
    }
    $addTask.mutate();
  }

  function openLine(line: NavLine) {
    void goto(lineUrl(line));
  }
  function openProject(project: NavProject) {
    void goto(projectUrl(project));
  }
</script>

<svelte:head><title>Desk — Hour</title></svelte:head>

<div class="desk">
  <header class="desk__head">
    <p class="eyebrow">Desk</p>
    <p class="desk__sub">Everything with a next action, in your current scope.</p>
  </header>

  <section class="desk__block" aria-label="Next actions">
    <DeskBoard
      conversations={scopedConversations}
      {workspaceSlug}
      cap={null}
      loading={$conversationsQuery.isPending}
      error={$conversationsQuery.isError}
    />
  </section>

  <section class="desk__block" aria-label="Tasks">
    <header class="desk__block-head"><p class="eyebrow">Tasks</p></header>

    <form
      class="desk__task-add"
      onsubmit={(e) => {
        e.preventDefault();
        submitAdd();
      }}
    >
      <div class="desk__task-title">
        <Input label="New task" placeholder="What has to happen?" bind:value={tTitle} />
      </div>
      <Input label="Due" type="date" bind:value={tDue} />
      <Select
        label="Space"
        options={spaceOptions}
        value={tSpace}
        onchange={(e) => (tSpaceChoice = (e.currentTarget as HTMLSelectElement).value)}
      />
      <Button size="s" variant="outline" type="submit" loading={$addTask.isPending}>Add</Button>
    </form>

    <TaskBoard
      tasks={visibleTasks}
      cap={null}
      loading={$tasksQuery.isPending}
      error={$tasksQuery.isError}
    />
  </section>
</div>

<style>
  @layer components {
    .desk {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }
    .desk__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .desk__sub {
      font-size: var(--text-s);
      color: var(--text-muted);
    }
    /* Own sectioning root per concern (the MoneyModule precedent) — reset
       base.css's section defaults, keep the page rhythm local. */
    .desk__block {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding-block: 0;
    }
    .desk__task-add {
      display: flex;
      align-items: end;
      gap: var(--space-s);
    }
    .desk__task-title {
      flex: 1;
      min-inline-size: 0;
    }
  }
</style>
