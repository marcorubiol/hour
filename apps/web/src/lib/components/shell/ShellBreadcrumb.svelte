<script lang="ts">
  import { useBreadcrumb } from '$lib/stores/breadcrumb.svelte';

  // The provider lives in the /h layout (which renders this component), so
  // entity pages downstream have already had a place to write their crumbs.
  const breadcrumb = useBreadcrumb();
</script>

{#if breadcrumb.crumbs.length > 0}
  <div class="shell__address">
    <div class="shell__address-inner">
      <nav class="shell__crumbs" aria-label="Breadcrumb">
        {#each breadcrumb.crumbs as c, i (i)}
          {#if i > 0}<span class="shell__crumb-sep" aria-hidden="true">›</span>{/if}
          {#if c.href}
            <a
              class="shell__crumb"
              class:shell__crumb--space={c.kind === 'space'}
              href={c.href}
              style={c.accent ? `--c: ${c.accent}` : undefined}
            >
              {#if c.kind === 'space'}<span class="shell__crumb-dot" aria-hidden="true"></span>{/if}{c.label}
            </a>
          {:else}
            <span class="shell__crumb shell__crumb--here">{c.label}</span>
          {/if}
        {/each}
      </nav>
    </div>
  </div>
{/if}

<style>
  /* ── address bar (breadcrumb) ─────────────────────────────────────
     Entity pages fill it via the breadcrumb store; sticks right below
     the top bar so "where am I" is always on screen. The inner column
     centers at the wide page width with the same gutter as the content,
     so the crumbs land on the same left edge as the page masthead (the
     --space-l gutters cancel out — see breadcrumb store). */
  .shell__address {
    position: sticky;
    inset-block-start: var(--header-height);
    z-index: calc(var(--z-sticky) - 1);
    background: color-mix(in oklch, var(--bg-light) 92%, transparent);
    backdrop-filter: blur(8px);
    border-block-end: 1px solid var(--border-color-light);
  }
  .shell__address-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-m);
    max-inline-size: calc(var(--page-width) + var(--space-l) * 2);
    margin-inline: auto;
    padding-block: var(--space-xs);
    padding-inline: var(--space-l);
    min-block-size: 2.75rem;
  }
  .shell__crumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-s);
    min-inline-size: 0;
  }
  .shell__crumb {
    font-size: var(--text-s);
    color: var(--text-muted);
    text-decoration: none;
    transition: color var(--transition);
  }
  .shell__crumb:hover {
    color: var(--text-color);
  }
  .shell__crumb--space {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
  }
  .shell__crumb-dot {
    inline-size: 0.5rem;
    block-size: 0.5rem;
    flex: none;
    border-radius: var(--radius-circle);
    background: var(--c, var(--text-faint));
  }
  .shell__crumb--here {
    font-weight: 600;
    color: var(--heading-color);
  }
  .shell__crumb-sep {
    color: var(--border-color-dark);
  }
</style>
