<script lang="ts">
  /**
   * Tasks module (ADR-068) — the line's to-do list. The shared TaskComposer
   * (its parent locked to this line, so the "where" picker is hidden) plus
   * the shared TaskBoard; done tasks fold behind a counter. Every row here
   * also feeds the Desk (anti-fragmentation: a module is a line-scoped view
   * of an entity that also has a global surface).
   */

  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import TaskBoard from '$lib/components/TaskBoard.svelte';
  import TaskComposer from '$lib/components/TaskComposer.svelte';
  import { fetchJSON } from '$lib/api';
  import { detectLocale } from '$lib/i18n';
  import type { TaskItem, TaskTarget } from '$lib/task';

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

  const locale = detectLocale(typeof navigator !== 'undefined' ? navigator.language : 'en');

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

  // The composer's parent is fixed to this line — lockTarget hides the picker
  // and drops the redundant "into <line>" hint suffix.
  let target = $derived<TaskTarget>({
    kind: 'line',
    id: line.id,
    name: line.name,
    lineKind: line.kind,
  });
</script>

<div class="ltm">
  <TaskComposer {locale} {target} lockTarget invalidateKeys={[['line-tasks', line.id]]} />

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
