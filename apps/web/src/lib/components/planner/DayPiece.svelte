<script lang="ts">
  /**
   * The Day's piece (ADR-233, fase 4 de ADR-223; lámina C de la revisión
   * TDAH, «Día, propuesta»): each performance and each date the day holds,
   * drawn the way Hoy draws its piece, dark and short: the project's
   * monogram and what it is (with its «?» when it is an option), the name
   * and its hour (or «sin hora»), the line under it, its stops in reading,
   * and two doors to its pase: «Poner hora» when it has none, and «Abrir».
   * The Day shows; the pase writes. 380 px and no wider, like the piece in
   * Hoy and the pase (`--pass-width`).
   */
  import type { Snippet } from 'svelte';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import type { ProjectLite } from '$lib/month-events';
  import { accentVarFor } from '$lib/utils/accent';

  interface Props {
    href: string | null;
    project?: ProjectLite | null;
    eyebrow: string;
    what: string;
    /** The hour as the house writes it, or null: it says «sin hora». */
    at: string | null;
    noHourWord: string;
    sub?: string;
    /** An option leans (design-system rule 18): its «?» and its line. */
    guess?: boolean;
    setHourLabel: string;
    openLabel: string;
    children?: Snippet;
  }
  let { href, project = null, eyebrow, what, at, noHourWord, sub = '', guess = false, setHourLabel, openLabel, children }: Props = $props();
</script>

<section class="dpiece" data-testid="day-piece">
  <span class="dpiece__eye"
    >{#if project}<span class="dpiece__mark"
        ><IdentityMark mini accent={accentVarFor(project)} name={project.name} initials={project.initials} /></span
      >{/if}{eyebrow}</span
  >
  <div class="dpiece__lead">
    <span class="dpiece__what" class:guess>{what}</span>
    <span class="dpiece__at" class:dpiece__at--none={at === null}>{at ?? noHourWord}</span>
  </div>
  {#if sub}<span class="dpiece__sub" class:guess>{sub}</span>{/if}
  {#if children}<div class="dpiece__stops">{@render children()}</div>{/if}
  {#if href}
    <nav class="dpiece__acts">
      {#if at === null}<a class="dpiece__act" {href}>{setHourLabel}</a>{/if}
      <a class="dpiece__act" {href}>{openLabel}</a>
    </nav>
  {/if}
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
      --identity-tint-base: var(--surface-focus);
      --identity-tint: var(--surface-focus-mark-tint);
      --identity-ink-l: var(--surface-focus-mark-ink-l);
    }
    .dpiece__eye {
      display: flex;
      align-items: center;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--surface-focus-muted);
    }
    .dpiece__mark {
      display: inline-flex;
      flex: none;
      margin-inline-end: var(--space-xs);
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
    .dpiece__at--none {
      font-size: var(--text-m);
      color: var(--surface-focus-muted);
    }
    .dpiece__sub {
      font-size: var(--text-m);
      color: var(--surface-focus-muted);
    }
    /* At the thumb (design-system rule 13): one row, equal parts. */
    .dpiece__acts {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(0, 1fr);
      gap: var(--space-s);
    }
    .dpiece__act {
      display: flex;
      align-items: center;
      justify-content: center;
      min-block-size: var(--touch-target);
      padding-block: var(--space-xs);
      border-radius: var(--radius);
      background: var(--surface-focus-act);
      color: inherit;
      font-size: var(--text-m);
      font-weight: 500;
      text-decoration: none;
      white-space: nowrap;
    }
    .dpiece__act:hover {
      background: var(--surface-focus-act-hover);
    }
  }
</style>
