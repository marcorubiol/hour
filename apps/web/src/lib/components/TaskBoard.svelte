<script lang="ts">
  /**
   * TaskBoard (ADR-068) — a flat task list with complete/reopen + remove.
   * Shared by the Home digest (capped, "+N more" link), the Desk view
   * (uncapped) and the Tasks line module (context chip off — every row is
   * the line). Tasks come in already scoped and ordered by the caller
   * (the API orders due_at.asc.nullslast — overdue floats up naturally).
   *
   * Owns its two mutations so every surface behaves identically; both
   * invalidate the ['tasks'] and ['line-tasks'] prefixes (the Desk feed
   * and the module read the same rows through different keys).
   */
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { mutateJSON, ApiError } from '$lib/api';
  import { addToast } from '$lib/components/Toast.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import { dayMonth } from '$lib/datetime';
  import { taskContextLabel, type TaskItem } from '$lib/task';

  interface Props {
    tasks: TaskItem[];
    cap?: number | null;
    /** where "+N more" points (only rendered when cap hides rows) */
    moreHref?: string;
    loading?: boolean;
    error?: boolean;
    /** hide the context chip when every row shares one (the line module) */
    showContext?: boolean;
    emptyText?: string;
  }
  let {
    tasks,
    cap = null,
    moreHref,
    loading = false,
    error = false,
    showContext = true,
    emptyText = 'Nothing to do in this scope. Add tasks and they land here.',
  }: Props = $props();

  const queryClient = useQueryClient();

  let rows = $derived(cap == null ? tasks : tasks.slice(0, cap));
  let moreCount = $derived(Math.max(0, tasks.length - rows.length));

  // Same local-midnight arithmetic as DeskBoard: a date-only due_at sits at
  // UTC midnight; anything before today's local midnight is overdue.
  function isOverdue(t: TaskItem): boolean {
    if (!t.due_at || t.status === 'done') return false;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return new Date(t.due_at).getTime() < start.getTime();
  }

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    void queryClient.invalidateQueries({ queryKey: ['line-tasks'] });
  }

  const toggleTask = createMutation({
    mutationFn: ({ id, status }: { id: string; status: 'open' | 'done' }) =>
      mutateJSON<{ task: TaskItem }>('PATCH', `/api/tasks/${id}`, { status }),
    onSuccess: invalidate,
    onError: (err) => {
      // Refetch too: the native checkbox already flipped visually — server
      // truth puts it back.
      invalidate();
      addToast({
        tone: 'danger',
        title: 'Change not saved',
        message: `${err instanceof ApiError ? err.message : 'Unexpected error'} — try again.`,
      });
    },
  });

  const removeTask = createMutation({
    mutationFn: (id: string) => mutateJSON('DELETE', `/api/tasks/${id}`),
    onSuccess: invalidate,
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Task not removed',
        message: err instanceof ApiError ? err.message : 'Unexpected error',
      });
    },
  });
</script>

<div class="taskboard">
  {#if loading}
    <p class="taskboard__empty">Loading…</p>
  {:else if error}
    <p class="taskboard__empty taskboard__empty--err">Couldn't load tasks.</p>
  {:else if rows.length === 0}
    <p class="taskboard__empty">{emptyText}</p>
  {:else}
    <ul class="taskboard__list">
      {#each rows as t (t.id)}
        {@const overdue = isOverdue(t)}
        {@const ctx = showContext ? taskContextLabel(t) : null}
        <li class="taskrow" class:taskrow--done={t.status === 'done'}>
          <Checkbox
            label={t.title}
            checked={t.status === 'done'}
            onchange={() =>
              $toggleTask.mutate({ id: t.id, status: t.status === 'done' ? 'open' : 'done' })}
          />
          <span class="taskrow__meta">
            {#if t.note}<span class="taskrow__note" title={t.note}>{t.note}</span>{/if}
            {#if t.due_at}
              <span class="taskrow__due" class:taskrow__due--overdue={overdue}>
                {overdue ? 'overdue · ' : ''}{dayMonth(t.due_at)}
              </span>
            {/if}
            {#if ctx}<span class="taskrow__ctx">{ctx}</span>{/if}
            <button
              type="button"
              class="taskrow__remove"
              aria-label={`Remove task: ${t.title}`}
              title="Remove task"
              onclick={() => $removeTask.mutate(t.id)}
            >×</button>
          </span>
        </li>
      {/each}
    </ul>
    {#if moreCount > 0 && moreHref}
      <a class="taskboard__more" href={moreHref}>+ {moreCount} more → Desk</a>
    {/if}
  {/if}
</div>

<style>
  @layer components {
    .taskboard__list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .taskrow {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
      padding-block: var(--space-xs);
      border-block-end: 1px solid color-mix(in oklch, var(--border-color-light) 55%, transparent);
    }
    /* The Checkbox primitive owns the box + label; done-state strikes the
       label through — one targeted :global with a purpose (the primitive
       has no done concept, the row does). */
    .taskrow--done :global(.check__label) {
      text-decoration: line-through;
      color: var(--text-faint);
    }
    .taskrow__meta {
      display: inline-flex;
      align-items: baseline;
      gap: var(--space-s);
      margin-inline-start: auto;
      min-inline-size: 0;
    }
    .taskrow__note {
      font-size: var(--text-xs);
      color: var(--text-faint);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-inline-size: 16rem;
    }
    .taskrow__due {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
      white-space: nowrap;
    }
    .taskrow__due--overdue {
      color: var(--danger);
    }
    .taskrow__ctx {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-faint);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-inline-size: 12rem;
    }
    .taskrow__remove {
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
    .taskrow:hover .taskrow__remove,
    .taskrow__remove:focus-visible {
      opacity: 1;
    }
    .taskrow__remove:hover {
      color: var(--danger);
    }

    .taskboard__empty {
      margin: 0;
      color: var(--text-muted);
      font-style: italic;
      font-family: var(--font-display);
      padding-block: var(--space-m);
      text-align: center;
    }
    .taskboard__empty--err {
      color: var(--danger);
    }

    .taskboard__more {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      margin-block-start: var(--space-s);
      padding-block: var(--space-xs);
      padding-inline: var(--space-m);
      border: 1px dashed var(--border-color-dark);
      border-radius: var(--radius-circle);
      background: transparent;
      font-size: var(--text-xs);
      color: var(--text-muted);
      text-decoration: none;
      transition: color var(--transition), border-color var(--transition);
    }
    .taskboard__more:hover {
      color: var(--text-color);
      border-color: var(--text-muted);
    }

    @media (max-width: 47.999rem) {
      .taskrow__note,
      .taskrow__ctx {
        display: none;
      }
    }
  }
</style>
