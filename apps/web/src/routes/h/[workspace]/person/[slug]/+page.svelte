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
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { session } from '$lib/session.svelte';
  import { ENGAGEMENT_STATUSES, statusBadgeClass, statusLabel } from '$lib/engagement';
  import { dayLabel } from '$lib/datetime';
  import { useBreadcrumb } from '$lib/stores/breadcrumb.svelte';
  import { accentVar } from '$lib/utils/accent';

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
      author_id: string | null;
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

  type WorkspaceLite = { id: string; slug: string; name: string };

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

  const breadcrumb = useBreadcrumb();
  let activeWorkspaceName = $derived(
    $workspacesQuery.data?.items.find((w) => w.slug === workspaceSlug)?.name ?? workspaceSlug,
  );

  // A person is cross-cutting (global, appears across projects), not a tree
  // node — so the address is Space › Person, no pin (persons aren't in the
  // pin model). The "appears in N projects" lives in the page body.
  $effect(() => {
    const p = $query.data?.person;
    if (p) {
      breadcrumb.set([
        {
          label: activeWorkspaceName,
          href: `/h/${workspaceSlug}/`,
          kind: 'space',
          accent: accentVar(workspaceSlug),
        },
        { label: p.full_name, kind: 'node' },
      ], { width: 'reading' });
    } else {
      breadcrumb.clear();
    }
    return () => breadcrumb.clear();
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
      const body = await mutateJSON<{ note?: unknown; detail?: string; error?: string }>(
        'POST',
        `/api/persons/${encodeURIComponent(slug)}/notes`,
        {
          workspace_id: contextWorkspaceId,
          body: noteBody,
          visibility: notePrivate ? 'private' : 'workspace',
        },
      );
      if (!body?.note) {
        throw new Error(body?.detail || body?.error || 'Error');
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

  // Delete is author-only (enforced by the delete_person_note RPC); the
  // button only shows on the caller's own notes.
  let callerId = $derived(session.user?.sub ?? '');

  const deleteNote = createMutation({
    mutationFn: async (noteId: string) => {
      await mutateJSON('DELETE', `/api/persons/${encodeURIComponent(slug)}/notes/${noteId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['person', slug] });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Note not deleted',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });

  function noteDay(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  // ── Add to project (ADR-051): a new conversation for this person ────
  type ProjectItem = { id: string; slug: string; name?: string };

  const projectsQuery = createQuery({
    queryKey: ['projects', { status: 'active' }],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: ProjectItem[] }>('/api/projects?status=active', signal),
  });

  let addOpen = $state(false);
  let aProject = $state('');
  let aStatus = $state('contacted');

  let projectOptions = $derived.by(() => {
    // Offer only projects without a live conversation for this person.
    const taken = new Set((file?.engagements ?? []).map((e) => e.project?.id));
    return ($projectsQuery.data?.items ?? [])
      .filter((p) => !taken.has(p.id))
      .map((p) => ({ value: p.id, label: p.name ?? p.slug }));
  });
  let addStatusOptions = ENGAGEMENT_STATUSES.map((s) => ({
    value: s,
    label: statusLabel(s),
  }));

  const addEngagement = createMutation({
    mutationFn: () =>
      mutateJSON<{ engagement: unknown }>('POST', '/api/engagements', {
        project_id: aProject,
        person_id: file!.person.id,
        status: aStatus,
      }),
    onSuccess: () => {
      addOpen = false;
      aProject = '';
      void queryClient.invalidateQueries({ queryKey: ['person', slug] });
      void queryClient.invalidateQueries({ queryKey: ['engagements'] });
      addToast({ tone: 'success', message: 'Added to project.' });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Not added',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });

  function submitAddEngagement() {
    if (!aProject) {
      addToast({ tone: 'warning', message: 'Pick a project.' });
      return;
    }
    $addEngagement.mutate();
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

    <section class="person__section" aria-label="Engagements">
      <div class="person__section-head">
        <p class="eyebrow">Engagements</p>
        <Button variant="outline" size="xs" onclick={() => (addOpen = true)}>
          Add to project
        </Button>
      </div>
      {#if file.engagements.length > 0}
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
      {/if}
    </section>

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
          <Checkbox label="Private (only you)" bind:checked={notePrivate} />
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
                {#if n.author_id === callerId}
                  <button
                    type="button"
                    class="person__note-delete"
                    disabled={$deleteNote.isPending}
                    onclick={() => $deleteNote.mutate(n.id)}
                  >
                    delete
                  </button>
                {/if}
              </span>
              <p class="person__note-body">{n.body}</p>
            </li>
          {/each}
        </ul>
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

<Dialog bind:open={addOpen} title="Add to project" size="s">
  <div class="person__add-grid">
    <Select
      label="Project"
      options={projectOptions}
      bind:value={aProject}
      placeholder={projectOptions.length === 0 ? 'Already in every active project' : undefined}
      required
    />
    <Select label="Status" options={addStatusOptions} bind:value={aStatus} />
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (addOpen = false)}>Cancel</Button>
    <Button
      onclick={submitAddEngagement}
      loading={$addEngagement.isPending}
      disabled={projectOptions.length === 0}
    >
      Add
    </Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .person {
      display: flex;
      flex-direction: column;
      gap: var(--space-xl);
      max-inline-size: var(--page-width-reading);
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

    /* Masthead typography via base.css h1 defaults. */
    .person__title {
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

    .person__section-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-m);
    }

    .person__add-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: var(--space-s) var(--space-m);
      margin-block-start: var(--space-s);
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

    .person__notes li {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      padding-block: var(--space-s);
      border-block-end: 1px solid var(--border-color-light);
    }

    .person__note-meta {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
    }

    .person__note-delete {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 0.2em;
    }
    .person__note-delete:hover {
      color: var(--danger);
    }

    .person__note-body {
      font-size: var(--text-s);
      line-height: 1.55;
      white-space: pre-wrap;
    }

  }
</style>
