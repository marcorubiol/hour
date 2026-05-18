<script lang="ts">
  /**
   * House home — empty Spotlight-style prompt when no Room is selected.
   * The sidebar already shows what's available; main is intentionally
   * quiet here so the user picks where to go.
   */
  import { page } from '$app/state';

  let workspace = $derived(page.params.workspace);
</script>

<svelte:head>
  <title>Hour</title>
</svelte:head>

<section class="home">
  <h1 class="home__greeting">Hello, Marco.</h1>
  <p class="home__prompt">What would you like to work on?</p>
</section>

<style>
  @layer components {
    .home {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-xs);
      min-block-size: 60vh;
      text-align: center;
    }

    .home__greeting {
      font-size: var(--text-xxl);
      font-weight: 500;
      margin: 0;
    }

    .home__prompt {
      font-size: var(--text-m);
      color: var(--text-dark-muted);
      margin: 0;
    }
  }
</style>
