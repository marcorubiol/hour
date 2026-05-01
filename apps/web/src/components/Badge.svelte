<script lang="ts">
  import type { Snippet } from 'svelte';

  type Tone =
    | 'neutral'
    | 'primary'
    | 'info'
    | 'success'
    | 'warning'
    | 'danger';
  type Size = 'xs' | 's' | 'm';

  interface Props {
    tone?: Tone;
    size?: Size;
    children?: Snippet;
    lead?: Snippet;
    tail?: Snippet;
  }

  let {
    tone = 'neutral',
    size = 's',
    children,
    lead,
    tail,
  }: Props = $props();

  let classes = $derived(`badge--${tone} badge--${size}`);
</script>

<span class={classes}>
  {#if lead}<span class="badge__lead">{@render lead()}</span>{/if}
  {#if children}{@render children()}{/if}
  {#if tail}<span class="badge__tail">{@render tail()}</span>{/if}
</span>
