<script lang="ts">
  /**
   * Project detail — /h/[workspace]/project/[slug]/ — Phase 0.1 surface.
   *
   * Editorial v0.5 layout: kicker + display serif title + mono meta line,
   * Relationships block (engagements), and dashed deferred-phase stubs
   * (Lines, Assets, Team).
   *
   * Shares the ['projects', { status: 'active' }] cache the shell warms, so
   * arriving from the home grid or ⌘K costs no extra fetch. Resolution is
   * slug + workspace — project slugs are only unique per workspace
   * (ADR-024), so slug alone could hit the wrong space's project.
   */

  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import {
    workspacesQueryOptions,
    activeProjectsQueryOptions,
    allLinesQueryOptions,
  } from '$lib/nav-queries';
  import { accentVar, accentVarFor } from '$lib/utils/accent';
  import { useBreadcrumb } from '$lib/stores/breadcrumb.svelte';
  import { projectPin } from '$lib/stores/pins.svelte';
  import RelationshipStub from '$lib/components/RelationshipStub.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import YNotes from '$lib/components/YNotes.svelte';
  import { dayMonthYear } from '$lib/datetime';

  const workspacesQuery = createQuery(workspacesQueryOptions());
  const projectsQuery = createQuery(activeProjectsQueryOptions());

  // Lines of this project — shares the ['lines','all'] cache the shell warms.
  const linesQuery = createQuery(allLinesQueryOptions());

  const breadcrumb = useBreadcrumb();

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let projectSlug = $derived(page.params.slug ?? '');

  let workspaceId = $derived(
    $workspacesQuery.data?.items.find((w) => w.slug === workspaceSlug)?.id ?? null,
  );
  let activeWorkspaceName = $derived(
    $workspacesQuery.data?.items.find((w) => w.slug === workspaceSlug)?.name ?? workspaceSlug,
  );
  let project = $derived(
    workspaceId
      ? ($projectsQuery.data?.items.find(
          (r) => r.slug === projectSlug && r.workspace_id === workspaceId,
        ) ?? null)
      : null,
  );

  // Publish this project's address (space › project) + pin toggle to the
  // shell breadcrumb bar. Cleared on unmount.
  $effect(() => {
    if (project) {
      breadcrumb.set(
        [
          {
            label: activeWorkspaceName,
            href: `/h/${workspaceSlug}/`,
            kind: 'space',
            accent: accentVar(workspaceSlug),
          },
          { label: project.name, kind: 'node' },
        ],
        { pin: { id: projectPin(project.id), label: project.name } },
      );
    } else {
      breadcrumb.clear();
    }
    return () => breadcrumb.clear();
  });

  let displayName = $derived(project?.name ?? projectSlug);
  let projectLoading = $derived(
    ($projectsQuery.isPending || $workspacesQuery.isPending) && !project,
  );

  let statusTone = $derived.by<'success' | 'warning' | 'faint' | 'neutral'>(() => {
    if (!project) return 'neutral';
    if (project.status === 'active') return 'success';
    if (project.status === 'draft') return 'warning';
    return 'faint';
  });

  // Filter by resolved project id, not slug — slugs repeat across workspaces.
  let projectLines = $derived(
    project ? ($linesQuery.data?.items ?? []).filter((l) => l.project?.id === project.id) : [],
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
