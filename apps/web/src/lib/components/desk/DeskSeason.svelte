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
  import BlockHead from '$lib/components/BlockHead.svelte';
  import { DASH } from '$lib/glyphs';
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
</script>

<section class="dband season" aria-labelledby="desk-season-h">
  <!-- No common window over the doors: each one says its own, in its lens's
       words (the Planner's twelve weeks, Conversations' season). -->
  <BlockHead id="desk-season-h" title={t('desk.band_season', locale)} />

  <div class="doors">
    <a class="door" href="/h/planner" data-testid="door-planner">
      <span class="door__lens eyebrow eyebrow--sub">{t('lens.planner', locale)}<i>{t('desk.door_planner_window', locale)}</i></span>
      {#if planner.errored}
        <span class="door__n stat door__n--na">{DASH}</span><span class="door__txt">{t('desk.door_error', locale)}</span>
      {:else}
        <span class="door__n stat">{planner.value ? planner.value.confirmed : DASH}</span>
        <span class="door__txt"
          >{t('desk.door_planner_n', locale)}<br />{planner.value
            ? t('desk.door_planner_sub', locale, {
                holds: planner.value.holds,
                travel: t(planner.value.travel === 1 ? 'desk.door_travel_one' : 'desk.door_travel_many', locale, {
                  n: planner.value.travel,
                }),
              })
            : DASH}</span
        >
      {/if}
      <span class="door__arrow" aria-hidden="true">→</span>
    </a>

    {#if conversations}
      <a class="door" href="/h/conversations" data-testid="door-conversations">
        <span class="door__lens eyebrow eyebrow--sub">{t('lens.conversations', locale)}<i>{seasonLabel}</i></span>
        {#if conversations.errored}
          <span class="door__n stat door__n--na">{DASH}</span><span class="door__txt">{t('desk.door_error', locale)}</span>
        {:else}
          <span class="door__n stat">{conversations.value ? conversations.value.holds : DASH}</span>
          <span class="door__txt"
            >{t('desk.door_conv_n', locale)}<br />{#if conversations.value}{t('desk.door_conv_sub', locale, {
                live: conversations.value.live,
              })}{#if conversations.value.due > 0}{' · '}{t('desk.door_conv_due', locale, {
                  n: conversations.value.due,
                })}{/if}{:else}{DASH}{/if}</span
          >
        {/if}
        <span class="door__arrow" aria-hidden="true">→</span>
      </a>
    {/if}

    {#if money}
      <a class="door" href="/h/books" data-testid="door-books">
        <span class="door__lens eyebrow eyebrow--sub">{t('lens.money', locale)}</span>
        {#if money.errored}
          <span class="door__n stat door__n--na">{DASH}</span><span class="door__txt">{t('desk.door_error', locale)}</span>
        {:else}
          <span class="door__n stat">{money.value ? money.value.owed : DASH}</span>
          <span class="door__txt"
            >{t('desk.door_money_n', locale)}<br />{#if money.value}{#if money.value.overdueCount > 0}<em class="door__hot"
                  >{t('desk.door_money_sub', locale, { amount: money.value.overdue })}</em
                >{:else}{t('desk.door_money_none', locale)}{/if}{:else}{DASH}{/if}</span
          >
        {/if}
        <span class="door__arrow" aria-hidden="true">→</span>
      </a>
    {/if}
  </div>
</section>

<style>
  /* The figure column belongs to the doors, not to each door: the words
     start on one vertical whatever the widest figure is, and a reserved
     minimum (room for «2.400 €» at --stat-lead) keeps them still while the
     figures land. */
  .doors {
    display: grid;
    grid-template-columns: minmax(5.5rem, max-content) minmax(0, 1fr) auto;
    gap: var(--space-s) 0;
  }
  .door {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
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
  }
  .door__n {
    grid-area: n;
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
  /* Phone: tighter, the lens still named (it is the link's purpose, for the
     eye and for a screen reader). */
  @media (max-width: 47.999rem) {
    .doors {
      grid-template-columns: minmax(4.5rem, max-content) minmax(0, 1fr) auto;
    }
    .door {
      padding: var(--space-xs) var(--space-s);
    }
    .door__n {
      font-size: var(--stat-inline);
    }
  }
</style>
