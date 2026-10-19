<script lang="ts">
  /**
   * Project detail — /h/[workspace]/project/[slug]/ — Phase 0.1 surface.
   *
   * Editorial v0.5 layout: kicker + display serif title + mono meta line,
   * Relationships block (conversations), and dashed deferred-phase stubs
   * (Lines, Assets, Team).
   *
   * Shares the ['projects', { status: 'active' }] cache the shell warms, so
   * arriving from the home grid or ⌘K costs no extra fetch. Resolution is
   * slug + workspace — project slugs are only unique per workspace
   * (ADR-024), so slug alone could hit the wrong space's project.
   */

  import { docTitle } from '$lib/doc-title';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import {
    workspacesQueryOptions,
    activeProjectsQueryOptions,
    allLinesQueryOptions,
  } from '$lib/nav-queries';
  import RecordHead from '$lib/components/RecordHead.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import { spaceCrumb } from '$lib/record-crumbs';
  import CastPanel from '$lib/components/CastPanel.svelte';
  import ProjectIdentityPopover from '$lib/components/ProjectIdentityPopover.svelte';
  import RelationshipStub from '$lib/components/RelationshipStub.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import YNotes from '$lib/components/YNotes.svelte';
  import { dayMonthYear } from '$lib/datetime';
  import { appLocale, t } from '$lib/i18n';

  const locale = appLocale();

  /** Project status in the viewer's language; an unknown value shows as itself. */
  function projectStatusLabel(status: string): string {
    if (status === 'draft') return t('project.status_draft', locale);
    if (status === 'active') return t('project.status_active', locale);
    if (status === 'archived') return t('project.status_archived', locale);
    return status;
  }

  const workspacesQuery = createQuery(workspacesQueryOptions());
  const projectsQuery = createQuery(activeProjectsQueryOptions());

  // Lines of this project — shares the ['lines','all'] cache the shell warms.
  const linesQuery = createQuery(allLinesQueryOptions());

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let projectSlug = $derived(page.params.slug ?? '');

  let workspaceId = $derived(
    $workspacesQuery.data?.items.find((w) => w.slug === workspaceSlug)?.id ?? null,
  );
  let project = $derived(
    workspaceId
      ? ($projectsQuery.data?.items.find(
          (r) => r.slug === projectSlug && r.workspace_id === workspaceId,
        ) ?? null)
      : null,
  );

  // Address: Space › Proyecto (the title names which).
  let crumbs = $derived([
    spaceCrumb($workspacesQuery.data?.items.find((w) => w.slug === workspaceSlug)?.name, workspaceSlug),
    { label: t('create.project', locale) },
  ]);

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

  let siblings = $derived(
    workspaceId
      ? ($projectsQuery.data?.items ?? [])
          .filter((p) => p.workspace_id === workspaceId && p.id !== project?.id)
          .map((p) => ({
            id: p.id,
            initials: p.initials,
            slug: p.slug,
            name: p.name,
            accent: p.accent,
          }))
      : [],
  );

  function formatDate(iso: string | null): string {
    if (!iso) return '';
    return dayMonthYear(iso);
  }
</script>

<svelte:head>
  <title>{docTitle(displayName)}</title>
</svelte:head>

<article class="record project" aria-busy={projectLoading}>
  <RecordHead {crumbs} title={projectLoading ? '…' : displayName}>
    {#snippet mark()}
      {#if project}<ProjectIdentityPopover {project} {siblings} size="30px" />{/if}
    {/snippet}
    {#snippet facts()}
      {#if project}
        <StateBadge label={projectStatusLabel(project.status)} tone={statusTone} />
        {#if project.starts_on || project.ends_on}
          <span
            >{#if project.starts_on}{formatDate(project.starts_on)}{/if}{#if project.starts_on && project.ends_on}
              → {/if}{#if project.ends_on}{formatDate(project.ends_on)}{/if}</span
          >
        {/if}
      {/if}
    {/snippet}
  </RecordHead>

  <RelationshipStub projectSlug={projectSlug} />

  {#if project}
    <section class="project__notes" aria-label={t('person.notes', locale)}>
      <BlockHead title={t('person.notes', locale)} />
      <YNotes
        targetTable="project"
        targetId={project.id}
        placeholder={t('project.notes_ph', locale)}
      />
    </section>
  {/if}

  <section class="project__block" aria-label={t('project.lines', locale)}>
    {#if projectLines.length > 0}
      <BlockHead title={t('project.lines', locale)} count={projectLines.length} concept="lines" />
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
      <EmptyLine label={t('project.lines', locale)} text={t('project.no_lines', locale)} />
    {/if}
  </section>

  <EmptyLine label={t('project.assets', locale)} text={t('project.assets_body', locale)} />

  {#if project}
    <section class="project__block" aria-label={t('project.cast', locale)}>
      <BlockHead title={t('project.cast', locale)} />
      <CastPanel projectId={project.id} />
    </section>
  {/if}
</article>

<style>
  .project__notes,
  .project__block {
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
</style>
