<script lang="ts">
  import type { Snippet } from 'svelte';

  type Position = 'top' | 'right' | 'bottom' | 'left';

  interface Props {
    text: string;
    position?: Position;
    delay?: number;
    children?: Snippet;
  }

  let { text, position = 'top', delay = 300, children }: Props = $props();

  let visible = $state(false);
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let tooltipId = $derived(`tooltip-${Math.random().toString(36).slice(2, 8)}`);

  function show() {
    if (showTimer) clearTimeout(showTimer);
    if (delay > 0) {
      showTimer = setTimeout(() => (visible = true), delay);
    } else {
      visible = true;
    }
  }

  function hide() {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    visible = false;
  }

  $effect(() => () => {
    if (showTimer) clearTimeout(showTimer);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
  class="tooltip-wrapper"
  aria-describedby={visible ? tooltipId : undefined}
  onmouseenter={show}
  onmouseleave={hide}
  onfocusin={show}
  onfocusout={hide}
>
  {@render children?.()}
  <span
    id={tooltipId}
    role="tooltip"
    class={`tooltip tooltip--${position}`}
    data-visible={visible || undefined}
  >
    {text}
  </span>
</span>
