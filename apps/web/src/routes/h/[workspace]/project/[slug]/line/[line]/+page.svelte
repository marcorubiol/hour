<script lang="ts">
  /**
   * Line detail page — /h/[workspace]/project/[slug]/line/[line]/
   *
   * Phase 0.2 entry. Shows a single line's header (name, kind, status,
   * date range) plus dashed stubs for what will live here: performances
   * filtered by this line, assets specific to this line, notes.
   *
   * Data: reuses the `['lines', { project_id }]` TanStack cache populated
   * by LineList (sidebar lower). No extra fetch unless the user lands here
   * directly — in that case we need the project_id first to fetch lines,
   * so we also reuse the projects cache.
   *
   * Active line is found by slug match within the cached list. If not
   * found (stale slug, deleted line, etc.), an empty state with a link
   * back to the project is rendered.
   */

  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { derived, writable, type Readable } from 'svelte/store';

  type Project = {
    id: string;
    slug: string;
    name: string;
    workspace_id: string;
    status: 'draft' | 'active' | 'archived';
  };

  type Line = {
    id: string;
    slug: string | null;
    name: string;
    kind: string;
    status: string;
    start_date: string | null;
    end_date: string | null;
    project_id: string;
    workspace_id: string;
  };

  function requireJwt(): string {
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) {
      goto('/login', { replaceState: true });
      throw new Error('Missing JWT');
    }
    return jwt;
  }

  async function fetchProjects(signal: AbortSignal): Promise<{ items: Project[] }> {
    const jwt = requireJwt();
    const res = await fetch('/api/projects?status=active', {
      signal,
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return (await res.json()) as { items: Project[] };
  }

  async function fetchLines(
    projectId: string,
    signal: AbortSignal,
  ): Promise<{ items: Line[] }> {
    const jwt = requireJwt();
    const res = await fetch(
      `/api/lines?project_id=${encodeURIComponent(projectId)}`,
      { signal, headers: { Authorization: `Bearer ${jwt}` } },
    );
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return (await res.json()) as { items: Line[] };
  }

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let projectSlug = $derived(page.params.slug ?? '');
  let lineSlug = $derived(page.params.line ?? '');

  const projectsQuery = createQuery({
    queryKey: ['projects', { status: 'active' }],
    queryFn: ({ signal }) => fetchProjects(signal),
  });

  let activeProject = $derived(
    $projectsQuery.data?.items.find((p) => p.slug === projectSlug) ?? null,
  );

  const projectIdStore = writable<string | null>(null);
  $effect(() => {
    projectIdStore.set(activeProject?.id ?? null);
  });

  const linesQueryOptions: Readable<{
    queryKey: readonly ['lines', { project_id: string | null }];
    queryFn: (ctx: { signal: AbortSignal }) => Promise<{ items: Line[] }>;
    enabled: boolean;
  }> = derived(projectIdStore, ($projectId) => ({
    queryKey: ['lines', { project_id: $projectId }] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchLines($projectId!, signal),
    enabled: $projectId !== null,
  }));

  const linesQuery = createQuery(linesQueryOptions);

  let activeLine = $derived(
    $linesQuery.data?.items.find((l) => l.slug === lineSlug) ?? null,
  );

  // Touch last_navigated_at when the line is identified. Fires once per
  // line-id load (the $effect's tracked dep is activeLine.id). Idempotent
  // server-side; failure is non-fatal — log and continue.
  let lastTouchedLineId = '';
  $effect(() => {
    const id = activeLine?.id;
    if (!id || id === lastTouchedLineId) return;
    lastTouchedLineId = id;
    void touchLineVisit(id);
  });

  async function touchLineVisit(id: string): Promise<void> {
    try {
      const jwt = localStorage.getItem('hour_jwt');
      if (!jwt) return;
      await fetch('/api/lines/visit', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ line_id: id }),
      });
    } catch (err) {
      console.warn('[line-detail] touch_line_visit failed:', err);
    }
  }

  let isLoading = $derived(
    $projectsQuery.isPending || ($linesQuery.isPending && activeProject !== null),
  );
  let isError = $derived($projectsQuery.isError || $linesQuery.isError);
  let notFound = $derived(
    !isLoading && !isError && activeProject !== null && activeLine === null,
  );

  function formatDateRange(start: string | null, end: string | null): string {
    if (!start && !end) return '';
    const fmt = (iso: string) =>
      new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });
    if (start && end) return `${fmt(start)} → ${fmt(end)}`;
    if (start) return `From ${fmt(start)}`;
    return `Until ${fmt(end!)}`;
  }
</script>

