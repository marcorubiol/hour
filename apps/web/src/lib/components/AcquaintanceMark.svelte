<script lang="ts">
  /**
   * La marca de «lo conozco» en una fila (ADR-138 § 5): un punto junto al
   * nombre. Lleno si conoces a alguno de sus contactos; un aro si solo lo ha
   * compartido otra persona del equipo. Quién, en el tooltip. Nada si nadie.
   */
  import { knownTitle, type Known } from '$lib/acquaintance';
  import type { Locale } from '$lib/i18n';

  interface Props {
    known: Known;
    locale: Locale;
  }

  let { known, locale }: Props = $props();
  let title = $derived(knownTitle(known, locale));
</script>

{#if title}
  <span class="known-mark" class:known-mark--mine={known.mine} role="img" aria-label={title} {title}></span>
{/if}

<style>
  @layer components {
    .known-mark {
      --known-mark-size: 0.45em;

      display: inline-block;
      flex: none;
      inline-size: var(--known-mark-size);
      block-size: var(--known-mark-size);
      margin-inline-start: var(--space-2xs);
      vertical-align: 0.12em;
      border: var(--line-hairline) solid var(--text-muted);
      border-radius: 50%;
    }
    .known-mark--mine {
      background: var(--text-muted);
    }
  }
</style>
