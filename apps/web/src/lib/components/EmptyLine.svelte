<script lang="ts">
  /**
   * EmptyLine: what a block says when it has nothing, or while its read is
   * on the way (ADR-139 § 2 and § 4). One line, in the block's voice, at the
   * block's left edge: never centred, never a box, never taller than a row.
   * The one home of the ~39 `__empty` / `__state` / `__msg` classes each block
   * drew on its own.
   *
   * With `label`, the line stands for a whole empty block: the block's name
   * in the mono column, the sentence after it, so an empty block takes one
   * line instead of a head plus a sentence. The action, when there is one,
   * closes the line («escribir →»).
   */
  import type { Snippet } from 'svelte';

  interface Props {
    text: string;
    /** The block's name, when the line replaces the whole block. */
    label?: string;
    /** Still on the way: the line is the block's loading state. */
    busy?: boolean;
    /** The way out of the empty: a `.empty-line__act` link or button. */
    children?: Snippet;
  }

  let { text, label, busy = false, children }: Props = $props();
</script>

<p class="empty-line" class:empty-line--labelled={Boolean(label)} aria-busy={busy || undefined}>
  {#if label}<span class="eyebrow eyebrow--sub empty-line__label">{label}</span>{/if}<span class="empty-line__text">{text}</span>{#if children}{@render children()}{/if}
</p>
