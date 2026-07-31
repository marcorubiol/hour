<script lang="ts">
  /**
   * IdentityMark — the project identity monogram that replaces the color dot
   * everywhere it appears (calendar chips, lists, legends, detail headers).
   *
   * Presentational only: it renders the tinted monogram tile (and, in the
   * `full` variant, the name beside it). Interactivity — tap-to-edit — is
   * added by the surfaces that host an editor (the identity popover), never
   * baked in here, so the mark can sit inside a link (calendar event) without
   * nesting interactive elements.
   *
   * Variable contract (philosophy §3): the caller sets `--c` (the accent as a
   * CSS value — `var(--accent-N)` or a literal). The mark derives its own soft
   * background and *legible* foreground from it. The soft tint reuses the
   * ScopeGlyph tile recipe; the foreground is forced to a fixed lightness via
   * relative-color so 2–3 letters stay readable across all 12 hues — the one
   * thing the letter-less dot never had to solve.
   *
   * Three variants:
   *   - compact (default) — tint + monogram. Dense chips, list rows.
   *   - full               — tint + monogram + name. Legends, headers.
   *   - bare               — tint only, no letters. The anti-dot fallback for
   *                          contexts too tight for text (same silhouette, so
   *                          it never regresses to a foreign circle).
   */
  import { markText } from '$lib/utils/identity';

  interface Props {
    /** Accent as a CSS value: var(--accent-N) or a literal color. */
    accent: string;
    /** Stored monogram; when absent it derives from `name`. */
    initials?: string | null;
    /** Entity name — used for the `full` label, aria, and derived initials. */
    name?: string | null;
    variant?: 'compact' | 'full' | 'bare';
    /** Base tile size; overridable per context via the `--mark` var. */
    size?: string;
    /**
     * THE DENSE TREATMENT — 12px tall, a 3px corner, and NO RING.
     *
     * It is one named treatment and not three props because the three always
     * travel together, and the ring is the reason: at this size a 1px ring
     * takes 15% of the tile and closes on the letters until `MM` reads as a
     * smudge. The tint alone carries the identity at this size — which is the
     * whole job — and the ring comes back the moment the tile is big enough
     * to spend a pixel on definition.
     *
     * This is what every Planner drawing uses: the slip, the bands and the
     * board all sit inside a cell that gives a monogram about thirty pixels.
     */
    mini?: boolean;
  }

  let { accent, initials, name, variant = 'compact', size, mini = false }: Props = $props();

  let text = $derived(variant === 'bare' ? '' : markText({ initials, name }));
  let label = $derived(name ?? text ?? 'project');
</script>

<span
  class="mark mark--{variant}"
  class:mark--mini={mini}
  style={`--c: ${accent}${size ? `; --mark: ${size}` : ''}`}
>
  <span
    class="mark__chip"
    class:mark__chip--bare={variant === 'bare'}
    role="img"
    aria-label={label}
  >{text}</span>
  {#if variant === 'full' && name}
    <span class="mark__name">{name}</span>
  {/if}
</span>

<style>
  @layer components {
    .mark {
      /* base tile size — override per context by setting --mark */
      --_m: var(--mark, 18px);
      --_c: var(--c, var(--accent-1));

      /* Soft tint (ScopeGlyph tile recipe) + forced-legible fg (relative
         color: same hue, fixed lightness → contrast holds on all 12 hues). */
      --_bg: color-mix(in oklch, var(--_c) 16%, var(--bg-ultra-light));
      --_fg: oklch(from var(--_c) 0.42 c h);
      --_bd: color-mix(in oklch, var(--_c) 26%, transparent);

      display: inline-flex;
      align-items: center;
      gap: var(--space-2xs, 0.375rem);
      min-inline-size: 0;
    }

    .mark__chip {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      block-size: var(--_m);
      min-inline-size: var(--_m);
      padding-inline: calc(var(--_m) * 0.22);
      border-radius: calc(var(--_m) * 0.28);
      background: var(--_bg);
      color: var(--_fg);
      box-shadow: 0 0 0 1px var(--_bd) inset;
      font-size: calc(var(--_m) * 0.5);
      font-weight: 600;
      line-height: 1;
      letter-spacing: 0.01em;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    /* ── mini · the dense treatment (see the `mini` prop) ─────────────── */
    .mark--mini {
      /* 12, down from the prototype's 13: at 13 the chip was the tallest
         thing on a head line whose other two tokens are 9px, so the tile —
         the least specific field there — set the line's height. At 12 it sits
         flush and the tint still carries.
         THE FLOOR IS HERE. One step further (11/7.5) and a three-letter
         monogram like `MdA` stops being scannable, and this tile is the ONE
         token a whole board can be read by: the moment its letters go it is a
         coloured dot again, which is the thing IdentityMark was built to
         replace. */
      --_m: 12px;
    }
    .mark--mini .mark__chip {
      padding-inline: 3px;
      /* A flatter corner, not just a smaller one: 3 on 12 reads squarer than
         the proportional 3.4, and at this size a rounder tile loses the
         letters to its own curve. */
      border-radius: 3px;
      box-shadow: none;
      font-size: 8px;
      font-weight: 500;
      letter-spacing: 0.02em;
    }

    /* bare = same silhouette, no glyph. Keep it square (min = block). */
    .mark__chip--bare {
      padding-inline: 0;
      inline-size: var(--_m);
    }

    .mark__name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-color);
    }
  }

  /* Dark mode: flip the forced fg light and lift the tint off the dark bg. */
  :global(:root[data-mode='dark']) .mark {
    --_bg: color-mix(in oklch, var(--_c) 24%, var(--bg));
    --_fg: oklch(from var(--_c) 0.9 c h);
  }
</style>
