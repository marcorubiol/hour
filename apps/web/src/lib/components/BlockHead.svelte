<script lang="ts">
  /**
   * The head of a dashboard block, one for the four dashboards (Desk,
   * Planner, Conversations, Cuentas): the sub-eyebrow over a hairline, its
   * figure after the title («Te toca · 3») and its action at the end of the
   * line. The italic serif stays for each screen's own title (ADR-130 § 1).
   * The figure is part of the heading, so a screen reader hears it with the
   * name; `alert` paints it in danger (something waits for a decision).
   */
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    /** The figure (or a short fact) after the title; a dash while loading. */
    count?: string | number | null;
    alert?: boolean;
    id?: string;
    /** Names a region by its words alone, without the figure (Desk's bands). */
    titleId?: string;
    /** The heading takes focus from a script (after a filter, a band that folds). */
    focusable?: boolean;
    el?: HTMLElement | null | undefined;
    /** The action at the end: a `.block-head__act` link or button. */
    children?: Snippet;
  }

  let { title, count = null, alert = false, id, titleId, focusable = false, el = $bindable(), children }: Props = $props();
</script>

{#snippet words()}
  {#if titleId}<span id={titleId}>{title}</span>{:else}{title}{/if}{#if count !== null && count !== ''}&nbsp;·
    <span class="block-head__n" class:block-head__n--alert={alert}>{count}</span>{/if}
{/snippet}

<div class="block-head">
  {#if focusable}
    <h2 class="eyebrow eyebrow--sub" {id} tabindex="-1" bind:this={el}>{@render words()}</h2>
  {:else}
    <h2 class="eyebrow eyebrow--sub" {id} bind:this={el}>{@render words()}</h2>
  {/if}
  {#if children}{@render children()}{/if}
</div>
