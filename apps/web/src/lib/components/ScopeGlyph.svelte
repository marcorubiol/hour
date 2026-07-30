<script lang="ts">
  /**
   * ScopeGlyph — the one glyph that says "space / project / line / person"
   * everywhere it matters (⌘K results, ⌘K building bar, scope-bar pills): a
   * hollow circle for a space, a hollow rhombus for a project, the line's
   * kind icon on a tinted tile for a line, a solid dot for a person.
   *
   * The person is the odd one out twice over, and both are deliberate:
   *
   * · It is not a container — the other three are levels of one ladder, a
   *   person cuts across them — so it takes the one primitive the set had
   *   left instead of a variation on theirs.
   * · It **ignores `accent`**. Hue is project identity and nothing else, so
   *   tinting a person would either invent a colour for them or borrow one
   *   from whichever project they happened to be reached through. It draws
   *   in ink.
   *
   * Placeholder, honestly labelled: the app's real identity token for a human
   * is the monogram (`IdentityMark`), and this dot should become one the day a
   * call site can hand over a name — the ⌘K palette and the scope pills both
   * resolve labels already, the glyph just is not given them yet.
   *
   * Optics are parametric: the caller sets the base size via `--glyph`
   * (default 15px — smaller in pills); the per-shape scales (%) live HERE so
   * the circle / rhombus / tile stay optically balanced in one tuning place.
   */
  import { lineKindGlyph } from '$lib/utils/line-kind';

  interface Props {
    kind: 'space' | 'project' | 'line' | 'person';
    /** accent as a CSS value (var(--accent-N) or a literal). Unused by `person`. */
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
  {:else if kind === 'person'}
    <span class="sg__dot"></span>
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
    /* a solid dot carries more weight than a ring of the same width, so it
       sits below the circle's scale to read as the same size */
    --glyph-person: 0.5; /* dot = 7.5px @ 15 base */
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
  /* Ink, never a hue: see the note in the header. */
  .sg__dot {
    inline-size: calc(var(--_g) * var(--glyph-person));
    block-size: calc(var(--_g) * var(--glyph-person));
    border-radius: var(--radius-circle);
    background: var(--text-muted);
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
