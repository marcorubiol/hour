<script lang="ts">
  /**
   * The project's cast — the first surface in Hour that can WRITE a roster.
   *
   * Until this existed the roster was read-only across the whole product:
   * `/api/lines/[id]/people` was GET-only and nothing touched `cast_member`,
   * so the six rows in production were seeded by hand. That is why it matters
   * more than it looks — `/api/team` is `cast_member ∪ crew_assignment`, so
   * this panel is what lets somebody enter the ⌘K person search, the person
   * pins (ADR-092) and the Planner's person axis.
   *
   * Deliberately plain. The Planner v3 redesign will decide where casting
   * really lives (the design has no such screen yet); this is the honest
   * minimum so the axis has data to draw.
   */

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';

  interface Props {
    projectId: string;
  }

  let { projectId }: Props = $props();

  type CastMember = {
    id: string;
    role: string;
    person: { id: string; slug: string | null; full_name: string; email: string | null } | null;
  };
  type Candidate = { person_id: string; slug: string | null; full_name: string };
  type CastResponse = { cast: CastMember[]; people: Candidate[] };

  const queryClient = useQueryClient();

  // `projectId` is a prop and can change under us, so the options are a store
  // (the house pattern — see the person file page): a plain object would pin
  // the key to whatever the first render saw.
  const castOptions = toStore(() => {
    const id = projectId;
    return {
      queryKey: ['project-cast', id] as const,
      enabled: Boolean(id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<CastResponse>(`/api/projects/${id}/cast`, signal),
    };
  });
  const castQuery = createQuery(castOptions);

  let cast = $derived($castQuery.data?.cast ?? []);
  let people = $derived($castQuery.data?.people ?? []);

  let personId = $state('');
  let role = $state('');

  let personOptions = $derived(
    people.map((p) => ({ value: p.person_id, label: p.full_name })),
  );

  /** Both fields are required — `role` is NOT NULL with a non-empty CHECK. */
  let canAdd = $derived(personId !== '' && role.trim() !== '');

  const addMutation = createMutation({
    mutationFn: async () => {
      const body = await mutateJSON<{ member?: CastMember; detail?: string; error?: string }>(
        'POST',
        `/api/projects/${projectId}/cast`,
        { person_id: personId, role: role.trim() },
      );
      if (!body?.member) throw new Error(body?.detail || body?.error || 'Error');
      return body.member;
    },
    onSuccess: () => {
      personId = '';
      role = '';
      void queryClient.invalidateQueries({ queryKey: ['project-cast', projectId] });
      // The team feed is cast ∪ crew, so a new cast row changes who exists
      // for ⌘K, the pins and the Planner's person axis.
      void queryClient.invalidateQueries({ queryKey: ['team'] });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Not cast',
        message: err instanceof Error ? err.message : 'Unexpected error — try again.',
      });
    },
  });

  const removeMutation = createMutation({
    mutationFn: async (memberId: string) => {
      await mutateJSON('DELETE', `/api/projects/${projectId}/cast/${memberId}`);
      return memberId;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-cast', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['team'] });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Not removed',
        message: err instanceof Error ? err.message : 'Unexpected error — try again.',
      });
    },
  });

  function add(event: SubmitEvent) {
    event.preventDefault();
    if (!canAdd) return;
    $addMutation.mutate();
  }
</script>

<div class="cast">
  {#if $castQuery.isPending}
    <p class="cast__quiet">Loading…</p>
  {:else if $castQuery.error}
    <p class="cast__quiet">Could not load the cast.</p>
  {:else}
    {#if cast.length > 0}
      <ul class="cast__list" role="list">
        {#each cast as m (m.id)}
          <li class="cast__row">
            <span class="cast__name">{m.person?.full_name ?? 'Unknown person'}</span>
            <span class="cast__role">{m.role}</span>
            <Button
              variant="outline"
              size="s"
              tone="warn"
              label={`Remove ${m.person?.full_name ?? 'this person'}`}
              disabled={$removeMutation.isPending}
              onclick={() => $removeMutation.mutate(m.id)}>Remove</Button
            >
          </li>
        {/each}
      </ul>
    {:else}
      <p class="cast__quiet">Nobody cast yet.</p>
    {/if}

    {#if people.length === 0}
      <!-- Casting requires a local dossier (cast_member_workspace_person_fkey),
           so with no dossiers there is nobody to offer. Say which of the two
           empty states this is instead of showing a dead picker. -->
      <p class="cast__quiet">
        No people on file in this workspace yet — add someone to the workspace before casting.
      </p>
    {:else}
      <form class="cast__add" onsubmit={add}>
        <Select
          label="Person"
          bind:value={personId}
          options={personOptions}
          placeholder="Choose…"
        />
        <label class="cast__field">
          <span class="cast__label">Role</span>
          <input
            class="cast__input"
            bind:value={role}
            placeholder="performer, lighting, sound…"
            maxlength="120"
          />
        </label>
        <Button type="submit" size="s" disabled={!canAdd} loading={$addMutation.isPending}>
          Add
        </Button>
      </form>
    {/if}
  {/if}
</div>

<style>
  .cast {
    display: flex;
    flex-direction: column;
    gap: var(--space-s);
  }

  .cast__quiet {
    margin: 0;
    font-size: var(--text-s);
    color: var(--text-muted);
    line-height: 1.55;
  }

  .cast__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
    margin: 0;
    padding: 0;
  }

  .cast__row {
    display: flex;
    align-items: baseline;
    gap: var(--space-xs);
  }

  .cast__name {
    font-size: var(--text-s);
    color: var(--text-color);
  }

  .cast__role {
    flex: 1;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    color: var(--text-faint);
  }

  .cast__add {
    display: flex;
    align-items: flex-end;
    gap: var(--space-xs);
    flex-wrap: wrap;
    padding-block-start: var(--space-xs);
    border-block-start: 1px solid var(--border-color-light);
  }

  .cast__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-3xs);
    flex: 1;
    min-inline-size: 8rem;
  }

  .cast__label {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .cast__input {
    inline-size: 100%;
    padding: var(--space-2xs) var(--space-xs);
    font: inherit;
    font-size: var(--text-s);
    color: var(--text-color);
    background: var(--bg-color);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-s);
  }
</style>
