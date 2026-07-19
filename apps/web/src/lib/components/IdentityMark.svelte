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
  }

  let { accent, initials, name, variant = 'compact', size }: Props = $props();

  let text = $derived(variant === 'bare' ? '' : markText({ initials, name }));
  let label = $derived(name ?? text ?? 'project');
</script>

<span
  class="mark mark--{variant}"
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
