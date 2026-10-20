<script lang="ts">
  /**
   * Fold: what a record keeps folded (ADR-139 § 2, «Detalles»; «Apuntar una
   * llamada»), under the one fold mechanism of the tool, the lid
   * (`styles/lid.css`). The lid's law holds: closed, it still says what it
   * keeps (`keeps`), so a folded block never hides that it has something.
   * No `<details>` triangle anywhere: the browser's fold is a second
   * mechanism with its own glyph and voice.
   */
  import type { Snippet } from 'svelte';

  interface Props {
    /** The fold's name, the lid's word. */
    word: string;
    /** What it keeps, said while closed («sala · 2 fechas»); empty says nothing. */
    keeps?: string;
    open?: boolean;
    id?: string;
    /** A test hook on the fold. */
    testid?: string;
    el?: HTMLElement | undefined;
    children: Snippet;
  }

  let {
    word,
    keeps = '',
    open = $bindable(false),
    id,
    testid,
    el = $bindable(),
    children,
  }: Props = $props();

  let bodyId = $derived(`${id ?? `fold-${Math.random().toString(36).slice(2, 8)}`}-body`);
</script>

<section class="fold" {id} data-testid={testid} bind:this={el}>
  <button type="button" class="lid" aria-expanded={open} aria-controls={bodyId} onclick={() => (open = !open)}>
    <span class="lid__w">{word}</span>
    <span class="lid__n">{keeps} {open ? '−' : '+'}</span>
  </button>
  {#if open}
    <div class="fold__body" id={bodyId}>{@render children()}</div>
  {/if}
</section>

<style>
  @layer components {
    .fold {
      display: flex;
      flex-direction: column;
    }
    .fold__body {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
      padding-block-start: var(--space-m);
    }
  }
</style>
