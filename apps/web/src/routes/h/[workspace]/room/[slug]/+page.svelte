<script lang="ts">
  import { page } from '$app/state';

  let workspace = $derived(page.params.workspace);
  let slug = $derived(page.params.slug);
</script>

<svelte:head>
  <title>{slug} — Room — Hour</title>
</svelte:head>

<section class="entity">
  <header>
    <p class="text--s text--dark-muted">Room</p>
    <h1 class="h2">{slug}</h1>
  </header>
  <p class="text--dark-muted">
    Room detail placeholder — tabs (Work / Assets / Team / About) land in Phase 0.1.
  </p>
  <p>
    <a href={`/h/${workspace}`}>← Back to {workspace}</a>
  </p>
</section>

<style>
  @layer components {
    .entity {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
      max-inline-size: 48rem;
    }
  }
</style>
