<script lang="ts">
  import { page } from '$app/state';

  let workspace = $derived(page.params.workspace);
  let slug = $derived(page.params.slug ?? '');

  /* Stub-grade de-slug for the masthead ("ajuntament-de-balsareny" →
     "Ajuntament De Balsareny"). The real person/org name arrives with the
     full conversation view. */
  let title = $derived(
    slug
      .split('-')
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' '),
  );
</script>

<svelte:head>
  <title>{title} — Engagement — Hour</title>
</svelte:head>

<section class="entity">
  <header>
    <p class="eyebrow">Engagement</p>
    <h1 class="entity__title"><em>{title}</em></h1>
  </header>
  <p class="text--dark-muted">
    The full conversation view — status timeline, notes, linked person and
    gigs — isn't built yet. Manage this engagement from Contacts meanwhile.
  </p>
  <p>
    <a class="link-arrow" href={`/h/${workspace}/contacts`}>← Back to contacts</a>
  </p>
</section>

<style>
  @layer components {
    .entity {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
      max-inline-size: var(--page-width-reading);
      margin-inline: auto;
    }
    /* Masthead typography via base.css h1 defaults. */
    .entity__title {
      margin: 0;
    }
    .entity__title em {
      font-style: italic;
    }
  }
</style>
