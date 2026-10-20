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
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import Field from '$lib/components/Field.svelte';
  import PersonPicker from '$lib/components/PersonPicker.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { appLocale, t } from '$lib/i18n';

  interface Props {
    projectId: string;
  }

  let { projectId }: Props = $props();

  const locale = appLocale();

  type CastMember = {
    id: string;
    role: string;
    person: { id: string; slug: string | null; full_name: string; email: string | null } | null;
  };
  type Candidate = { person_id: string; slug: string | null; full_name: string };
  type CastResponse = { workspace_id: string; cast: CastMember[]; people: Candidate[] };

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

  let workspaceId = $derived($castQuery.data?.workspace_id ?? '');

  /** What the picker shows, and who it last handed over: typing again
      forgets the pick. */
  let personText = $state('');
  let picked = $state<{ id: string; name: string } | null>(null);
  let personId = $derived(picked && picked.name === personText ? picked.id : '');
  let role = $state('');

  /** Both fields are required — `role` is NOT NULL with a non-empty CHECK. */
  let canAdd = $derived(personId !== '' && role.trim() !== '');

  const addMutation = createMutation({
    mutationFn: async () => {
      const body = await mutateJSON<{ member?: CastMember; detail?: string; error?: string }>(
        'POST',
        `/api/projects/${projectId}/cast`,
        { person_id: personId, role: role.trim() },
      );
      if (!body?.member) throw new Error(body?.detail || body?.error || t('perf.unexpected', locale));
      return body.member;
    },
    onSuccess: () => {
      picked = null;
      personText = '';
      role = '';
      void queryClient.invalidateQueries({ queryKey: ['project-cast', projectId] });
      // The team feed is cast ∪ crew, so a new cast row changes who exists
      // for ⌘K, the pins and the Planner's person axis.
      void queryClient.invalidateQueries({ queryKey: ['planner-team'] });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('perf.cast_not_added', locale),
        message: err instanceof Error ? err.message : t('composer.toast_fail_msg', locale),
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
      void queryClient.invalidateQueries({ queryKey: ['planner-team'] });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('perf.cast_not_removed', locale),
        message: err instanceof Error ? err.message : t('composer.toast_fail_msg', locale),
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
    <EmptyLine busy text={t('desk.loading', locale)} />
  {:else if $castQuery.error}
    <EmptyLine text={t('perf.cast_load_error', locale)} />
  {:else}
    {#if cast.length > 0}
      <ul class="cast__list" role="list">
        {#each cast as m (m.id)}
          <li class="cast__row">
            <span class="cast__name">{m.person?.full_name ?? t('perf.cast_unknown_person', locale)}</span>
            <span class="cast__role">{m.role}</span>
            <Button
              variant="secondary"
              size="s"
              tone="warn"
              label={t('perf.cast_remove_named', locale, {
                name: m.person?.full_name ?? t('perf.cast_this_person', locale),
              })}
              disabled={$removeMutation.isPending}
              onclick={() => $removeMutation.mutate(m.id)}>{t('perf.cast_remove', locale)}</Button
            >
          </li>
        {/each}
      </ul>
    {:else}
      <EmptyLine text={t('perf.cast_empty', locale)} />
    {/if}

    <!-- Casting requires a local dossier (cast_member_workspace_person_fkey);
         a name that is nobody yet is created right here (ADR-107). -->
    <form class="cast__add" onsubmit={add}>
      <PersonPicker
        options={people}
        {workspaceId}
        label={t('blackout.person', locale)}
        placeholder={t('people.search', locale)}
        {locale}
        bind:text={personText}
        onpick={(p) => (picked = { id: p.person_id, name: p.full_name })}
      />
      <Field id={`cast-role-${projectId}`} label={t('perf.cast_role', locale)}>
        <input
          id={`cast-role-${projectId}`}
          bind:value={role}
          placeholder={t('perf.cast_role_placeholder', locale)}
          maxlength="120"
        />
      </Field>
      <Button type="submit" size="s" disabled={!canAdd} loading={$addMutation.isPending}>
        {t('composer.add', locale)}
      </Button>
    </form>
  {/if}
</div>

<style>
  .cast {
    display: flex;
    flex-direction: column;
    gap: var(--space-s);
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
    letter-spacing: var(--tracking-s);
    color: var(--text-faint);
  }

  /* Two field rows and the verb under them (ADR-139 p4). */
  .cast__add {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding-block-start: var(--space-xs);
  }
  .cast__add > :global(button) {
    align-self: flex-end;
  }

  /* Both fields are `.field` (base.css), so the person and the role read
     as one form; here only how they share the row. */
</style>
