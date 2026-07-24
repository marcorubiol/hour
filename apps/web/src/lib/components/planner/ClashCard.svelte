<script lang="ts">
  /**
   * Clash-card popover — names the shared people + the two bookings behind
   * one conflict day-mark. Extracted from MonthGrid verbatim: it renders
   * inside the day cell (position:absolute against it) and keeps the
   * `cal__clashcard` classes the grid's outside-click handler closes on.
   * The `.cal__mark--static` glyph inside is styled by MonthGrid's shared
   * :global mark rules — one grammar for the day-head marks and this head.
   */
  import type { ClashVM } from '$lib/month-events';

  interface Props {
    c: ClashVM;
    /** Bottom rows open upward — the grid's overflow would clip a downward card. */
    up: boolean;
    /** Weekend columns anchor to the cell's right edge. */
    flip: boolean;
  }

  let { c, up, flip }: Props = $props();
</script>

<div
  class="cal__clashcard"
  class:cal__clashcard--up={up}
  class:cal__clashcard--flip={flip}
  role="dialog"
  aria-label={c.title}
>
  <p class="cal__clashcard-head">
    <span class="cal__mark cal__mark--static" data-severity={c.severity}
      >{c.glyph}</span
    >
    {c.title}
  </p>
  <p class="cal__clashcard-body">{c.body}</p>
  {#each c.rows as row, ri (ri)}
    <p class="cal__clashcard-row">
      <span
        class="cal__clashcard-dot"
        style={row.accent ? `--c: ${row.accent}` : undefined}
        aria-hidden="true"
      ></span>
      <span class="cal__clashcard-label">{row.label}</span>
      <span class="cal__clashcard-status">{row.status}</span>
    </p>
  {/each}
</div>

<style>
  @layer components {
    /* Clash card — the popover naming shared people + the two bookings. */
    .cal__clashcard {
      position: absolute;
      z-index: var(--z-dropdown);
      top: 2rem;
      inset-inline-start: var(--space-xs);
      inline-size: 15.5rem;
      max-inline-size: 60vw;
      background: var(--bg-ultra-light);
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-l);
      box-shadow: var(--box-shadow-3);
      padding: var(--space-s) var(--space-m);
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      white-space: normal;
    }
    .cal__clashcard--up {
      top: auto;
      bottom: 2rem;
    }
    /* Weekend columns anchor to the cell's right edge — a leftward card
       would run past the grid boundary and get clipped. */
    .cal__clashcard--flip {
      inset-inline-start: auto;
      inset-inline-end: var(--space-xs);
    }
    .cal__clashcard-head {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      font-size: var(--text-s);
      font-weight: 600;
      color: var(--text-color);
    }
    .cal__clashcard-body {
      font-size: var(--text-s);
      color: var(--text-muted);
      line-height: 1.45;
    }
    .cal__clashcard-row {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .cal__clashcard-dot {
      inline-size: 7px;
      block-size: 7px;
      border-radius: var(--radius-circle);
      background: var(--c, var(--text-faint));
      flex: none;
    }
    .cal__clashcard-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cal__clashcard-status {
      margin-inline-start: auto;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
      flex: none;
    }
  }
</style>
