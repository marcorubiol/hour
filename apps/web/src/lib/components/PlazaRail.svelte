<script lang="ts">
  /**
   * PlazaRail — sidebar body when the shell is collapsed (rail mode).
   *
   * Vertical stack of workspace avatars. Reuses the same TanStack query
   * key as <Plaza /> (`['workspaces']`), so when the user toggles between
   * expanded and collapsed the data is already warm — no re-fetch.
   *
   * Each avatar:
   *   - Accent rail on the inline-start edge (color hash of slug).
   *   - Initial of the workspace name (filled with accent).
   *   - Active state when the URL workspace matches.
   *   - native `title` attribute → tooltip on hover surfaces the full name
   *     (discoverability essential when the UI is icons-only).
   *
   * Click navigates to the workspace home. Expanding the sidebar to see
   * projects/lines is the consumer's job (a button in the shell header).
   */

  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import { accentVar } from '$lib/utils/accent';
  import Avatar from './Avatar.svelte';

  type Workspace = {
    id: string;
    slug: string;
    name: string;
    kind: 'personal' | 'team';
  };

  async function fetchWorkspaces(signal: AbortSignal): Promise<{ items: Workspace[] }> {
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) {
      goto('/login', { replaceState: true });
      throw new Error('Missing JWT');
    }
    const res = await fetch('/api/workspaces', {
      signal,
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return (await res.json()) as { items: Workspace[] };
  }

  const workspacesQuery = createQuery({
    queryKey: ['workspaces'],
    queryFn: ({ signal }) => fetchWorkspaces(signal),
  });

  let activeWorkspaceSlug = $derived(page.params.workspace ?? '');
  let workspaces = $derived($workspacesQuery.data?.items ?? []);
</script>

<nav class="plaza-rail" aria-label="Places">
  {#if $workspacesQuery.isPending}
    <span class="plaza-rail__state" aria-label="Loading">·</span>
  {:else if $workspacesQuery.isError}
    <span class="plaza-rail__state plaza-rail__state--danger" title="Couldn't load">!</span>
  {:else}
    <ul class="plaza-rail__list" role="list">
      {#each workspaces as workspace (workspace.id)}
        {@const isActive = workspace.slug === activeWorkspaceSlug}
        <li class="plaza-rail__item">
          <a
            class={['plaza-rail__link', isActive && 'plaza-rail__link--active']
              .filter(Boolean)
              .join(' ')}
            href={`/h/${workspace.slug}/`}
            title={workspace.name}
            aria-label={workspace.name}
            aria-current={isActive ? 'page' : undefined}
            style={`--c: ${accentVar(workspace.slug)}`}
          >
            <span class="plaza-rail__rail" aria-hidden="true"></span>
            <Avatar size="s" name={workspace.name} accentSlug={workspace.slug} />
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</nav>

<style>
  @layer components {
    .plaza-rail {
      display: flex;
      flex-direction: column;
    }

    .plaza-rail__list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .plaza-rail__item {
      display: flex;
      justify-content: center;
    }

    .plaza-rail__link {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: var(--space-xs);
      border-radius: var(--radius);
      text-decoration: none;
      transition: background var(--transition);
    }

    .plaza-rail__link:hover {
      background: var(--bg-hover);
    }

    .plaza-rail__link:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 2px;
    }

    .plaza-rail__rail {
      position: absolute;
      inset-block: 6px;
      inset-inline-start: 0;
      inline-size: 3px;
      background: transparent;
      border-radius: 2px;
      transition: background var(--transition);
    }

    .plaza-rail__link--active .plaza-rail__rail {
      background: var(--c, var(--text-muted));
    }

    .plaza-rail__state {
      padding-block: var(--space-s);
      text-align: center;
      font-size: var(--text-s);
      color: var(--text-faint);
    }

    .plaza-rail__state--danger {
      color: var(--danger);
    }
  }
</style>
