<!--
  «Quién va» (ADR-103) — who a performance or a date involves, and each
  person's word on it.

  Three kinds of people, three drawings, and the drawing is the claim:
    · the roster of a performance — a fact; no button, because leaving it is
      a roster edit, not an answer to an inference (Marco, 12-10);
    · whoever said «voy» — a fact, with the way back;
    · the project's cast nobody asked yet — a guess, in the inference voice
      (`.guess`), with «voy / no voy».
  Whoever said «no voy» stays listed, struck, so the answer can be undone.

  The list is optional: with no words, the inference is the whole answer, as
  it was before. The RPC is the gate (your own word: being able to read the
  row; anybody else's: `edit:performance`), so a refused write says so here.
-->
<script lang="ts">
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { ApiError } from '$lib/api';
  import { setCommitment, type CommitmentTarget } from '$lib/commitments';
  import { t, type Locale } from '$lib/i18n';
  import PersonPicker from '$lib/components/PersonPicker.svelte';
  import { teamQueryOptions } from '$lib/nav-queries';
  import type { Commitment, CommitmentState } from '$lib/people';

  interface Props {
    target: CommitmentTarget;
    id: string;
    projectId: string | null;
    workspaceId: string;
    commitments: readonly Commitment[] | null | undefined;
    /** A performance's explicit roster. A date has none. */
    roster?: readonly string[] | null;
    /** False where the page already draws the roster (the performance's
        team section): it is still read, to leave those people out. */
    showRoster?: boolean;
    locale: Locale;
  }

  let {
    target,
    id,
    projectId,
    workspaceId,
    commitments,
    roster = null,
    showRoster = true,
    locale,
  }: Props = $props();

  const queryClient = useQueryClient();
  const teamQuery = createQuery(toStore(() => teamQueryOptions([workspaceId])));

  /** The words as this sheet last saw them: the feed row is a snapshot the
      dialog holds, so a write updates the copy here instead of waiting for it. */
  let words = $state<Commitment[]>([]);
  $effect.pre(() => {
    void id;
    words = [...(commitments ?? [])];
  });

  let names = $derived(
    new Map(($teamQuery.data?.items ?? []).map((m) => [m.person_id, m.full_name])),
  );
  let cast = $derived(
    projectId
      ? ($teamQuery.data?.items ?? [])
          .filter((m) => m.project_ids?.includes(projectId))
          .map((m) => m.person_id)
      : [],
  );

  let rosterIds = $derived([...new Set(roster ?? [])]);
  /** Next to a roster nobody is inferred (`peopleOf`, rule 1). */
  let infers = $derived(rosterIds.length === 0);

  type Row = { personId: string; word: CommitmentState | null };
  let rows = $derived.by<Row[]>(() => {
    const out: Row[] = [];
    const seen = new Set(rosterIds);
    for (const w of words) {
      if (seen.has(w.person_id)) continue;
      seen.add(w.person_id);
      out.push({ personId: w.person_id, word: w.state });
    }
    if (infers) {
      for (const p of cast) {
        if (seen.has(p)) continue;
        seen.add(p);
        out.push({ personId: p, word: null });
      }
    }
    return out;
  });

  let addable = $derived(
    ($teamQuery.data?.items ?? []).filter(
      (m) =>
        m.workspace_id === workspaceId &&
        !rosterIds.includes(m.person_id) &&
        !rows.some((r) => r.personId === m.person_id),
    ),
  );

  let busy = $state<string | null>(null);
  let addText = $state('');
  let refused = $state(false);

  async function answer(personId: string, state: CommitmentState | null) {
    busy = personId;
    refused = false;
    try {
      await setCommitment(queryClient, target, id, personId, state);
      words =
        state === null
          ? words.filter((w) => w.person_id !== personId)
          : [...words.filter((w) => w.person_id !== personId), { person_id: personId, state }];
    } catch (err) {
      if (err instanceof ApiError) refused = true;
      else throw err;
    } finally {
      busy = null;
    }
  }

  const nameOf = (personId: string) => names.get(personId) ?? '—';
</script>

<!-- Somebody can always be added (ADR-107), so the section is always there. -->
{#if (showRoster && rosterIds.length > 0) || rows.length > 0 || workspaceId}
<section class="who" aria-label={t('commitment.who_goes', locale)}>
  <h3 class="who__h">{t('commitment.who_goes', locale)}</h3>
  <ul class="who__list">
    {#if showRoster}
      {#each rosterIds as personId (personId)}
        <li class="who__row"><span class="who__name">{nameOf(personId)}</span></li>
      {/each}
    {/if}
    {#each rows as row (row.personId)}
      <li class="who__row">
        <span
          class="who__name"
          class:guess={row.word === null}
          class:who__name--out={row.word === 'not_going'}>{nameOf(row.personId)}</span
        >
        {#if row.word === null}
          <span class="who__state">{t('commitment.inferred', locale)}</span>
        {/if}
        <span class="who__acts">
          {#if row.word !== 'going'}
            <button
              type="button"
              class="who__btn"
              disabled={busy !== null}
              onclick={() => answer(row.personId, 'going')}>{t('commitment.going', locale)}</button
            >
          {/if}
          {#if row.word !== 'not_going' && infers}
            <button
              type="button"
              class="who__btn"
              disabled={busy !== null}
              onclick={() => answer(row.personId, 'not_going')}
              >{t('commitment.not_going', locale)}</button
            >
          {/if}
          {#if row.word !== null}
            <button
              type="button"
              class="who__btn"
              disabled={busy !== null}
              onclick={() => answer(row.personId, null)}>{t('commitment.clear', locale)}</button
            >
          {/if}
        </span>
      </li>
    {/each}
  </ul>

  <!-- «+ Voy»: somebody of the team, or a name that is nobody yet, created
       right here (ADR-107) and answered «voy». -->
  <div class="who__add">
    <PersonPicker
      options={addable}
      {workspaceId}
      label={t('commitment.going', locale)}
      placeholder={`+ ${t('commitment.going', locale)}…`}
      showLabel={false}
      disabled={busy !== null}
      {locale}
      bind:text={addText}
      onpick={async (p) => {
        addText = '';
        await answer(p.person_id, 'going');
        // A new person is on the team from their «voy» on: the feed that
        // names them is refetched (GET /api/team counts going words).
        if (!names.has(p.person_id)) {
          void queryClient.invalidateQueries({ queryKey: ['planner-team'] });
        }
      }}
    />
  </div>

  {#if refused}
    <p class="who__err" role="alert">{t('commitment.refused', locale)}</p>
  {/if}
</section>
{/if}

<style>
  @layer components {
    .who {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }
    .who__h {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-weight: 400;
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      margin: 0;
    }
    .who__list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }
    .who__row {
      display: flex;
      align-items: baseline;
      gap: var(--space-xs);
      font-size: var(--text-s);
    }
    .who__name--out {
      text-decoration: line-through;
      color: var(--text-faint);
    }
    .who__name {
      min-inline-size: 0;
    }
    .who__state {
      white-space: nowrap;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
    }
    .who__acts {
      margin-inline-start: auto;
      white-space: nowrap;
      display: flex;
      gap: var(--space-xs);
    }
    .who__btn {
      all: unset;
      cursor: pointer;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      color: var(--text-muted);
    }
    .who__btn:hover {
      color: var(--text-color);
    }
    .who__btn:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: var(--focus-offset);
    }
    .who__btn:disabled {
      cursor: default;
      color: var(--text-faint);
    }
    .who__add {
      align-self: start;
      inline-size: min(100%, 18rem);
      font-size: var(--text-xs);
    }
    .who__err {
      font-size: var(--text-xs);
      color: var(--text-faint);
      margin: 0;
    }
  }
</style>
