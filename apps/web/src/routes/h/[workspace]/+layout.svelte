<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { Snippet } from 'svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import { isReservedWorkspaceSlug } from '$lib/reserved-slugs';
  import { provideLens, useLens, type Lens } from '$lib/stores/lens.svelte';
  import { provideSelection } from '$lib/stores/selection.svelte';

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();

  // Reserved-slug guard — defence in depth even though SvelteKit may have
  // already routed us here. If a literal reserved word lands as workspace
  // slug, redirect to root immediately.
  let workspaceSlug = $derived(page.params.workspace ?? '');
  let blocked = $derived(isReservedWorkspaceSlug(workspaceSlug));

  $effect(() => {
    if (blocked) goto('/', { replaceState: true });
  });

  // Provide the workspace + lens + selection context to the whole subtree.
  // Workspace resolution (slug → DB row, previous_slugs fallback, membership
  // check) is deferred to Phase 0.1 when Plaza loads real data — for now
  // we pass the slug as-is so children placeholders can echo it.
  const selection = provideSelection();
  const lens = provideLens('desk');

  $effect(() => {
    selection.setWorkspace(workspaceSlug);
  });

  let sidebarOpen = $state(true);

  const lensOptions: { id: Lens; label: string }[] = [
    { id: 'desk', label: 'Desk' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'contacts', label: 'Contacts' },
    { id: 'money', label: 'Money' },
  ];

  function logout() {
    localStorage.removeItem('hour_jwt');
    localStorage.removeItem('hour_refresh');
    localStorage.removeItem('hour_expires_at');
    goto('/login', { replaceState: true });
  }
</script>

{#if !blocked}
  <div class="workspace-shell">
    <Sidebar bind:open={sidebarOpen} label="{workspaceSlug} navigation">
      {#snippet header()}
        <strong>Hour</strong>
        <span class="text--s text--dark-muted">/ {workspaceSlug}</span>
      {/snippet}
      {#snippet children({ close })}
        <nav class="workspace-shell__lenses">
          {#each lensOptions as opt (opt.id)}
            <button
              type="button"
              class={`menu__item${lens.current === opt.id ? ' menu__item--active' : ''}`}
              onclick={() => {
                lens.set(opt.id);
                close();
              }}
            >{opt.label}</button>
          {/each}
        </nav>
      {/snippet}
      {#snippet footer()}
        <Avatar size="s" name={workspaceSlug} tone="primary" />
        <span class="text--s">{workspaceSlug}</span>
        <button type="button" class="btn--outline btn--xs" onclick={logout}>
          Sign out
        </button>
      {/snippet}
    </Sidebar>

    <main class="workspace-shell__main">
      <header class="workspace-shell__topbar">
        <button
          type="button"
          class="btn--outline btn--s workspace-shell__toggle"
          onclick={() => (sidebarOpen = !sidebarOpen)}
          aria-label={sidebarOpen ? 'Hide navigation' : 'Show navigation'}
        >☰</button>
        <span class="text--s text--dark-muted">
          Lens: <code>{lens.current}</code>
        </span>
      </header>

      <div class="workspace-shell__content">
        {#if children}{@render children()}{/if}
      </div>
    </main>
  </div>
{/if}

<style>
  @layer components {
    .workspace-shell {
      display: flex;
      min-block-size: 100vh;
    }

    .workspace-shell__main {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-inline-size: 0;
    }

    .workspace-shell__topbar {
      display: flex;
      align-items: center;
      gap: var(--space-m);
      padding-block: var(--space-s);
      padding-inline: var(--gutter);
      border-block-end: var(--divider);
      background: var(--base);
    }

    .workspace-shell__toggle {
      padding-inline: var(--space-s);
    }

    .workspace-shell__content {
      flex: 1;
      padding: var(--space-l);
    }

    .workspace-shell__lenses {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
  }
</style>
