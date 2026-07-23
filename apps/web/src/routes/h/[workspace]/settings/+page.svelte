<script lang="ts">
  /**
   * Settings — scoped by the workspace segment. The global shell detects
   * this route and exposes <SettingsNav />; this page renders the active
   * section panel in the main column.
   *
   * Active section is driven by the `?section=` query param so the URL
   * is shareable and the sidebar nav stays in sync.
   *
   * Phase 0 reality: only Profile (full name, email) and Notifications →
   * Master View are wired. Workspaces/privacy/languages/notifications/
   * billing/danger are kept as scaffolding for the cases the active backlog
   * will actually need; the rest was pruned (vapor).
   *
   * Each section's markup, local state and section-specific styles live in
   * $lib/components/settings/*Section.svelte. This page keeps the section
   * routing, the workspace/project queries and the shared layout CSS tier
   * (promoted to `.set-page :global(…)` so it reaches the section children).
   */

  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { fetchJSON } from '$lib/api';
  import { type SectionId } from '$lib/components/SettingsNav.svelte';
  import ProfileSection from '$lib/components/settings/ProfileSection.svelte';
  import WorkspacesSection from '$lib/components/settings/WorkspacesSection.svelte';
  import PrivacySection from '$lib/components/settings/PrivacySection.svelte';
  import LanguagesSection from '$lib/components/settings/LanguagesSection.svelte';
  import NotificationsSection from '$lib/components/settings/NotificationsSection.svelte';
  import BillingSection from '$lib/components/settings/BillingSection.svelte';
  import DangerSection from '$lib/components/settings/DangerSection.svelte';

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let active = $derived<SectionId>(
    (page.url.searchParams.get('section') as SectionId | null) ?? 'profile',
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
  <title>Settings — Hour</title>
</svelte:head>

<article class="set-page">
  {#if active === 'profile'}
    <ProfileSection {workspaceSlug} />
  {/if}

  {#if active === 'workspaces'}
    <WorkspacesSection {workspaces} {projects} {currentWorkspace} {currentProjects} />
  {/if}

  {#if active === 'privacy'}
    <PrivacySection />
  {/if}

  {#if active === 'languages'}
    <LanguagesSection />
  {/if}

  <!-- "Connections" section killed: 7 providers (Fastmail, Holded,
       Spotify, Bandcamp, Drive, Bank...) ZERO actually wired —
       vapor visual. Resurrects when an integration ships. Same
       goes for Personal API token (Phase 1 public API). -->

  {#if active === 'notifications'}
    <NotificationsSection />
  {/if}

  {#if active === 'billing'}
    <BillingSection />
  {/if}

  {#if active === 'danger'}
    <DangerSection />
  {/if}
</article>

<style>
  /* The page is rendered inside .workspace-shell__content (which already
     paints background + outer padding). We just need a centred article
     with a sensible reading measure. */
  .set-page {
    --set-pad: clamp(16px, 1.6vw, 24px);

    color: var(--text-color);
    font-family: var(--font-sans);
  }

  /* ── Shared layout tier ────────────────────────────────────────────────
     These nodes are rendered by the section child components, so plain
     scoped selectors would no longer match them. They are promoted to
     `.set-page :global(…)` — still anchored under this page's root, so
     nothing leaks app-wide. Declarations are verbatim from the pre-split
     page. Section-specific rules live in each *Section.svelte. */

  .set-page :global(.set-mast) {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    margin-block-end: calc(var(--set-pad) * 1.2);
    padding-block-end: var(--space-m);
  }
  .set-page :global(.set-mast__kicker) {
    margin: 0;
  }
  /* Masthead typography via base.css h1 defaults. */
  .set-page :global(.set-mast__title) {
    margin: 0;
  }
  .set-page :global(.set-mast__title em) {
    font-style: italic;
    color: var(--text-color);
  }
  .set-page :global(.set-mast__sub) {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-m);
    line-height: 1.55;
    max-inline-size: 56ch;
  }

  .set-page :global(.set-group) {
    margin-block-end: calc(var(--set-pad) * 2);
  }
  .set-page :global(.set-group__head) {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    margin-block-end: var(--space-s);
    padding-block-end: var(--space-xs);
    border-block-end: 1px solid var(--border-color-light);
  }
  /* Kicker typography via base.css .eyebrow. */

  .set-page :global(.set-group__title) {
    font-family: var(--font-display);
    font-size: var(--h3);
    font-weight: 400;
    letter-spacing: -0.015em;
    margin: 0;
    color: var(--text-color);
  }
  .set-page :global(.set-group__body) {
    display: flex;
    flex-direction: column;
  }

  .set-page :global(.set-row) {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) minmax(280px, 1.6fr);
    gap: calc(var(--set-pad) * 1.4);
    align-items: start;
    padding-block: var(--set-pad);
    border-block-end: 1px solid var(--border-color-light);
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
  .set-page :global(.set-row.is-danger .set-row__label) {
    color: var(--danger);
  }

  .set-page :global(.set-seg) {
    display: inline-flex;
    background: var(--bg-light);
    border: 1px solid var(--border-color-light);
    border-radius: var(--radius);
    padding: 2px;
  }
  .set-page :global(.set-seg button) {
    appearance: none;
    background: transparent;
    border: 0;
    font: inherit;
    font-size: var(--text-xs);
    color: var(--text-muted);
    padding-block: var(--space-xs);
    padding-inline: var(--space-s);
    border-radius: 4px;
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  .set-page :global(.set-seg button:hover) {
    color: var(--text-color);
  }
  .set-page :global(.set-seg button.is-on) {
    background: var(--bg-ultra-light);
    color: var(--text-color);
    font-weight: 500;
    box-shadow: var(--box-shadow-1);
  }

  .set-page :global(.set-toggle) {
    appearance: none;
    border: 0;
    background: var(--border-color-dark);
    inline-size: 36px;
    block-size: 20px;
    border-radius: var(--radius-circle);
    padding: 2px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    transition: background var(--transition);
  }
  .set-page :global(.set-toggle__dot) {
    inline-size: 16px;
    block-size: 16px;
    border-radius: 50%;
    background: var(--bg-ultra-light);
    box-shadow: var(--box-shadow-1);
    transition: transform var(--transition);
  }
  .set-page :global(.set-toggle.is-on) {
    background: var(--text-color);
  }
  .set-page :global(.set-toggle.is-on .set-toggle__dot) {
    transform: translateX(16px);
  }
</style>
