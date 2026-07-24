<script lang="ts">
  /**
   * Legend — the month's colour key, readable without opening anything.
   * Extracted from MonthGrid verbatim. The project entries ARE the view's
   * filter: the muted-project state stays in MonthGrid (it drives the
   * grid's own chip filtering); this component only reads `hidden` and
   * reports clicks through `onToggle`.
   */
  import { accentVarFor } from '$lib/utils/accent';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import type { ProjectLite } from '$lib/month-events';

  interface Props {
    /** Projects that actually paint a chip in a rendered cell. */
    projects: ProjectLite[];
    /** View-local muted project ids — owned by MonthGrid, shared with the grid. */
    hidden: string[];
    onToggle: (id: string) => void;
    /** Legend key words (the confirmed/hold swatches). */
    confirmedLabel: string;
    holdLabel: string;
  }

  let { projects, hidden, onToggle, confirmedLabel, holdLabel }: Props = $props();
</script>

<div class="cal__legend">
  {#each projects as pr (pr.id)}
    {@const shown = !hidden.includes(pr.id)}
    <button
      type="button"
      class="cal__legend-item"
      class:cal__legend-item--muted={!shown}
      aria-pressed={shown}
      onclick={() => onToggle(pr.id)}
      ><IdentityMark
        accent={accentVarFor(pr)}
        name={pr.name}
        initials={pr.initials}
      />{pr.name}</button
    >
  {/each}
  <span class="cal__legend-sep" aria-hidden="true"></span>
  <span class="cal__legend-key"
    ><span class="cal__legend-swatch" data-family="confirmed" aria-hidden="true"
    ></span>{confirmedLabel}</span
  >
  <span class="cal__legend-key"
    ><span class="cal__legend-swatch" data-family="hold" aria-hidden="true"
    ></span>{holdLabel}</span
  >
</div>

<style>
  @layer components {
    /* Legend — the month's colour key, readable without opening anything.
       The swatches restate the two shapes the chips use (solid = settled,
       hatched+dashed = held), in neutral ink so they read as a key and not
       as one more project. */
    .cal__legend {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-xs) var(--space-s);
      margin-block-end: var(--space-s);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .cal__legend-item,
    .cal__legend-key {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2xs);
    }
    /* The project entries ARE the view's filter — click one to mute it. */
    .cal__legend-item {
      appearance: none;
      border: 0;
      padding: 0;
      background: none;
      font: inherit;
      color: inherit;
      cursor: pointer;
      border-radius: var(--radius-s);
      transition: opacity var(--transition);
    }
    .cal__legend-item:hover {
      color: var(--text-color);
    }
    .cal__legend-item--muted {
      opacity: 0.4;
      text-decoration: line-through;
    }
    .cal__legend-item:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 2px;
    }
    .cal__legend-sep {
      inline-size: 1px;
      block-size: 1em;
      background: var(--border-color-dark);
    }
    /* The key restates the chips' own grammar — square until settled — so it
       stays true rather than decorative. */
    .cal__legend-swatch {
      inline-size: 0.85em;
      block-size: 0.85em;
      border-radius: var(--radius-none);
      border: 1px solid var(--border-color-dark);
    }
    .cal__legend-swatch[data-family='confirmed'] {
      border-radius: var(--radius-s);
      border-color: transparent;
      background: color-mix(in oklch, var(--text-color) 22%, var(--bg-ultra-light));
    }
    .cal__legend-swatch[data-family='hold'] {
      border-style: dashed;
      background-image: repeating-linear-gradient(
        135deg,
        color-mix(in oklch, var(--text-color) 16%, var(--bg-ultra-light)) 0 4px,
        var(--bg-ultra-light) 4px 8px
      );
    }
  }
</style>
