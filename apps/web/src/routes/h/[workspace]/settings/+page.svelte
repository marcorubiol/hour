<script lang="ts">
  /**
   * Settings — scoped by the workspace segment. The global shell detects
   * this route and exposes <SettingsNav />; this page renders the active
   * section panel in the main column.
   *
   * Active section is driven by the `?section=` query param so the URL
   * is shareable and the sidebar nav stays in sync.
   *
   * Only controls that keep what you set are drawn. Notifications, Billing
   * and Danger zone are hidden until they save (see SettingsNav); Master
   * View, the one real switch of Notifications, lives in Profile.
   *
   * Each section's markup, local state and section-specific styles live in
   * $lib/components/settings/*Section.svelte. This page keeps the section
   * routing, the workspace/project queries and the shared layout CSS tier
   * (promoted to `.set-page :global(…)` so it reaches the section children).
   */

  import { docTitle } from '$lib/doc-title';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { fetchJSON } from '$lib/api';
  import { t, appLocale } from '$lib/i18n';
  import { type SectionId, sectionFrom } from '$lib/components/SettingsNav.svelte';
  import ProfileSection from '$lib/components/settings/ProfileSection.svelte';
  import WorkspacesSection from '$lib/components/settings/WorkspacesSection.svelte';
  import PrivacySection from '$lib/components/settings/PrivacySection.svelte';
  import LanguagesSection from '$lib/components/settings/LanguagesSection.svelte';
  import LensesSection from '$lib/components/settings/LensesSection.svelte';
  import MailSection from '$lib/components/settings/MailSection.svelte';

  const locale = appLocale();

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let active = $derived<SectionId>(
    sectionFrom(page.url.searchParams.get('section')),
  );

  // ─── workspaces & projects ────────────────────────────────────────────
  type Workspace = {
    id: string;
    slug: string;
    name: string;
    kind: 'personal' | 'team';
  };
  type Project = {
    id: string;
    slug: string;
    name: string;
    workspace_id: string;
    status: 'draft' | 'active' | 'archived';
  };

  const workspacesQuery = createQuery({
    queryKey: ['workspaces'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: Workspace[] }>('/api/workspaces', signal),
  });

  const projectsQuery = createQuery({
    queryKey: ['projects', { status: 'active' }],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: Project[] }>('/api/projects?status=active', signal),
  });

  let workspaces = $derived($workspacesQuery.data?.items ?? []);
  let projects = $derived($projectsQuery.data?.items ?? []);
  let currentWorkspace = $derived(workspaces.find((workspace) => workspace.slug === workspaceSlug));
  let currentProjects = $derived(
    projects.filter((project) => project.workspace_id === currentWorkspace?.id),
  );
</script>

<svelte:head>
  <title>{docTitle(t('settings.title', locale))}</title>
</svelte:head>

<article class="record set-page">
  {#if active === 'profile'}
    <ProfileSection {workspaceSlug} />
  {/if}

  {#if active === 'workspaces'}
    <WorkspacesSection {workspaces} {projects} {currentWorkspace} {currentProjects} />
  {/if}

  {#if active === 'privacy'}
    <PrivacySection workspaceId={currentWorkspace?.id} />
  {/if}

  {#if active === 'languages'}
    <LanguagesSection workspaceId={currentWorkspace?.id} />
  {/if}

  {#if active === 'lenses'}
    <LensesSection workspaceId={currentWorkspace?.id} />
  {/if}

  <!-- "Connections" section killed: 7 providers (Fastmail, Holded,
       Spotify, Bandcamp, Drive, Bank...) ZERO actually wired —
       vapor visual. Resurrects when an integration ships. Same
       goes for Personal API token (Phase 1 public API). -->

  {#if active === 'mail'}
    <MailSection workspaceId={currentWorkspace?.id} />
  {/if}
</article>

<style>
  /* The page is rendered inside .workspace-shell__content (which already
     paints background + outer padding). We just need a centred article
     with a sensible reading measure. */
  .set-page {
    --set-pad: clamp(1rem, 1.6vw, 1.5rem);

    color: var(--text-color);
    font-family: var(--font-sans);
  }

  /* ── Shared layout tier ────────────────────────────────────────────────
     These nodes are rendered by the section child components, so plain
     scoped selectors would no longer match them. They are promoted to
     `.set-page :global(…)` — still anchored under this page's root, so
     nothing leaks app-wide. Declarations are verbatim from the pre-split
     page. Section-specific rules live in each *Section.svelte. */

  /* A group is one of the record's blocks: its BlockHead, then its rows. */
  .set-page :global(.set-group) {
    display: flex;
    flex-direction: column;
    gap: var(--space-s);
  }
  .set-page :global(.set-group__body) {
    display: flex;
    flex-direction: column;
  }

  .set-page :global(.set-row) {
    display: grid;
    grid-template-columns: minmax(11.25rem, 1fr) minmax(17.5rem, 1.6fr);
    gap: calc(var(--set-pad) * 1.4);
    align-items: start;
    padding-block: var(--set-pad);
    border-block-end: var(--line-hairline) solid var(--border-color-light);
  }
  .set-page :global(.set-row:last-child) {
    border-block-end: 0;
  }
  .set-page :global(.set-row__lead) {
    padding-block-start: var(--space-xs);
  }
  .set-page :global(.set-row__label) {
    font-size: var(--text-s);
    font-weight: 500;
    color: var(--text-color);
    line-height: 1.3;
  }
  .set-page :global(.set-row__hint) {
    font-size: var(--text-xs);
    color: var(--text-faint);
    line-height: 1.55;
    margin-block-start: var(--space-xs);
    max-inline-size: 36ch;
  }
  .set-page :global(.set-row__ctrl) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-s);
  }
  /* On a phone the two columns (180 + 280 at least) cannot sit side by
     side in 358px: the control drops under its label, the hint keeps its
     place between them. */
  @media (max-width: 47.999rem) {
    .set-page :global(.set-row) {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-s);
    }
    .set-page :global(.set-row__lead) {
      padding-block-start: 0;
    }
  }
  /* A value in a settings row is a field row without its own label
     (ADR-139 p4); one that cannot be edited here is plain text. */
  .set-page :global(.set-row__ctrl > .field) {
    flex: 1 1 12rem;
  }
  .set-page :global(.set-row__value) {
    padding-block: var(--space-xs);
    font-size: var(--text-s);
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
</style>
