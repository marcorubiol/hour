<script lang="ts">
  /**
   * «LA TEMPORADA» — band 4 of the Desk (ADR-117): one door per lens, a big
   * figure and its word; the small ones only when they are not zero, and
   * none that «Te espera» already lists (ADR-149: «0 por decidir · 0 días de
   * viaje», «nada vencido» and «N esperan respuesta» are gone). A door is a
   * door: it says what its lens says,
   * in the lens's own arithmetic (Planner: its twelve-week census and its
   * «Choques», in red as there; Conversations:
   * its overview; Cuentas: `moneyPosition`), and it opens the lens.
   *
   * Never empty: a door is still a door at zero, but a zero is not news, so
   * it is said small and in the faint ink; the big figure is for what is
   * there (ADR-154). While loading, a `·` holds the figure's
   * place. A door whose lens failed says so alone. Cuentas exists only with
   * `read:money`: without it, no trace. A lens the space does not use
   * (ADR-132) has no door either.
   */
  import BlockHead from '$lib/components/BlockHead.svelte';
  import Fold from '$lib/components/Fold.svelte';
  import { DASH } from '$lib/glyphs';
  import { t, type Locale } from '$lib/i18n';
  import type { PlannerDoor } from '$lib/desk-bands';

  type Door<T> = { value: T | null; errored: boolean };

  interface Props {
    /** null: the Planner is off in every space on screen (ADR-132). */
    planner: Door<PlannerDoor> | null;
    /** null: no read on conversations anywhere (ADR-124), the door does not exist. */
    conversations: Door<{ holds: number; live: number; due: number }> | null;
    /** null: no read:money, the door does not exist. */
    money: Door<{ owed: string; overdue: string; overdueCount: number; nothingOwed: boolean }> | null;
    seasonLabel: string;
    /** On a wide screen the season is a fold at the foot of the reading column, saying what it keeps. */
    folded?: boolean;
    /** Full-width panoramic band below the desktop grid: doors sit side by side. */
    horizontal?: boolean;
    locale: Locale;
  }

  let { planner, conversations, money, seasonLabel, folded = false, horizontal = false, locale }: Props = $props();
  let keeps = $derived(
    [
      planner?.value ? t('desk.fold_season_confirmed', locale, { n: planner.value.confirmed }) : null,
      conversations?.value ? t('desk.fold_season_holds', locale, { n: conversations.value.holds }) : null,
    ]
      .filter(Boolean)
      .join(' · '),
  );
  let foldOpen = $state(false);
</script>

