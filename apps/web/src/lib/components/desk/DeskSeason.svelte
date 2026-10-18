<script lang="ts">
  /**
   * «LA TEMPORADA» — band 4 of the Desk (ADR-117): one door per lens, a big
   * figure and two small ones. A door is a door: it says what its lens says,
   * in the lens's own arithmetic (Planner: its twelve-week census; Conversations:
   * its overview; Cuentas: `moneyPosition`), and it opens the lens.
   *
   * Never empty — zero is a figure. While loading, a `·` holds the figure's
   * place. A door whose lens failed says so alone. Cuentas exists only with
   * `read:money`: without it, no trace.
   */
  import { t, type Locale } from '$lib/i18n';
  import type { PlannerDoor } from '$lib/desk-bands';

  type Door<T> = { value: T | null; errored: boolean };

  interface Props {
    planner: Door<PlannerDoor>;
    /** null: no read on conversations anywhere (ADR-124), the door does not exist. */
    conversations: Door<{ holds: number; live: number; due: number }> | null;
    /** null: no read:money, the door does not exist. */
    money: Door<{ owed: string; overdue: string; overdueCount: number }> | null;
    seasonLabel: string;
    locale: Locale;
  }

  let { planner, conversations, money, seasonLabel, locale }: Props = $props();
  const DOT = '·';
</script>

<section class="dband season" aria-labelledby="desk-season-h">
  <!-- No common window over the doors: each one says its own, in its lens's
       words (the Planner's twelve weeks, Conversations' season). -->
  <h2 class="dband__h" id="desk-season-h">{t('desk.band_season', locale)}</h2>

  <div class="doors">
    <a class="door" href="/h/planner" data-testid="door-planner">
      <span class="door__lens">{t('lens.planner', locale)}<i>{t('desk.door_planner_window', locale)}</i></span>
      {#if planner.errored}
        <span class="door__n door__n--na">{DOT}</span><span class="door__txt">{t('desk.door_error', locale)}</span>
      {:else}
        <span class="door__n">{planner.value ? planner.value.confirmed : DOT}</span>
        <span class="door__txt"
          >{t('desk.door_planner_n', locale)}<br />{planner.value
            ? t('desk.door_planner_sub', locale, {
                holds: planner.value.holds,
                travel: t(planner.value.travel === 1 ? 'desk.door_travel_one' : 'desk.door_travel_many', locale, {
                  n: planner.value.travel,
                }),
              })
            : DOT}</span
        >
      {/if}
      <span class="door__arrow" aria-hidden="true">→</span>
    </a>

    {#if conversations}
      <a class="door" href="/h/conversations" data-testid="door-conversations">
        <span class="door__lens">{t('lens.conversations', locale)}<i>{seasonLabel}</i></span>
        {#if conversations.errored}
          <span class="door__n door__n--na">{DOT}</span><span class="door__txt">{t('desk.door_error', locale)}</span>
        {:else}
          <span class="door__n">{conversations.value ? conversations.value.holds : DOT}</span>
          <span class="door__txt"
            >{t('desk.door_conv_n', locale)}<br />{#if conversations.value}{t('desk.door_conv_sub', locale, {
                live: conversations.value.live,
              })}{#if conversations.value.due > 0}{' · '}{t('desk.door_conv_due', locale, {
                  n: conversations.value.due,
                })}{/if}{:else}{DOT}{/if}</span
          >
        {/if}
        <span class="door__arrow" aria-hidden="true">→</span>
      </a>
    {/if}

    {#if money}
      <a class="door" href="/h/books" data-testid="door-books">
        <span class="door__lens">{t('lens.money', locale)}</span>
        {#if money.errored}
          <span class="door__n door__n--na">{DOT}</span><span class="door__txt">{t('desk.door_error', locale)}</span>
        {:else}
          <span class="door__n">{money.value ? money.value.owed : DOT}</span>
          <span class="door__txt"
            >{t('desk.door_money_n', locale)}<br />{#if money.value}{#if money.value.overdueCount > 0}<em class="door__hot"
                  >{t('desk.door_money_sub', locale, { amount: money.value.overdue })}</em
                >{:else}{t('desk.door_money_none', locale)}{/if}{:else}{DOT}{/if}</span
          >
        {/if}
        <span class="door__arrow" aria-hidden="true">→</span>
      </a>
    {/if}
  </div>
</section>

<style>
  .doors {
    display: grid;
    gap: var(--space-s);
  }
  .door {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-areas: 'lens lens arrow' 'n txt arrow';
    column-gap: var(--space-m);
    align-items: center;
    padding: var(--space-s) var(--space-m);
    border: 1px solid var(--border-color-light);
    border-radius: var(--radius-l);
    background: var(--bg-ultra-light);
    color: inherit;
    text-decoration: none;
    transition: border-color var(--transition);
  }
  .door:hover {
    border-color: var(--border-color-dark);
  }
  .door__lens {
    grid-area: lens;
    display: flex;
    gap: var(--space-s);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .door__n {
    grid-area: n;
    font-family: var(--font-display);
    font-size: var(--text-xxl);
    line-height: 1.1;
    color: var(--heading-color);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .door__n--na {
    color: var(--text-faint);
  }
  .door__txt {
    grid-area: txt;
    font-size: var(--text-s);
    line-height: 1.35;
    color: var(--text-muted);
  }
  .door__lens i {
    font-style: normal;
    text-transform: none;
    letter-spacing: var(--mono-letter-spacing);
  }
  .door__txt em {
    font-style: normal;
  }
  .door__hot {
    color: var(--danger);
  }
  .door__arrow {
    grid-area: arrow;
    color: var(--text-faint);
    transition: transform var(--transition);
  }
  .door:hover .door__arrow {
    transform: translateX(3px);
    color: var(--text-muted);
  }
  /* Phone: a door is one line — figure, words, arrow. */
  @media (max-width: 47.999rem) {
    .door {
      grid-template-areas: 'n txt arrow';
      padding: var(--space-xs) var(--space-s);
    }
    .door__lens {
      display: none;
    }
    .door__n {
      font-size: var(--text-l);
      min-inline-size: 3.5rem;
    }
  }
</style>
