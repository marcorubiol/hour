<script lang="ts">
  import type { Snippet } from 'svelte';

  type Variant = 'primary' | 'outline';
  type Size = 'xs' | 's' | 'm' | 'l';

  interface Props {
    variant?: Variant;
    size?: Size;
    href: string;
    target?: '_self' | '_blank' | '_parent' | '_top';
    rel?: string;
    download?: string | boolean;
    children?: Snippet;
    lead?: Snippet;
    tail?: Snippet;
  }

  let {
    variant = 'primary',
    size = 'm',
    href,
    target,
    rel,
    download,
    children,
    lead,
    tail,
  }: Props = $props();

  let computedRel = $derived(
    target === '_blank' && !rel ? 'noopener noreferrer' : rel
  );

  let downloadAttr = $derived(
    download === true ? '' : download === false ? undefined : download
  );

  let classes = $derived(`btn--${variant} btn--${size}`);
</script>

<a
  {href}
  {target}
  rel={computedRel}
  download={downloadAttr}
  class={classes}
>
  {#if lead}<span class="btn__lead">{@render lead()}</span>{/if}
  {#if children}{@render children()}{/if}
  {#if tail}<span class="btn__tail">{@render tail()}</span>{/if}
</a>
