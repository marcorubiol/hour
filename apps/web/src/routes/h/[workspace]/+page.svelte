<script lang="ts">
  import { page } from '$app/state';

  let workspace = $derived(page.params.workspace);
</script>

<svelte:head>
  <title>{workspace} — Hour</title>
</svelte:head>

<section class="house">
  <header>
    <h1 class="h2">{workspace}</h1>
    <p class="text--dark-muted">House overview · placeholder for Plaza/Desk shell (Phase 0.1).</p>
  </header>

  <ul class="house__links">
    <li><a href={`/h/${workspace}/room/mamemi`}>Room — mamemi</a></li>
    <li><a href={`/h/${workspace}/gig/igualada-2026-04-12`}>Gig — igualada-2026-04-12</a></li>
    <li><a href={`/h/${workspace}/engagement/marche-teatro`}>Engagement — marche-teatro</a></li>
    <li><a href={`/h/${workspace}/person/nuria-pages`}>Person — nuria-pages</a></li>
  </ul>
</section>

<style>
  @layer components {
    .house {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
    }
    .house__links {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
  }
</style>
