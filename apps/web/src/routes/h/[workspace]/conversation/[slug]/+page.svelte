<script lang="ts">
  import { page } from '$app/state';

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
  <title>{title} — Conversation — Hour</title>
</svelte:head>

<section class="entity">
  <header>
    <p class="eyebrow">Conversation</p>
    <h1 class="entity__title"><em>{title}</em></h1>
  </header>
  <p class="text--dark-muted">
    The full conversation view — status timeline, notes, linked person and
    performances — isn't built yet. Manage this conversation from Conversations meanwhile.
  </p>
  <p>
    <a class="link-arrow" href="/h/conversations">← Back to conversations</a>
  </p>
</section>

<style>
  @layer components {
    .entity {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
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
