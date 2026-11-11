<script lang="ts">
  /**
   * The frame of one module of a line's page (tarea 135, ADR-145 § 1): its
   * head with the module's action at the end of the line, or, with nothing
   * inside, ONE line in its place: the module's name, «Nada todavía.» and
   * the same action closing it. One empty for every module where something
   * is written; a module that is only a reading does not mount this when
   * empty, so it is not drawn at all (the page hides its empty section).
   *
   * `action` takes the class its place wants (`block-head__act` in the head,
   * `empty-line__act` in the line), so the module writes its button once.
   */
  import type { Snippet } from 'svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import { appLocale, t } from '$lib/i18n';

  interface Props {
    title: string;
    /** Nothing inside (and the read has answered): one line. */
    empty?: boolean;
    action?: Snippet<[string]>;
    children?: Snippet;
  }

  let { title, empty = false, action, children }: Props = $props();
  const locale = appLocale();
</script>

{#if empty}
  <EmptyLine label={title} text={t('line.module_empty', locale)}>
    {#if action}{@render action('empty-line__act')}{/if}
  </EmptyLine>
{:else}
  <BlockHead {title}>
    {#if action}{@render action('block-head__act')}{/if}
  </BlockHead>
  {@render children?.()}
{/if}
