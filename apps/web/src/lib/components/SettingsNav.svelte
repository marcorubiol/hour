<script module lang="ts">
  import type { NavWorkspace } from '$lib/nav';
  import { managesSpaceIn, settingsSectionsFor } from '$lib/workspace-role';

  /**
   * Types and section catalog live in module scope so they can be
   * imported by the settings page (`import type { SectionId }`). Svelte
   * 5 requires `export type` to sit in `<script module>`.
   */
  export type SectionId =
    | 'profile'
    | 'workspaces'
    | 'space'
    | 'lenses'
    | 'tags'
    | 'facets'
    | 'facet-packages'
    | 'facet-people'
    | 'mail';

  type Section = {
    id: SectionId;
    /** i18n key; resolved with t() where the label is drawn. */
    labelKey: string;
    glyph: string;
    danger?: boolean;
    /** A page of a section split in several (136): drawn under it, and its crumb. */
    parent?: SectionId;
  };

  export const SECTIONS: Section[] = [
    { id: 'profile', labelKey: 'settings.nav_profile', glyph: '◯' },
    { id: 'workspaces', labelKey: 'settings.nav_workspaces', glyph: '▸' },
    { id: 'space', labelKey: 'settings.nav_space', glyph: '¶' },
    { id: 'lenses', labelKey: 'settings.nav_lenses', glyph: '◫' },
    { id: 'tags', labelKey: 'settings.nav_tags', glyph: '#' },
    { id: 'facets', labelKey: 'settings.nav_facets', glyph: '◇' },
    { id: 'facet-packages', labelKey: 'settings.nav_facet_packages', glyph: '', parent: 'facets' },
    { id: 'facet-people', labelKey: 'settings.nav_facet_people', glyph: '', parent: 'facets' },
    { id: 'mail', labelKey: 'settings.nav_mail', glyph: '@' },
    // Notifications, Billing and Danger zone are hidden: every control in
    // them kept nothing (a mocked card, switches with no writer, buttons
    // with no handler). Each comes back with the first control that saves.
  ];

  /** What is the person's own in any space, whatever their role in it. */
  export const PERSONAL_SECTIONS: readonly SectionId[] = ['profile'];

  /** What only who manages the space changes: a member would find one line saying so. */
  export const ADMIN_SECTIONS: readonly SectionId[] = ['facet-people'];

  /**
   * The sections the space in the URL offers whoever looks: all of them,
   * except in a space they are a guest of (a bolo invitation), where only
   * their profile is theirs (`$lib/workspace-role`).
   */
  export function offeredSections(workspace: Pick<NavWorkspace, 'my_role'> | null | undefined): Section[] {
    const ids = settingsSectionsFor(workspace, SECTIONS.map((s) => s.id), PERSONAL_SECTIONS);
    const admin = managesSpaceIn(workspace);
    return SECTIONS.filter((s) => ids.includes(s.id) && (admin || !ADMIN_SECTIONS.includes(s.id)));
  }

  /** The ids of sections that were folded into another: old links still land (ADR-156). */
  const FOLDED: Readonly<Record<string, SectionId>> = { privacy: 'space', languages: 'space' };

  /** A `?section=` that is not (or no longer) a section, or not one this space offers, lands on Profile. */
  export function sectionOf(id: SectionId): Section | undefined {
    return SECTIONS.find((s) => s.id === id);
  }

  /**
   * The crumbs above a section's title: «Ajustes», and the section it is a
   * page of when it has one. The menu has no groups, so the crumb has none (136).
   */
  export function settingsCrumbs(id: SectionId, label: (key: string) => string): { label: string }[] {
    const parent = sectionOf(id)?.parent;
    const parentSection = parent ? sectionOf(parent) : undefined;
    return [
      { label: label('settings.title') },
      ...(parentSection ? [{ label: label(parentSection.labelKey) }] : []),
    ];
  }

  export function sectionFrom(param: string | null, offered: readonly Section[] = SECTIONS): SectionId {
    const id = (param && FOLDED[param]) || param;
    return offered.some((s) => s.id === id) ? (id as SectionId) : 'profile';
  }
</script>

<script lang="ts">
  /**
   * SettingsNav — sidebar nav for Settings. Renders in place of <Plaza />
   * when the user is in /h/[ws]/settings/, from 1024 up; under it the shell
   * hides it and the page shows the same sections as a dropdown
   * (SettingsSectionSelect).
   *
   * Active section is driven by the `?section=` query param so the URL
   * is shareable, survives refresh, and the nav state stays in sync
   * across the sidebar (this component) and the main panel (settings
   * page).
   */

  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { t, appLocale } from '$lib/i18n';
  import { workspacesQueryOptions } from '$lib/nav-queries';

  const locale = appLocale();

  let workspaceSlug = $derived(page.params.workspace ?? '');
  const workspacesQuery = createQuery(workspacesQueryOptions());
  let offered = $derived(
    offeredSections($workspacesQuery.data?.items.find((w) => w.slug === workspaceSlug)),
  );
  let active = $derived<SectionId>(
    sectionFrom(page.url.searchParams.get('section'), offered),
  );

  function hrefFor(id: SectionId): string {
    return `/h/${workspaceSlug}/settings?section=${id}`;
  }
</script>

<nav class="set-nav" aria-label={t('settings.nav_aria', locale)}>
  <p class="eyebrow set-nav__eyebrow">{t('settings.title', locale)}</p>

  <ul class="set-nav__list" role="list">
    {#each offered as s (s.id)}
      <li>
        <a
          href={hrefFor(s.id)}
          class={[
            'set-nav__item',
            active === s.id && 'is-active',
            s.danger && 'is-danger',
            s.parent && 'is-child',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-current={active === s.id ? 'page' : undefined}
        >
          <span class="set-nav__glyph" aria-hidden="true">{s.glyph}</span>
          <span class="set-nav__label">{t(s.labelKey, locale)}</span>
        </a>
      </li>
    {/each}
  </ul>
</nav>

<style>
  @layer components {
    .set-nav {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .set-nav__eyebrow {
      margin: 0;
      padding-inline: var(--space-s);
    }

    .set-nav__list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: var(--line-hairline);
    }

    .set-nav__item {
      display: grid;
      grid-template-columns: 1.125rem 1fr;
      gap: var(--space-s);
      align-items: center;
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      border-radius: var(--radius-s);
      color: var(--text-muted);
      font-size: var(--text-s);
      text-decoration: none;
      transition: background var(--transition), color var(--transition);
    }
    .set-nav__item:hover {
      background: var(--bg-hover);
      color: var(--text-color);
    }
    .set-nav__item.is-active {
      background: var(--bg-active);
      color: var(--text-color);
      box-shadow: inset var(--line) 0 0 var(--text-color);
      font-weight: 500;
    }
    /* A page of a split section sits under it, one step in. */
    .set-nav__item.is-child {
      padding-inline-start: calc(var(--space-s) * 2);
    }
    .set-nav__item.is-danger {
      color: var(--danger);
    }
    .set-nav__item.is-danger.is-active {
      background: var(--danger-ultra-light);
      box-shadow: inset var(--line) 0 0 var(--danger);
    }
    .set-nav__glyph {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
      text-align: center;
    }
    .set-nav__item.is-active .set-nav__glyph {
      color: var(--text-color);
    }
    .set-nav__item.is-danger .set-nav__glyph {
      color: var(--danger);
    }
  }
</style>
