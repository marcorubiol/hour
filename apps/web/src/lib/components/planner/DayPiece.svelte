<script lang="ts">
  /**
   * The Day's short piece (ADR-230, fase 4 de ADR-223): each performance and
   * each date the day holds, drawn the way Hoy draws its piece, short: what
   * it is, its hour, where, and under it its stops in reading. The Day
   * shows; the pase writes. Touching the piece opens its pase (the vistazo).
   * 380 px and no wider, like the piece in Hoy and the pase.
   */
  import type { Snippet } from 'svelte';

  interface Props {
    href: string | null;
    what: string;
    at: string;
    sub: string;
    guess?: boolean;
    children?: Snippet;
  }
  let { href, what, at, sub, guess = false, children }: Props = $props();
</script>

<section class="dpiece" data-testid="day-piece">
  <svelte:element this={href ? 'a' : 'div'} {href} class="dpiece__head">
    <span class="dpiece__lead">
      <span class="dpiece__what" class:guess>{what}</span>
      <span class="dpiece__at">{at}</span>
    </span>
    {#if sub}<span class="dpiece__sub" class:guess>{sub}</span>{/if}
  </svelte:element>
  {#if children}<div class="dpiece__stops">{@render children()}</div>{/if}
</section>

<style>
  @layer components {
    .dpiece {
      display: grid;
      gap: var(--space-s);
      inline-size: 100%;
      max-inline-size: var(--pass-width);
      padding: var(--space-m);
      border-radius: var(--radius-xl);
      background: var(--surface-focus);
      color: var(--surface-focus-ink);
    }
    .dpiece__head {
      display: grid;
      gap: var(--space-2xs);
      color: inherit;
      text-decoration: none;
    }
    a.dpiece__head:hover .dpiece__what,
    a.dpiece__head:focus-visible .dpiece__what {
      text-decoration: underline;
      text-underline-offset: 4px;
    }
    .dpiece__lead {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: baseline;
      gap: var(--space-s);
      font-family: var(--font-display);
      font-size: var(--display-piece);
      line-height: 1.02;
    }
    .dpiece__what {
      text-wrap: balance;
    }
    .dpiece__at {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .dpiece__sub {
      font-size: var(--text-m);
      color: var(--surface-focus-muted);
    }
  }
</style>
