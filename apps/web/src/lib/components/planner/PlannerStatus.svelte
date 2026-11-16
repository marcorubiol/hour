<script lang="ts">
  /**
   * THE STATUS LINE (ADR-209) · one line under the title: what to decide,
   * what clashes, and the count of what the drawing shows. It inherits the
   * two blocks of «Próximas semanas» that asked for something («Por decidir»
   * and «Choques»), folded into words that open what they name: the decide
   * word opens the page's DecisionBand (its one writer), the clash word the
   * list of clashes right here, each row a door to its day.
   *
   * The same line in the three drawings, above their bar. The count is the
   * drawing's own (`children`): each view says what it counts.
   */
  import type { Snippet } from 'svelte';
  import { t, type Locale } from '$lib/i18n';

  interface Props {
    locale: Locale;
    /** Null: nothing to decide, or the queue's feed is absent. */
    decide: { n: number; urgent: number } | null;
    decisionsOpen: boolean;
    onDecide: () => void;
    clashes: Array<{ key: string; day: string; when: string; body: string }>;
    clashesOpen: boolean;
    onClashes: () => void;
    onClashDay: (iso: string) => void;
    children?: Snippet;
  }

  let { locale, decide, decisionsOpen, onDecide, clashes, clashesOpen, onClashes, onClashDay, children }: Props =
    $props();
</script>

<div class="pstat" data-help-step="planner-status">
  <p class="pstat__line">
    {#if decide}
      <button
        type="button"
        class="cal__stat pstat__ask"
        aria-expanded={decisionsOpen}
        aria-controls="cal-decisions"
        onclick={onDecide}
        >{t('planner.stat_decide', locale, { n: decide.n })}{#if decide.urgent > 0}{' · '}{decide.urgent === 1
            ? t('planner.stat_urgent_one', locale)
            : t('planner.stat_urgent', locale, { m: decide.urgent })}{/if}</button
      >
    {/if}
    {#if clashes.length > 0}
      <button
        type="button"
        class="cal__stat pstat__ask"
        aria-expanded={clashesOpen}
        aria-controls="cal-clashes"
        onclick={onClashes}
        >{clashes.length}
        {t(clashes.length === 1 ? 'planner.season_clash_one' : 'planner.season_clashes', locale)}</button
      >
    {/if}
    {@render children?.()}
  </p>
  {#if clashesOpen && clashes.length > 0}
    <div class="pstat__list" id="cal-clashes">
      {#each clashes as c (c.key)}
        <button type="button" class="pstat__row" onclick={() => onClashDay(c.day)}>
          <span class="pstat__when">{c.when}</span>
          <span class="pstat__what">{c.body}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  @layer components {
    .pstat {
      display: grid;
      gap: var(--space-xs);
    }
    /* The window line's caption voice (the page's `.cal__meta`): mono, caps,
       the margin size, faint. The figures keep one step of ink. */
    .pstat__line {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-2xs) var(--space-s);
      min-block-size: 1lh;
      margin: 0;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--tracking-l);
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .pstat__line :global(.cal__stat) {
      white-space: nowrap;
    }
    .pstat__line :global(.cal__stat--soft) {
      white-space: normal;
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }
    .pstat__line :global(.cal__stat + .cal__stat)::before {
      content: '·';
      margin-inline-end: var(--space-s);
      color: var(--border-color-dark);
    }
    .pstat__line :global(.cal__stat b) {
      font-family: var(--font-mono);
      font-weight: 400;
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
      margin-inline-end: var(--space-2xs);
    }
    /* The two that ask for something: red is conflict and a call to make,
       underlined because they open what they name. */
    .pstat__ask {
      font: inherit;
      letter-spacing: inherit;
      text-transform: inherit;
      color: var(--danger);
      background: none;
      border: 0;
      border-block-end: var(--line-hairline) solid color-mix(in oklch, var(--danger) 40%, transparent);
      padding: 0;
      cursor: pointer;
    }
    .pstat__ask:hover {
      color: var(--danger-dark);
      border-color: var(--danger);
    }
    .pstat__list {
      display: grid;
    }
    .pstat__row {
      display: grid;
      grid-template-columns: 6.8rem minmax(0, 1fr);
      gap: var(--space-s);
      padding-block: var(--space-xs);
      font: inherit;
      color: inherit;
      text-align: start;
      background: none;
      border: 0;
      border-block-end: var(--line-hairline) solid var(--border-color-light);
      cursor: pointer;
    }
    .pstat__row:hover .pstat__what {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .pstat__when {
      white-space: nowrap;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .pstat__what {
      font-size: var(--text-s);
      min-inline-size: 0;
    }
  }
</style>
