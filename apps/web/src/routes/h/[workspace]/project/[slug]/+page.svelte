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
  import { TEAM_ANCHOR } from '$lib/first-day';
  import { scrollWhenNamed } from '$lib/thread-reading.svelte';
  import ProjectIdentityPopover from '$lib/components/ProjectIdentityPopover.svelte';
  import RelationshipStub from '$lib/components/RelationshipStub.svelte';
  import { projectStepsQueryOptions } from '$lib/relation-stub';
  import MissingBand from '$lib/components/MissingBand.svelte';
  import { stepsDueBand } from '$lib/steps-due-band';
  import { lensOn } from '$lib/lenses.svelte';
  import { toStore } from 'svelte/store';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import YNotes from '$lib/components/YNotes.svelte';
  import { dayMonthYear, localDayISO, localeDayMonth, localeWeekdayShort } from '$lib/datetime';
  import { LOCALE_TAG, appLocale, t } from '$lib/i18n';
  import { fetchJSON } from '$lib/api';
  import { projectBolosQueryOptions } from '$lib/bolo-queries';
  import { booksHref } from '$lib/bolo-pick';
  import { fmtCurrency } from '$lib/money';
  import { boloLine, bolosBySala, projectFacts } from '$lib/sheet-mirror';
  import MirrorRows, { type MirrorRow } from '$lib/components/MirrorRows.svelte';

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

  // «Falta» (ADR-139 § 2): the project's conversations whose next step is
  // due, from a page in next-step order (the block below reads «lo que pide»),
  // read by the project's id: the slug repeats across spaces.
  const stubQuery = createQuery(toStore(() => projectStepsQueryOptions(project?.id ?? null)));
  let missingItems = $derived(
    project
      ? stepsDueBand($stubQuery.data?.items ?? [], {
          today: localDayISO(),
          total: $stubQuery.data?.total,
          workspaceSlug,
          moreHref: lensOn('conversations') ? `/h/conversations?scope=p:${project.id}` : null,
          locale,
        })
      : [],
  );

  // ── The mirror of the venue's record (ADR-177 § 4) ───────────────────
  // Its bolos with their fee, one row per venue, and the facts line with
  // money. The feed answers only who reads money here (`list_money_bolos`):
  // without it there are no rows and no line, as everywhere money hides.
  const today = localDayISO();
  const bolosQuery = createQuery(toStore(() => projectBolosQueryOptions(project?.id ?? '')));
  let projectBolos = $derived($bolosQuery.data?.items ?? []);

  let salaRows = $derived.by<MirrorRow[]>(() =>
    bolosBySala(projectBolos, today).map((g, i) => ({
      key: g.conversationId ?? `venue-${i}`,
      href: g.conversationId ? `/h/${workspaceSlug}/conversation/${g.conversationId}` : null,
      title: g.name || t('perf.bolo_unnamed', locale),
      mark: { kind: 'organization' as const },
      // A bolo lives in Cuentas, where the money is written (ADR-043).
      bolos: g.bolos.map((b) => boloLine(b, { locale, href: booksHref(b.project_id, { boloId: b.id }), where: b.city })),
    })),
  );

  // «3 por responder»: the conversations of the project whose turn is ours,
  // the lens's own filter, counted by the list's total.
  const oursQuery = createQuery(
    toStore(() => ({
      queryKey: ['conversations', { project_ids: project?.id ?? null, turno: 'nuestro', limit: 1 }] as const,
      enabled: Boolean(project?.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ total: number }>(
          `/api/conversations?${new URLSearchParams({ project_ids: project!.id, turno: 'nuestro', limit: '1' })}`,
          signal,
        ),
    })),
  );

  let factsLine = $derived.by<string[]>(() => {
    const f = projectFacts(projectBolos, today);
    const out: string[] = [];
    if (f.firmFunctions > 0) {
      out.push(
        f.firmFunctions === 1
          ? t('project.facts_functions_one', locale)
          : t('project.facts_functions', locale, { n: f.firmFunctions }),
      );
    }
    if (f.sold.length > 0) {
      out.push(t('project.facts_sold', locale, { amount: f.sold.map(([c, a]) => fmtCurrency(a, c, locale)).join(' + ') }));
    }
    if (f.next) {
      const tag = LOCALE_TAG[locale];
      const day = localDayISO(new Date(f.next.at));
      const when = [`${localeWeekdayShort(day, tag)} ${localeDayMonth(day, tag)}`, f.next.city].filter(Boolean).join(' · ');
      out.push(t('project.facts_next', locale, { when }));
    }
    const ours = $oursQuery.data?.total ?? 0;
    if (ours > 0) out.push(t('project.facts_to_answer', locale, { n: ours }));
    return out;
  });

  function formatDate(iso: string | null): string {
    if (!iso) return '';
    return dayMonthYear(iso);
  }

  // `#team` (the first day's list, tarea 137): down to the cast once it is
  // drawn, which is after the project resolves, so the browser cannot.
  let castEl = $state<HTMLElement>();
  scrollWhenNamed(`#${TEAM_ANCHOR}`, () => castEl);
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
        <!-- «¿Cómo va la gira?» (ADR-177 § 4): the facts line with money. -->
        {#each factsLine as fact (fact)}<span data-testid="project-fact">{fact}</span>{/each}
      {/if}
    {/snippet}
    {#snippet band()}
      <MissingBand items={missingItems} {locale} />
    {/snippet}
  </RecordHead>

  <RelationshipStub projectId={project?.id ?? null} {workspaceSlug} />

  {#if salaRows.length > 0}
    <!-- The mirror of the venue's projects: one row per venue, its bolos with their fee. -->
    <section class="project__block" aria-label={t('conversations.bolos', locale)} data-testid="project-bolos">
      <BlockHead title={t('conversations.bolos', locale)} count={salaRows.reduce((n, r) => n + r.bolos.length, 0)} />
      <MirrorRows rows={salaRows} />
    </section>
  {/if}

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

  {#if project}
    <section class="project__block" id={TEAM_ANCHOR} bind:this={castEl} aria-label={t('project.cast', locale)}>
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
