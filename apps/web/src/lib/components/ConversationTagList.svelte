<script lang="ts">
  /**
   * Las etiquetas de una conversación (ADR-138 § 1), en el orden del
   * vocabulario y con su nombre: la fila de la lista y la ficha. Solo lectura;
   * el tratamiento es el de `TagChip`.
   */

  import TagChip from '$lib/components/TagChip.svelte';
  import { keyLabel, type WorkspaceTag } from '$lib/conversation-tags';
  import type { Locale } from '$lib/i18n';

  interface Props {
    /** Las claves que lleva. */
    tags: readonly string[];
    /** El vocabulario que la nombra y la ordena. */
    known: readonly WorkspaceTag[];
    /** Una clave que no se repite (la del chip activo: ya lo dice la fila de chips). */
    hide?: string;
    locale: Locale;
  }

  let { tags, known, hide, locale }: Props = $props();

  let shown = $derived(
    tags
      .filter((k) => k !== hide)
      .map((k) => ({ key: k, order: known.findIndex((x) => x.key === k) }))
      .sort((a, b) => (a.order === -1 ? Infinity : a.order) - (b.order === -1 ? Infinity : b.order) || a.key.localeCompare(b.key)),
  );
</script>

{#if shown.length > 0}
  <span class="conv-tags">
    {#each shown as tag (tag.key)}<TagChip label={keyLabel(tag.key, known, locale)} />{/each}
  </span>
{/if}

<style>
  @layer components {
    .conv-tags {
      display: inline-flex;
      flex-wrap: wrap;
      gap: var(--space-2xs);
    }
  }
</style>
