<script lang="ts">
  /**
   * ScopeGlyph — the one glyph that says "space / project / line" everywhere
   * it matters (⌘K results, ⌘K building bar, scope-bar pills): a hollow
   * circle for a space, a hollow rhombus for a project, the line's kind icon
   * on a tinted tile for a line.
   *
   * Optics are parametric: the caller sets the base size via `--glyph`
   * (default 15px — smaller in pills); the per-shape scales (%) live HERE so
   * the circle / rhombus / tile stay optically balanced in one tuning place.
   */
  import { lineKindGlyph } from '$lib/utils/line-kind';

  interface Props {
    kind: 'space' | 'project' | 'line';
    /** accent as a CSS value (var(--accent-N) or a literal). */
    accent: string;
    /** for lines: the raw kind (tour/season/…) driving the tile icon. */
    lineKind?: string;
  }
  let { kind, accent, lineKind = '' }: Props = $props();
</script>

<span class="sg">
  {#if kind === 'space'}
    <span class="sg__ring" style={`border-color: ${accent}`}></span>
  {:else if kind === 'project'}
    <span class="sg__diamond" style={`border-color: ${accent}`}></span>
  {:else}
    <span class="sg__tile" style={`--c: ${accent}`}>{lineKindGlyph(lineKind)}</span>
  {/if}
</span>

<style>
  .sg {
    /* base size — override per context by setting --glyph on a parent */
    --_g: var(--glyph, 15px);
    /* per-shape scales (Marco's optical-rectification knobs) */
    --glyph-space: 0.667; /* circle = 10px @ 15 base */
    --glyph-project: 0.633; /* rhombus = 9.5px @ 15 base */
    --glyph-line: 1; /* tile = 15px @ 15 base */
    --glyph-gap: 2px;

    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: calc(var(--_g) + var(--glyph-gap) * 2);
    block-size: calc(var(--_g) + var(--glyph-gap) * 2);
  }
  .sg__ring {
    inline-size: calc(var(--_g) * var(--glyph-space));
    block-size: calc(var(--_g) * var(--glyph-space));
    border: 1.5px solid var(--text-faint);
    border-radius: var(--radius-circle);
  }
  .sg__diamond {
    inline-size: calc(var(--_g) * var(--glyph-project));
    block-size: calc(var(--_g) * var(--glyph-project));
    border: 1.5px solid var(--text-faint);
    /* radius proportional to size — a fixed 3px turned the small pill
       rhombus into a circle */
    border-radius: calc(var(--_g) * 0.14);
    transform: rotate(45deg);
  }
  .sg__tile {
    inline-size: calc(var(--_g) * var(--glyph-line));
    block-size: calc(var(--_g) * var(--glyph-line));
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    background: color-mix(in oklch, var(--c) 15%, var(--bg-ultra-light));
    color: var(--c);
    font-size: calc(var(--_g) * 0.62);
    line-height: 1;
  }
</style>
