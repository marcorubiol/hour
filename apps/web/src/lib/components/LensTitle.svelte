<script lang="ts">
  /**
   * LensTitle — the lens-title typographic rule: letters italic, numbers
   * upright. The parent `.lenshead__title` is italic by default, so we only
   * lift the italic off digit runs (wrapped in `.lenshead__num`). Applies to
   * every lens title so the rule is one implementation, not four.
   *
   *   "28 need you" → 28 (upright) · "need you" (italic)
   *   "Julio 2026"  → "Julio" (italic) · 2026 (upright)
   */
  interface Props {
    text: string;
  }
  let { text }: Props = $props();

  // Split into alternating non-number / number runs. A number run is a digit
  // followed by any digits/decimal separators (keeps "1.250", "2026" whole).
  let parts = $derived(text.split(/(\d[\d.,]*)/).filter((s) => s !== ''));
  const isNum = (s: string) => /^\d/.test(s);
</script>

{#each parts as part, i (i)}{#if isNum(part)}<span class="lenshead__num">{part}</span>{:else}{part}{/if}{/each}
