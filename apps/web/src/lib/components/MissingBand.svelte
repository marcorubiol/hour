<script lang="ts" module>
  /** One way to settle a missing thing: a word that acts, or that goes. */
  export interface MissingVerb {
    label: string;
    onclick?: () => void;
    href?: string;
    disabled?: boolean;
    /** The verb's full name when the word alone is short («hecho» → «Hotel: hecho»). */
    ariaLabel?: string;
  }

  export interface MissingItem {
    id: string;
    text: string;
    /** A quiet fact after the text: a day, since when. */
    meta?: string;
    verbs: MissingVerb[];
  }
</script>

<script lang="ts">
  /**
   * The «Falta» strip of a record (ADR-139 § 2, p2 A): 0 to 3 things the
   * record still needs, each with the verb that settles it, under the facts
   * line (RecordHead's `band`). What is missing is derived elsewhere
   * (`$lib/record-missing`); this only draws it. With no item it draws
   * nothing, not an «all done»: the absence of the strip is the answer.
   *
   *   FALTA      Preparación sin marcar: hotel   hecho
   *              Nadie confirmado para ir   apuntar
   */
  import { t, type Locale } from '$lib/i18n';

  interface Props {
    items: MissingItem[];
    locale: Locale;
  }

  let { items, locale }: Props = $props();
</script>

{#if items.length > 0}
  <section class="missing" aria-labelledby="missing-title" data-testid="record-missing">
    <h2 class="eyebrow eyebrow--sub missing__label" id="missing-title">{t('record.missing', locale)}</h2>
    <ul class="missing__list" role="list">
      {#each items as item (item.id)}
        <li class="missing__row" data-missing={item.id}>
          <span class="missing__text"
            >{item.text}{#if item.meta}<span class="missing__meta">{item.meta}</span>{/if}</span
          >
          {#if item.verbs.length > 0}
            <span class="missing__verbs">
              {#each item.verbs as v, i (i)}
                {#if v.href}
                  <a class="missing__act" href={v.href} aria-label={v.ariaLabel}>{v.label}</a>
                {:else}
                  <button
                    type="button"
                    class="missing__act"
                    disabled={v.disabled}
                    aria-label={v.ariaLabel}
                    onclick={v.onclick}>{v.label}</button
                  >
                {/if}
              {/each}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  @layer components {
    /* The label sits in the record's label column, the things after it: the
       same row as a labelled EmptyLine, so the strip and an empty block
       share one left edge. */
    .missing {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-2xs) var(--space-s);
    }
    .missing__label {
      flex: none;
      min-inline-size: var(--record-label-inline);
      margin: 0;
    }
    .missing__list {
      display: flex;
      flex: 1 1 var(--record-missing-inline);
      flex-direction: column;
      gap: var(--space-2xs);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .missing__row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-2xs) var(--space-m);
      font-size: var(--text-s);
      color: var(--text-color);
    }
    .missing__meta {
      margin-inline-start: var(--space-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-faint);
    }
    .missing__verbs {
      display: inline-flex;
      flex-wrap: wrap;
      gap: var(--space-2xs) var(--space-m);
    }
  }
</style>