{#snippet doorsBody()}

  <div class="doors" class:doors--horizontal={horizontal}>
    {#if planner}
    <a class="door" href="/h/planner" data-testid="door-planner">
      <span class="door__lens">{t('lens.planner', locale)}<i>{t('desk.door_planner_window', locale)}</i></span>
      {#if planner.errored}
        <span class="door__n stat door__n--na">{DASH}</span><span class="door__txt">{t('desk.door_error', locale)}</span>
      {:else}
        <span class="door__n stat" class:figure--zero={planner.value?.confirmed === 0}>{planner.value ? planner.value.confirmed : DASH}</span>
        {@const pv = planner.value}
        {@const subs = pv
          ? [
              pv.holds > 0 ? t('desk.door_holds', locale, { n: pv.holds }) : null,
              pv.travel > 0 ? t(pv.travel === 1 ? 'desk.door_travel_one' : 'desk.door_travel_many', locale, { n: pv.travel }) : null,
            ].filter(Boolean)
          : []}
        <span class="door__txt"
          >{t('desk.door_planner_n', locale)}{#if !pv}<br />{DASH}{:else if subs.length > 0 || pv.clashes > 0}<br />{subs.join(
              ' · ',
            )}{#if pv.clashes > 0}{subs.length > 0 ? ' · ' : ''}<em class="door__hot"
                >{pv.clashes}
                {t(pv.clashes === 1 ? 'planner.season_clash_one' : 'planner.season_clashes', locale)}</em
              >{/if}{/if}</span
        >
      {/if}
      <span class="door__arrow" aria-hidden="true">→</span>
    </a>
    {/if}

    {#if conversations}
      <!-- Its figure is Difusión's season (bolos en opción, ADR-138 § 3): the door
           opens Envíos, where that season lives since ADR-176, so the door and
           the lens count the same (ADR-118 § 7).
           The window NAMES the chip (ADR-167 § 2): «0 bolos en opción» beside
           the Board's «1 opción» read as the same count disagreeing, and they
           are two: deals of Difusión in the season here, functions on hold in
           every lane there. -->
      <a class="door" href="/h/conversations?view=envios" data-testid="door-conversations">
        <span class="door__lens">{t('lens.conversations', locale)}<i>{t('conversations.view_sales', locale)} · {seasonLabel}</i></span>
        {#if conversations.errored}
          <span class="door__n stat door__n--na">{DASH}</span><span class="door__txt">{t('desk.door_error', locale)}</span>
        {:else}
          <span class="door__n stat" class:figure--zero={conversations.value?.holds === 0}>{conversations.value ? conversations.value.holds : DASH}</span>
          <span class="door__txt"
            >{t('desk.door_conv_n', locale)}{#if !conversations.value}<br />{DASH}{:else if conversations.value.live > 0}<br />{t(
                'desk.door_conv_sub',
                locale,
                { live: conversations.value.live },
              )}{/if}</span
          >
        {/if}
        <span class="door__arrow" aria-hidden="true">→</span>
      </a>
    {/if}

    {#if money}
      <a class="door" href="/h/books" data-testid="door-books">
        <span class="door__lens">{t('lens.money', locale)}</span>
        {#if money.errored}
          <span class="door__n stat door__n--na">{DASH}</span><span class="door__txt">{t('desk.door_error', locale)}</span>
        {:else}
          <span class="door__n stat" class:figure--zero={money.value?.nothingOwed}>{money.value ? money.value.owed : DASH}</span>
          <span class="door__txt"
            >{t('desk.door_money_n', locale)}{#if !money.value}<br />{DASH}{:else if money.value.overdueCount > 0}<br /><em
                  class="door__hot">{t('desk.door_money_sub', locale, { amount: money.value.overdue })}</em
                >{/if}</span
          >
        {/if}
        <span class="door__arrow" aria-hidden="true">→</span>
      </a>
    {/if}
  </div>
{/snippet}

<section class="dband season" aria-labelledby="desk-season-h" data-testid="desk-season">
  {#if folded}
    <Fold word={t('desk.band_season', locale)} {keeps} bind:open={foldOpen} id="desk-season-h" testid="desk-season-fold">
      {@render doorsBody()}
    </Fold>
  {:else}
  <BlockHead id="desk-season-h" title={t('desk.band_season', locale)} display={horizontal} />
  {@render doorsBody()}
  {/if}
</section>

<style>
  @layer components {
  /* The figure column belongs to the doors, not to each door: the words
     start on one vertical whatever the widest figure is, and a reserved
     minimum (room for «2.400 €» at --stat-lead) keeps them still while the
     figures land. */
  .doors {
    container: doors / inline-size;
    display: grid;
    grid-template-columns: minmax(5.5rem, max-content) minmax(0, 1fr) auto;
  }
  /* Panoramic desktop band below the Hoy grid: one column per lens door,
     each in the soft box of «Te espera» (Marco, 23-11-2026), so the band
     weighs what the rest of Hoy weighs instead of floating. */
  .doors--horizontal {
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: var(--space-2xs);
    padding-block-start: var(--space-s);
  }
  .doors--horizontal .door {
    grid-column: auto;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'lens arrow' 'n n' 'txt txt';
    align-content: start;
    row-gap: var(--space-2xs);
    column-gap: var(--space-s);
    padding: var(--space-s);
    margin-inline: 0;
    border-radius: var(--radius-m);
    background: var(--bg-box);
  }
  .doors--horizontal .door + .door {
    border-block-start: 0;
  }
  @media (hover: hover) and (pointer: fine) {
    .doors--horizontal .door:hover {
      background: var(--bg-box-hover);
    }
  }
  .doors--horizontal .door__lens {
    flex-wrap: wrap;
    row-gap: 0;
  }
  .doors--horizontal .door__arrow {
    align-self: baseline;
  }
  /* A DOOR IS A ROW, NOT AN OBJECT (ADR-145, fase 2): no box, no ground; a
     hairline between two doors, none under the last (the block's head draws
     the one above the first). */
  .door {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    grid-template-areas: 'lens lens arrow' 'n txt arrow';
    column-gap: var(--space-m);
    /* The figure sits on its word's line, not centred against the two lines
       of words (ADR-167 § 2); the arrow alone centres on the row. */
    align-items: baseline;
    padding-block: var(--space-s);
    padding-inline: var(--space-xs);
    margin-inline: calc(-1 * var(--space-xs));
    border-radius: var(--radius-m);
    color: inherit;
    text-decoration: none;
    transition:
      background var(--transition),
      border-color var(--transition);
  }
  .door + .door {
    border-block-start: var(--line-hairline) solid var(--border-color-light);
  }
  @media (hover: hover) and (pointer: fine) {
    .door:hover {
      background: color-mix(in oklch, var(--text-color) 4%, transparent);
      border-block-start-color: transparent;
      text-decoration: none;
    }
    .door:hover + .door {
      border-block-start-color: transparent;
    }
    .door:active {
      background: color-mix(in oklch, var(--text-color) 7%, transparent);
    }
    .door:hover .door__lens {
      color: var(--heading-color);
    }
    .door:hover .door__arrow {
      transform: translateX(3px);
      color: var(--text-color);
    }
  }
  /* ONE LABEL PER BLOCK (ADR-139 § 6): «La temporada» is the block's; a
     door is named by its lens in plain words, the window after it, quieter. */
  .door__lens {
    grid-area: lens;
    display: flex;
    gap: var(--space-s);
    font-size: var(--text-s);
    color: var(--text-color);
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
    color: var(--text-faint);
  }
  .door__txt em {
    font-style: normal;
  }
  /* THE RED ONCE PER BLOCK: the first door with something hot keeps it;
     a later one says it in ink. */
  .door__hot {
    color: var(--danger);
  }
  .door:has(.door__hot) ~ .door .door__hot {
    color: var(--text-color);
  }
  .door__arrow {
    grid-area: arrow;
    align-self: center;
    color: var(--text-faint);
    transition:
      transform var(--transition),
      color var(--transition);
  }
  /* A narrow column (the Desk's right one on a tablet): the figure and its
     words no longer share a row, they stack under the lens's name, so each
     line keeps its measure instead of folding word by word. The arrow stays
     on the right edge. A desktop's doors are wider than this and keep the
     row; so is a phone's, one column the page wide. */
  @container doors (max-width: 20rem) {
    .doors:not(.doors--horizontal) .door {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: 'lens arrow' 'n arrow' 'txt arrow';
      row-gap: var(--space-2xs);
    }
    .doors:not(.doors--horizontal) .door__lens {
      flex-wrap: wrap;
      column-gap: var(--space-s);
      row-gap: 0;
    }
  }
  /* Phone: tighter, the lens still named (it is the link's purpose, for the
     eye and for a screen reader). */
  @media (max-width: 47.999rem) {
    .doors {
      grid-template-columns: minmax(4.5rem, max-content) minmax(0, 1fr) auto;
    }
    .door {
      padding-block: var(--space-xs);
    }
    .door__n {
      font-size: var(--stat-inline);
    }
  }
  }
</style>
