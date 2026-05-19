<script lang="ts">
  /**
   * /h/  — fallback landing.
   *
   * The app shell with sidebar lives at /h/[workspace]/+layout.svelte, so
   * any URL outside that path has no sidebar. This page bounces the user
   * to a sensible workspace context, preserving any selection query params
   * they arrived with (`?ws=`, `?project=`).
   *
   * Workspace priority: first accepted workspace_membership ordered by
   * created_at asc — same default the auth hook uses for
   * `current_workspace_id`. If the user has zero workspaces (shouldn't
   * happen post-ADR-032 signup trigger), bounces to /login.
   */

  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';

  let state = $state<'loading' | 'error'>('loading');

  onMount(async () => {
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) {
      void goto('/login', { replaceState: true });
      return;
    }
    try {
      const res = await fetch('/api/workspaces?limit=1', {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!res.ok) {
        state = 'error';
        return;
      }
      const body = (await res.json()) as {
        items: Array<{ slug: string }>;
      };
      const firstSlug = body.items[0]?.slug;
      if (!firstSlug) {
        state = 'error';
        return;
      }
      const search = page.url.search; // preserve ?ws= and ?project= if any
      void goto(`/h/${firstSlug}/${search}`, { replaceState: true });
    } catch {
      state = 'error';
    }
  });
</script>

<div class="h-landing">
  {#if state === 'loading'}
    <p>Loading…</p>
  {:else}
    <p>Couldn't determine your workspace. <a href="/login">Sign in again</a>.</p>
  {/if}
</div>

<style>
  .h-landing {
    display: grid;
    place-items: center;
    min-block-size: 100dvh;
    font-size: var(--text-s);
    color: var(--text-faint);
  }
</style>
