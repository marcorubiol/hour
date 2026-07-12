<script lang="ts">
  /**
   * Project detail (legacy URL: /h/[workspace]/project/[slug]/) — Phase 0.1.
   *
   * Editorial v0.5 layout: kicker + display serif title + mono meta line,
   * Relationships block (engagements), and dashed deferred-phase stubs
   * (Lines, Assets, Team).
   *
   * Display name shares the projects TanStack cache with Plaza, so arriving
   * from the sidebar costs no extra fetch.
   */

  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { allLinesQueryOptions } from '$lib/nav-queries';
  import { goto } from '$app/navigation';
  import { accentVar, accentVarFor } from '$lib/utils/accent';
  import RelationshipStub from '$lib/components/RelationshipStub.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import YNotes from '$lib/components/YNotes.svelte';
  import { dayMonthYear } from '$lib/datetime';

  type Project = {
    id: string;
    slug: string;
    name: string;
    status: 'draft' | 'active' | 'archived';
    workspace_id: string;
    starts_on: string | null;
    ends_on: string | null;
    updated_at: string;
    accent?: string | null;
    description?: string | null;
  };

  function clearAuthAndBounce() {
    localStorage.removeItem('hour_jwt');
    localStorage.removeItem('hour_refresh');
    localStorage.removeItem('hour_expires_at');
    goto('/login', { replaceState: true });
  }

  async function fetchJSON<T>(url: string, signal: AbortSignal): Promise<T> {
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) {
      clearAuthAndBounce();
      throw new Error('Missing JWT');
    }
    const res = await fetch(url, { signal, headers: { Authorization: `Bearer ${jwt}` } });
    if (res.status === 401) {
      clearAuthAndBounce();
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      throw new Error(`Error ${res.status}`);
    }
    return (await res.json()) as T;
  }

  const projectsQuery = createQuery({
    queryKey: ['projects', { status: 'active' }],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: Project[] }>('/api/projects?status=active', signal),
  });

  // Lines of this project — shares the ['lines','all'] cache the shell warms.
  const linesQuery = createQuery(allLinesQueryOptions());

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let projectSlug = $derived(page.params.slug ?? '');

  let project = $derived(
    $projectsQuery.data?.items.find((r) => r.slug === projectSlug) ?? null,
  );

  let displayName = $derived(project?.name ?? projectSlug);
  let projectLoading = $derived($projectsQuery.isPending && !project);

  let statusTone = $derived.by<'success' | 'warning' | 'faint' | 'neutral'>(() => {
    if (!project) return 'neutral';
    if (project.status === 'active') return 'success';
    if (project.status === 'draft') return 'warning';
    return 'faint';
  });

  let projectLines = $derived(
    ($linesQuery.data?.items ?? []).filter((l) => l.project?.slug === projectSlug),
  );

  function formatDate(iso: string | null): string {
    if (!iso) return '';
    return dayMonthYear(iso);
  }
</script>

<svelte:head>
  <title>{displayName} — Hour</title>
</svelte:head>

<article class="project" style={`--c: ${project ? accentVarFor(project) : accentVar(projectSlug)}`}>
  <header class="project__head">
    <p class="eyebrow">Project</p>
    <h1 class="project__title">
      {#if projectLoading}
        <span class="project__title-skeleton" aria-hidden="true">…</span>
      {:else}
        <em>{displayName}</em>
      {/if}
    </h1>
    {#if project}
      <div class="project__meta">
        <StateBadge label={project.status} tone={statusTone} />
        {#if project.starts_on || project.ends_on}
          <span class="project__meta-sep" aria-hidden="true">·</span>
          <span class="project__meta-dates">
            {#if project.starts_on}{formatDate(project.starts_on)}{/if}
            {#if project.starts_on && project.ends_on} → {/if}
            {#if project.ends_on}{formatDate(project.ends_on)}{/if}
          </span>
        {/if}
      </div>
    {/if}
  </header>

  <RelationshipStub projectSlug={projectSlug} />

  {#if project}
    <section class="project__notes" aria-label="Notes">
      <p class="eyebrow">Notes</p>
      <YNotes
        targetTable="project"
        targetId={project.id}
        placeholder="Project notes — shared, live."
      />
    </section>
  {/if}

  <section class="project__stubs" aria-label="Pending sections">
    <div class="project__stub">
      <p class="eyebrow">Lines</p>
      {#if projectLines.length > 0}
        <ul class="project__lines" role="list">
          {#each projectLines as l (l.id)}
            <li>
              <a class="link-arrow" href={`/h/${workspaceSlug}/project/${projectSlug}/line/${l.slug ?? l.id}`}>
                {l.name} →
              </a>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="project__stub-body">No lines yet.</p>
      {/if}
    </div>
    <div class="project__stub">
      <p class="eyebrow">Assets</p>
      <p class="project__stub-body">
        Riders, dossiers and stage plots will live here.
      </p>
    </div>
    <div class="project__stub">
      <p class="eyebrow">Team</p>
      <p class="project__stub-body">
        Project members and permissions will live here.
      </p>
    </div>
  </section>
</article>

<style>
  .project {
    display: flex;
    flex-direction: column;
    gap: var(--space-xl);
    max-inline-size: var(--page-width-wide);
    margin-inline: auto;
  }

  .project__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-s);
    padding-block-end: var(--space-m);
    border-block-end: 1px solid var(--border-color-light);
    position: relative;
  }

  /* Project accent — a thin vertical rail to the left of the title block,
     same vocab as Plaza project rows. Visible only above the meta line. */
  .project__head::before {
    content: '';
    position: absolute;
    inset-inline-start: -16px;
    inset-block-start: 8px;
    inline-size: 3px;
    block-size: 28px;
    background: var(--c, var(--text-muted));
    border-radius: 2px;
  }

  /* Masthead typography via base.css h1 defaults. */
  .project__title {
    margin: 0;
    color: var(--text-color);
  }
  .project__title em {
    font-style: italic;
    color: var(--text-color);
  }

  .project__title-skeleton {
    color: var(--text-faint);
  }

  .project__meta {
    display: flex;
    align-items: baseline;
    gap: var(--space-xs);
    flex-wrap: wrap;
    margin-block-start: var(--space-xs);
  }

  .project__meta-sep {
    color: var(--text-faint);
  }

  .project__meta-dates {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    color: var(--text-faint);
  }

  .project__notes {
    display: flex;
    flex-direction: column;
    gap: var(--space-s);
  }

  .project__lines {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    margin: 0;
    padding: 0;
  }

  .project__stubs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: var(--space-m);
  }

  .project__stub {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding: var(--space-m);
    border: 1px solid var(--border-color-light);
    border-radius: var(--radius-l);
    background: var(--bg-light);
  }

  .project__stub-body {
    margin: 0;
    font-size: var(--text-s);
    color: var(--text-muted);
    line-height: 1.55;
  }
</style>
