<script lang="ts">
  /**
   * Tasks module (ADR-068) — the line's to-do list, reserved in the module
   * catalog since ADR-063 ("+ Tasks when D3"). An inline composer (title +
   * optional due date) plus the shared TaskBoard; done tasks fold behind a
   * counter. Every row here also feeds the Desk (anti-fragmentation rule:
   * a module is a line-scoped view of an entity with a global surface).
   */

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import Button from '$lib/components/Button.svelte';
  import Input from '$lib/components/Input.svelte';
  import TaskBoard from '$lib/components/TaskBoard.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { fetchJSON, mutateJSON, ApiError } from '$lib/api';
  import type { TaskItem } from '$lib/task';

  interface Props {
    line: {
      id: string;
      slug: string | null;
      name: string;
      kind: string;
      project_id: string;
      workspace_id: string;
    };
    workspaceSlug: string;
  }

  let { line }: Props = $props();

  const queryClient = useQueryClient();

  const tasksOptions = toStore(() => ({
    queryKey: ['line-tasks', line.id] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: TaskItem[] }>(
        `/api/tasks?line_id=${line.id}&status=any&limit=200`,
        signal,
      ),
  }));
  const tasksQuery = createQuery(tasksOptions);

  let items = $derived<TaskItem[]>($tasksQuery.data?.items ?? []);
  let openTasks = $derived(items.filter((t) => t.status === 'open'));
  let doneTasks = $derived(items.filter((t) => t.status === 'done'));
  let showDone = $state(false);

  // ── Composer ──────────────────────────────────────────────────────────
  let cTitle = $state('');
  let cDue = $state('');

  const addTask = createMutation({
    mutationFn: () =>
      mutateJSON<{ task: TaskItem }>('POST', '/api/tasks', {
        title: cTitle.trim(),
        due_at: cDue || null,
        line_id: line.id,
      }),
    onSuccess: () => {
      cTitle = '';
      cDue = '';
      void queryClient.invalidateQueries({ queryKey: ['line-tasks', line.id] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
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
    if (!cTitle.trim()) {
      addToast({ tone: 'warning', title: 'Title required', message: 'Say what has to happen.' });
      return;
    }
    $addTask.mutate();
  }
</script>

<div class="ltm">
  <form
    class="ltm__composer"
    onsubmit={(e) => {
      e.preventDefault();
      submitAdd();
    }}
  >
    <div class="ltm__composer-title">
      <Input label="New task" placeholder="What has to happen?" bind:value={cTitle} />
    </div>
    <Input label="Due" type="date" bind:value={cDue} />
    <Button size="s" variant="outline" type="submit" loading={$addTask.isPending}>Add</Button>
  </form>

  <TaskBoard
    tasks={openTasks}
    showContext={false}
    loading={$tasksQuery.isPending}
    error={$tasksQuery.isError}
    emptyText="No tasks on this line yet."
  />

  {#if doneTasks.length > 0}
    <button type="button" class="ltm__done-toggle" onclick={() => (showDone = !showDone)}>
      {showDone ? 'Hide' : 'Show'} {doneTasks.length} done
    </button>
    {#if showDone}
      <TaskBoard tasks={doneTasks} showContext={false} emptyText="" />
    {/if}
  {/if}
</div>

<style>
  @layer components {
    .ltm {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
    .ltm__composer {
      display: flex;
      align-items: end;
      gap: var(--space-s);
    }
    .ltm__composer-title {
      flex: 1;
      min-inline-size: 0;
    }
    .ltm__done-toggle {
      align-self: start;
      border: 0;
      padding: 0;
      background: none;
      cursor: pointer;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      text-transform: uppercase;
      color: var(--text-faint);
      transition: color var(--transition);
    }
    .ltm__done-toggle:hover {
      color: var(--text-color);
    }
  }
</style>
