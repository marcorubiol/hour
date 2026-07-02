<script lang="ts">
  /**
   * Person detail — the contact file (ADR-045). A person is GLOBAL;
   * what the caller sees of the relationship is RLS-scoped: engagements
   * across projects, workspace-scoped notes (composer writes into the
   * browsing-context workspace via the create_person_note RPC), and
   * cast/crew appearances.
   */

  import { page } from '$app/state';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { statusBadgeClass, statusLabel } from '$lib/engagement';
  import { dayLabel } from '$lib/datetime';

  type PersonFile = {
    person: {
      id: string;
      slug: string;
      full_name: string;
      title: string | null;
      organization_name: string | null;
      email: string | null;
      phone: string | null;
      website: string | null;
      city: string | null;
      country: string | null;
      languages: string[];
    };
    engagements: Array<{
      id: string;
      slug: string;
      status: string;
      next_action_at: string | null;
      next_action_note: string | null;
      project: { id: string; slug: string; name: string; workspace_id: string } | null;
    }>;
    notes: Array<{
      id: string;
      body: string;
      visibility: 'workspace' | 'private';
      workspace_id: string;
      created_at: string;
    }>;
    crew: Array<{
      id: string;
      role: string;
      performance: {
        id: string;
        slug: string | null;
        performed_at: string;
        venue_name: string | null;
        city: string | null;
      } | null;
    }>;
    cast: Array<{
      id: string;
      role: string;
      project: { id: string; slug: string; name: string } | null;
    }>;
  };

  type WorkspaceLite = { id: string; slug: string };

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let slug = $derived(page.params.slug ?? '');

  const queryOptions = toStore(() => {
    const k = slug;
    return {
      queryKey: ['person', k] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<PersonFile>(`/api/persons/${encodeURIComponent(k)}`, signal),
    };
  });
  const query = createQuery(queryOptions);

  const workspacesQuery = createQuery({
    queryKey: ['workspaces'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: WorkspaceLite[] }>('/api/workspaces', signal),
  });

  let file = $derived($query.data ?? null);
  let loading = $derived($query.isPending);
  let errorMsg = $derived($query.error instanceof Error ? $query.error.message : '');

  let contextWorkspaceId = $derived(
    ($workspacesQuery.data?.items ?? []).find((w) => w.slug === workspaceSlug)?.id ?? '',
  );

  // ── Note composer ────────────────────────────────────────────────────
  const queryClient = useQueryClient();
  let noteBody = $state('');
  let notePrivate = $state(false);

  const noteMutation = createMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/persons/${encodeURIComponent(slug)}/notes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('hour_jwt')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          workspace_id: contextWorkspaceId,
          body: noteBody,
          visibility: notePrivate ? 'private' : 'workspace',
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        note?: unknown;
        detail?: string;
        error?: string;
      };
      if (!res.ok || !body.note) {
        throw new Error(body.detail || body.error || `Error ${res.status}`);
      }
      return body.note;
    },
    onSuccess: () => {
      noteBody = '';
      notePrivate = false;
      void queryClient.invalidateQueries({ queryKey: ['person', slug] });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Note not saved',
        message: `${err instanceof Error ? err.message : 'Unexpected error'} — try again.`,
      });
    },
  });

  function addNote() {
    if (!noteBody.trim()) return;
    if (!contextWorkspaceId) {
      addToast({ tone: 'warning', message: 'Workspace context not resolved yet.' });
      return;
    }
    $noteMutation.mutate();
  }

  function noteDay(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  let placeLine = $derived(
    file ? [file.person.city, file.person.country].filter(Boolean).join(', ') : '',
  );
</script>

<svelte:head>
  <title>{file?.person.full_name ?? slug} — Hour</title>
</svelte:head>

<article class="person">
  {#if loading}
    <p class="person__state">Loading…</p>
  {:else if errorMsg}
    <p class="person__state person__state--danger">{errorMsg}</p>
  {:else if file}
    <header class="person__head">
      <p class="eyebrow">Person</p>
      <h1 class="person__title"><em>{file.person.full_name}</em></h1>
      <div class="person__meta">
        {#if file.person.title}<span>{file.person.title}</span>{/if}
        {#if file.person.organization_name}
          <span class="person__org">{file.person.organization_name}</span>
        {/if}
        {#if placeLine}<span class="person__place">{placeLine}</span>{/if}
      </div>
    </header>

    <section class="person__section" aria-label="Contact">
      <p class="eyebrow">Contact</p>
      <ul class="person__contact" role="list">
        {#if file.person.email}
          <li><a href={`mailto:${file.person.email}`}>{file.person.email}</a></li>
        {/if}
        {#if file.person.phone}
          <li><a href={`tel:${file.person.phone}`}>{file.person.phone}</a></li>
        {/if}
        {#if file.person.website}
          <li>
            <a href={file.person.website} target="_blank" rel="noopener noreferrer">
              {file.person.website}
            </a>
          </li>
        {/if}
        {#if file.person.languages.length > 0}
          <li class="person__langs">{file.person.languages.join(' · ')}</li>
        {/if}
      </ul>
    </section>

    {#if file.engagements.length > 0}
      <section class="person__section" aria-label="Engagements">
        <p class="eyebrow">Engagements</p>
        <ul class="person__rows" role="list">
          {#each file.engagements as e (e.id)}
            <li>
              <span class={statusBadgeClass(e.status)}>{statusLabel(e.status)}</span>
              <span class="person__row-main">
                {e.project?.name ?? '—'}
                {#if e.next_action_note}
                  <span class="person__row-note">{e.next_action_note}</span>
                {/if}
              </span>
              {#if e.next_action_at}
                <span class="person__row-meta">{dayLabel(e.next_action_at)}</span>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section class="person__section" aria-label="Notes">
      <p class="eyebrow">Notes</p>
      <div class="person__composer">
        <textarea
          rows="3"
          maxlength="4000"
          placeholder="What happened with this person?"
          bind:value={noteBody}
        ></textarea>
        <div class="person__composer-row">
          <label class="person__private">
            <input type="checkbox" bind:checked={notePrivate} />
            private (only you)
          </label>
          <Button size="s" onclick={addNote} loading={$noteMutation.isPending}>
            Add note
          </Button>
        </div>
      </div>
      {#if file.notes.length > 0}
        <ul class="person__notes" role="list">
          {#each file.notes as n (n.id)}
            <li>
              <span class="person__note-meta">
                {noteDay(n.created_at)}{#if n.visibility === 'private'} · private{/if}
              </span>
              <p class="person__note-body">{n.body}</p>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="person__empty">No notes yet.</p>
      {/if}
    </section>

    {#if file.cast.length > 0 || file.crew.length > 0}
      <section class="person__section" aria-label="Appearances">
        <p class="eyebrow">Appearances</p>
        <ul class="person__rows" role="list">
          {#each file.cast as c (c.id)}
            <li>
              <span class="person__row-kind">cast · {c.role}</span>
              <span class="person__row-main">{c.project?.name ?? '—'}</span>
            </li>
          {/each}
          {#each file.crew as c (c.id)}
            <li>
              <span class="person__row-kind">crew · {c.role}</span>
              <span class="person__row-main">
                {c.performance?.venue_name ?? c.performance?.city ?? '—'}
              </span>
              {#if c.performance}
                <span class="person__row-meta">{dayLabel(c.performance.performed_at)}</span>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</article>

<style>
  @layer components {
    .person {
      display: flex;
      flex-direction: column;
      gap: var(--space-xl);
      max-inline-size: 44rem;
      margin-inline: auto;
    }

    .person__state {
      padding-block: var(--space-l);
      font-size: var(--text-s);
      color: var(--text-faint);
    }
    .person__state--danger {
      color: var(--danger);
    }

    .person__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding-block-end: var(--space-m);
      border-block-end: 1px solid var(--border-color-light);
    }

    .person__title {
      font-family: var(--font-display);
      font-size: clamp(1.8rem, 3vw, 2.4rem);
      font-weight: 400;
      letter-spacing: -0.025em;
      line-height: 1.05;
      color: var(--text-color);
    }
    .person__title em {
      font-style: italic;
    }

    .person__meta {
      display: flex;
      gap: var(--space-s);
      flex-wrap: wrap;
      font-size: var(--text-s);
      color: var(--text-muted);
    }

    .person__place {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
      align-self: center;
    }

    .person__section {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .person__contact li {
      padding-block: var(--space-2xs);
      font-size: var(--text-s);
    }

    .person__langs {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
      letter-spacing: 0.04em;
    }

    .person__rows li {
      display: flex;
      gap: var(--space-m);
      align-items: baseline;
      padding-block: var(--space-xs);
      border-block-end: 1px solid var(--border-color-light);
    }

    .person__row-kind {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
      min-inline-size: 8rem;
    }

    .person__row-main {
      font-size: var(--text-s);
      color: var(--text-color);
      flex: 1;
    }

    .person__row-note {
      display: block;
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .person__row-meta {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .person__composer {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .person__composer-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-m);
    }

    .person__private {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      font-size: var(--text-xs);
      color: var(--text-muted);
      cursor: pointer;
    }

    .person__notes li {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      padding-block: var(--space-s);
      border-block-end: 1px solid var(--border-color-light);
    }

    .person__note-meta {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
    }

    .person__note-body {
      font-size: var(--text-s);
      line-height: 1.55;
      white-space: pre-wrap;
    }

    .person__empty {
      font-size: var(--text-s);
      color: var(--text-faint);
    }
  }
</style>
