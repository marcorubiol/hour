<script module lang="ts">
  /**
   * Types and section catalog live in module scope so they can be
   * imported by the settings page (`import type { SectionId }`). Svelte
   * 5 requires `export type` to sit in `<script module>`.
   */
  export type SectionId =
    | 'profile'
    | 'workspaces'
    | 'privacy'
    | 'languages'
    | 'notifications'
    | 'billing'
    | 'danger';

  type Section = {
    id: SectionId;
    label: string;
    glyph: string;
    danger?: boolean;
  };

  export const SECTIONS: Section[] = [
    { id: 'profile', label: 'Profile', glyph: '◯' },
    { id: 'workspaces', label: 'Workspaces & roles', glyph: '▸' },
    { id: 'privacy', label: 'Visibility & privacy', glyph: '◌' },
    { id: 'languages', label: 'Languages', glyph: '¶' },
    { id: 'notifications', label: 'Notifications', glyph: '◉' },
    { id: 'billing', label: 'Billing', glyph: '€' },
    { id: 'danger', label: 'Danger zone', glyph: '⚠', danger: true },
  ];
</script>

<script lang="ts">
  /**
   * SettingsNav — sidebar nav for Settings. Renders in place of <Plaza />
   * when the user is in /h/[ws]/settings/.
   *
   * Active section is driven by the `?section=` query param so the URL
   * is shareable, survives refresh, and the nav state stays in sync
   * across the sidebar (this component) and the main panel (settings
   * page).
   */

  import { page } from '$app/state';

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let active = $derived<SectionId>(
    (page.url.searchParams.get('section') as SectionId | null) ?? 'profile',
  );

  function hrefFor(id: SectionId): string {
    return `/h/${workspaceSlug}/settings?section=${id}`;
  }
</script>

<nav class="set-nav" aria-label="Settings sections">
  <p class="eyebrow set-nav__eyebrow">Settings</p>

  <ul class="set-nav__list" role="list">
    {#each SECTIONS as s (s.id)}
      <li>
        <a
          href={hrefFor(s.id)}
          class={[
            'set-nav__item',
            active === s.id && 'is-active',
            s.danger && 'is-danger',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-current={active === s.id ? 'page' : undefined}
        >
          <span class="set-nav__glyph" aria-hidden="true">{s.glyph}</span>
          <span class="set-nav__label">{s.label}</span>
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
      gap: 1px;
    }

    .set-nav__item {
      display: grid;
      grid-template-columns: 18px 1fr;
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
      box-shadow: inset 2px 0 0 var(--text-color);
      font-weight: 500;
    }
    .set-nav__item.is-danger {
      color: var(--danger);
    }
    .set-nav__item.is-danger.is-active {
      background: var(--danger-ultra-light);
      box-shadow: inset 2px 0 0 var(--danger);
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