<svelte:head>
  <title>
    {activeLine ? `${activeLine.name} · ${activeProject?.name ?? ''}` : 'Line'}
  </title>
</svelte:head>

<article class="line-detail">
  {#if isLoading}
    <p class="line-detail__state">Loading…</p>
  {:else if isError}
    <p class="line-detail__state line-detail__state--danger">
      Couldn't load line.
    </p>
  {:else if notFound}
    <div class="line-detail__missing">
      <p class="eyebrow">Line</p>
      <h1 class="line-detail__missing-title">{lineSlug}</h1>
      <p class="line-detail__state">
        This line doesn't exist in {activeProject?.name ?? 'this project'}.
      </p>
      <a
        class="line-detail__back"
        href={`/h/${workspaceSlug}/project/${projectSlug}/`}
      >
        ← Back to {activeProject?.name ?? 'project'}
      </a>
    </div>
  {:else if activeLine}
    <header class="line-detail__header">
      <p class="eyebrow">Line</p>
      <h1 class="line-detail__title">{activeLine.name}</h1>
      <p class="line-detail__meta">
        <span class="line-detail__kind">{activeLine.kind}</span>
        <span class="line-detail__sep">·</span>
        <span class="line-detail__status">Status: {activeLine.status}</span>
        {#if formatDateRange(activeLine.start_date, activeLine.end_date)}
          <span class="line-detail__sep">·</span>
          <span class="line-detail__dates">
            {formatDateRange(activeLine.start_date, activeLine.end_date)}
          </span>
        {/if}
        <span class="line-detail__sep">·</span>
        <a
          class="line-detail__project-link"
          href={`/h/${workspaceSlug}/project/${projectSlug}/`}
        >
          in {activeProject?.name ?? projectSlug}
        </a>
      </p>
    </header>

    <section class="line-detail__stubs">
      <div class="line-detail__stub">
        <p class="eyebrow">Performances</p>
        <p class="line-detail__stub-body">
          Performances belonging to this line — Phase 0.2 (road sheet UI lists
          them here filtered by line_id).
        </p>
      </div>
      <div class="line-detail__stub">
        <p class="eyebrow">Assets</p>
        <p class="line-detail__stub-body">
          Line-scoped asset variants (touring-specific rider adaptation,
          season dossier) — Phase 0.5 (asset upload UI).
        </p>
      </div>
      <div class="line-detail__stub">
        <p class="eyebrow">Notes</p>
        <p class="line-detail__stub-body">
          Free-form line notes — Phase 0.2 (collaborative editing via
          y-partyserver).
        </p>
      </div>
    </section>
  {/if}
</article>

<style>
  @layer components {
    .line-detail {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
      padding-block: var(--space-l);
      padding-inline: var(--space-m);
      max-inline-size: 64rem;
      margin-inline: auto;
    }

    .line-detail__header {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .line-detail__title {
      font-family: var(--font-display);
      font-size: var(--text-2xl, var(--text-xl));
      font-weight: 400;
      letter-spacing: -0.02em;
      margin: 0;
      color: var(--text-color);
    }

    .line-detail__meta {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs);
      margin: 0;
      font-size: var(--text-s);
      color: var(--text-faint);
    }

    .line-detail__kind {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      text-transform: lowercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
    }

    .line-detail__sep {
      color: var(--text-faint);
    }

    .line-detail__status {
      color: var(--text-muted);
    }

    .line-detail__dates {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .line-detail__project-link {
      color: var(--text-muted);
      text-decoration: none;
      transition: color var(--transition);
    }

    .line-detail__project-link:hover {
      color: var(--text-color);
    }

    .line-detail__stubs {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
      gap: var(--space-m);
    }

    .line-detail__stub {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      padding: var(--space-m);
      border: 1px dashed var(--border-color-light, var(--text-faint));
      border-radius: var(--radius);
    }

    .line-detail__stub-body {
      margin: 0;
      font-size: var(--text-s);
      color: var(--text-faint);
      line-height: 1.5;
    }

    .line-detail__missing {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .line-detail__missing-title {
      font-family: var(--font-display);
      font-size: var(--text-xl);
      font-weight: 400;
      margin: 0;
      color: var(--text-faint);
    }

    .line-detail__back {
      align-self: flex-start;
      color: var(--text-muted);
      text-decoration: none;
      font-size: var(--text-s);
      transition: color var(--transition);
    }

    .line-detail__back:hover {
      color: var(--text-color);
    }

    .line-detail__state {
      margin: 0;
      font-size: var(--text-s);
      color: var(--text-faint);
    }

    .line-detail__state--danger {
      color: var(--danger);
    }
  }
</style>
