<script lang="ts">
  /**
   * /h/ — empty-selection landing.
   *
   * Renders inside the /h/+layout shell (sidebar + top nav are visible).
   * This page only owns the MAIN content area. With nothing selected:
   *   - Plaza shows all workspaces unfilled
   *   - LineList shows all accessible lines (sorted by last-used)
   *   - Main shows a quiet Spotlight prompt
   *
   * Users pick a workspace or project from the sidebar to navigate to its
   * canonical URL (/h/[ws]/, /h/[ws]/project/[slug]/, etc).
   */

  import { decodeJwtClaim } from '$lib/realtime';

  function titleCase(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  let firstName = $state<string>('there');

  $effect(() => {
    if (typeof window === 'undefined') return;
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) return;
    const full =
      decodeJwtClaim(jwt, 'user_metadata.full_name') ||
      decodeJwtClaim(jwt, 'user_metadata.name');
    if (full) {
      firstName = full.split(/\s+/)[0] ?? full;
      return;
    }
    const email = decodeJwtClaim(jwt, 'email');
    if (email) {
      const local = email.split('@')[0] ?? '';
      const first = local.split(/[._-]+/)[0];
      if (first && first.length < local.length) firstName = titleCase(first);
    }
  });
</script>

<svelte:head>
  <title>Hour</title>
</svelte:head>

<section class="empty-home">
  <p class="eyebrow">No selection</p>
  <h1 class="empty-home__title">Hello, {firstName}.</h1>
  <p class="empty-home__sub">
    Pick a workspace or project from the sidebar to focus, or browse all
    lines below.
  </p>
</section>

<style>
  @layer components {
    .empty-home {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      max-inline-size: 40rem;
      padding-block-start: var(--space-xl, var(--space-l));
    }

    .empty-home__title {
      font-family: var(--font-display);
      font-size: var(--text-3xl, var(--text-2xl, var(--text-xl)));
      font-weight: 400;
      letter-spacing: -0.02em;
      margin: 0;
      color: var(--text-color);
    }

    .empty-home__sub {
      margin: 0;
      font-size: var(--text-m);
      line-height: 1.5;
      color: var(--text-muted);
    }
  }
</style>
