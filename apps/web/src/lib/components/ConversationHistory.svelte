<script lang="ts">
  /**
   * ConversationHistory — the timeline of one conversation (ADR-098): a quick
   * add (kind, direction, day, note) over the list of what happened, most
   * recent first. Append-only, like the table under it: no edit, no delete.
   *
   * A contact moves the conversation's last contact on the server, in the
   * same transaction; this component only invalidates the lists that show it.
   */

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { dayMonthYear, localDayISO } from '$lib/datetime';
  import Button from '$lib/components/Button.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import {
    CONVERSATION_EVENT_KINDS,
    EVENT_DIRECTION_LABELS,
    EVENT_KIND_LABELS,
    occurredAtForDay,
    type ConversationEventCreate,
    type ConversationEventDirection,
    type ConversationEventItem,
    type ConversationEventKind,
  } from '$lib/conversation';

  interface Props {
    conversationId: string;
  }

  let { conversationId }: Props = $props();

  const queryClient = useQueryClient();

  const query = createQuery(
    toStore(() => ({
      queryKey: ['conversation-events', conversationId] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: ConversationEventItem[] }>(
          `/api/conversations/${conversationId}/events`,
          signal,
        ),
    })),
  );

  let kind = $state<ConversationEventKind>('email');
  let direction = $state<ConversationEventDirection | ''>('outbound');
  let day = $state(localDayISO());
  let body = $state('');

  const kindOptions = CONVERSATION_EVENT_KINDS.map((k) => ({
    value: k,
    label: EVENT_KIND_LABELS[k],
  }));
  const directionOptions = [
    { value: 'outbound', label: EVENT_DIRECTION_LABELS.outbound },
    { value: 'inbound', label: EVENT_DIRECTION_LABELS.inbound },
    { value: '', label: '—' },
  ];

  const addMutation = createMutation({
    mutationFn: (event: ConversationEventCreate) =>
      mutateJSON<{ item: ConversationEventItem }>(
        'POST',
        `/api/conversations/${conversationId}/events`,
        event,
      ),
    onSuccess: () => {
      body = '';
      day = localDayISO();
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Not recorded',
        message: `${err instanceof Error ? err.message : 'Unexpected error'} — try again.`,
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversation-events', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['line-eng-stats'] });
    },
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!day || futureDay) return;
    $addMutation.mutate({
      kind,
      direction: direction || null,
      body: body.trim() || null,
      occurred_at: occurredAtForDay(day),
    });
  }

  let futureDay = $derived(day > localDayISO());
  let items = $derived($query.data?.items ?? []);
</script>

<form class="history-add" onsubmit={submit}>
  <div class="history-add__row">
    <Select label="Kind" bind:value={kind} options={kindOptions} />
    <Select label="Direction" bind:value={direction} options={directionOptions} />
    <Input
      label="Day"
      type="date"
      bind:value={day}
      required
      error={futureDay ? 'Not in the future' : undefined}
    />
  </div>
  <div class="field">
    <label for="history-body">Note</label>
    <textarea
      id="history-body"
      rows="2"
      maxlength="5000"
      bind:value={body}
      placeholder="What was said or sent"
    ></textarea>
  </div>
  <div class="history-add__submit">
    <Button type="submit" size="s" disabled={$addMutation.isPending || !day || futureDay}>Record</Button>
  </div>
</form>

{#if $query.isLoading}
  <p class="history-msg">Loading...</p>
{:else if $query.error}
  <p class="history-msg history-msg--error">
    {$query.error instanceof Error ? $query.error.message : 'Could not load the history.'}
  </p>
{:else if items.length === 0}
  <p class="history-msg">Nothing recorded yet.</p>
{:else}
  <ol class="history" aria-label="History">
    {#each items as item (item.id)}
      <li class="history__item">
        <time class="history__when" datetime={item.occurred_at}>{dayMonthYear(item.occurred_at)}</time>
        <span class="history__what">
          {EVENT_KIND_LABELS[item.kind]}{#if item.direction}<span class="history__dir"
              >{EVENT_DIRECTION_LABELS[item.direction]}</span
            >{/if}
        </span>
        {#if item.body}<p class="history__body">{item.body}</p>{/if}
      </li>
    {/each}
  </ol>
{/if}

<style>
  @layer components {
    .history-add {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding-block-end: var(--space-m);
      border-block-end: var(--divider);
    }
    .history-add__row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
      gap: var(--space-s);
    }
    .history-add__submit {
      display: flex;
      justify-content: flex-end;
    }

    .history-msg {
      padding-block: var(--space-m);
      color: var(--text-dark-muted);
      font-size: var(--text-s);
    }
    .history-msg--error {
      color: var(--danger-dark);
    }

    .history {
      list-style: none;
      margin: 0;
      padding: 0;
      max-block-size: 22rem;
      overflow-y: auto;
    }
    .history__item {
      display: grid;
      grid-template-columns: 7.5rem minmax(0, 1fr);
      gap: var(--space-2xs) var(--space-s);
      padding-block: var(--space-s);
      border-block-end: var(--divider);
    }
    .history__when {
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
    }
    .history__what {
      color: var(--heading-color);
      font-size: var(--text-s);
      font-weight: 500;
    }
    .history__dir {
      margin-inline-start: var(--space-xs);
      color: var(--text-dark-muted);
      font-weight: 400;
    }
    .history__body {
      grid-column: 2;
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-s);
      white-space: pre-line;
    }
  }
</style>
