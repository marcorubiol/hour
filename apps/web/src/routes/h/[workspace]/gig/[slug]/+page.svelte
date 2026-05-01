<script lang="ts">
  import { page } from '$app/state';

  let workspace = $derived(page.params.workspace);
  let slug = $derived(page.params.slug);
</script>

<svelte:head>
  <title>{slug} — Gig — Hour</title>
</svelte:head>

<section class="entity">
  <header>
    <p class="text--s text--dark-muted">Gig</p>
    <h1 class="h2">{slug}</h1>
  </header>
  <p class="text--dark-muted">
    Gig detail placeholder — full mobile-first detail + roadsheet sub-route in Phase 0.2 (ADR-023).
  </p>
  <p>
    <a href={`/h/${workspace}/gig/${slug}/roadsheet`}>→ Open road sheet (placeholder)</a>
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
