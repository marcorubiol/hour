<script lang="ts">
  /**
   * «COMING UP», Hoy's second block (ADR-202 § 6, replaces «Después»): a
   * strip of day tiles. The big number, the weekday and the month beside it,
   * one tile per day with something, two things a tile and «+N»; two weeks
   * or ten tiles at most (`$lib/hoy` comingTiles) and a last tile «Planner
   * →». On a phone the strip slides sideways, the third tile peeking; on a
   * desktop the tiles go one under the other (§ 6 c) and «Planner →» is a
   * low quiet row at their foot, lighter than any tile with something.
   *
   * THE DOOR IS THE TILE (§ 8, design-system rule 10): each opens its day in
   * the Planner; the block's head carries no written link. An option to
   * decide keeps its tile with its «?» even when «Te espera» asks it too
   * (ADR-203 § 10). With nothing in two weeks, the sentence of always.
   */
  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import { dualTime, hourMark, localeDayMonthNear, localeMonthShort, localeWeekdayShort } from '$lib/datetime';
  import { t, tradeFor, type Locale, type Voice } from '$lib/i18n';
  import { lensOn } from '$lib/lenses.svelte';
  import { perfWorkspaceId, type SlipContext, type SlipKind } from '$lib/month-events';
  import { plannerDayHref } from '$lib/planner';
  import { pulseSlip } from '$lib/pulse-feeds.svelte';
  import type { PulseNext } from '$lib/pulse';
  import type { ComingTile } from '$lib/hoy';
  import { accentVarFor } from '$lib/utils/accent';

  interface Props {
    tiles: ComingTile[];
    /** The next thing when it is more than two weeks away, or null. */
    far?: PulseNext | null;
    settled: boolean;
    errored: boolean;
    today: string;
    viewerTz: string;
    slipCtx: SlipContext;
    locale: Locale;
  }

  let { tiles, far = null, settled, errored, today, viewerTz, slipCtx, locale }: Props = $props();

  const kindLabel = (kind: SlipKind, voice?: Voice) => t(`planner.kind_${kind}`, locale, undefined, voice);
  const hour = (iso: string, tz: string | null) => hourMark(dualTime(iso, tz, viewerTz).primary);
  let planner = $derived(lensOn('planner'));
  /** A tile's door: its day in the Planner, else its first thing's record. */
  function tileHref(tile: ComingTile): string | undefined {
    if (planner) return plannerDayHref('day', tile.day);
    return pulseSlip(tile.items[0].ref, tile.day, slipCtx).href ?? undefined;
  }
  let farHref = $derived.by(() => {
    if (!far) return undefined;
    return pulseSlip(far.ref, far.day, slipCtx).href ?? (planner ? plannerDayHref('day', far.day) : undefined);
  });
</script>

{#snippet thing(item: PulseNext, day: string)}
  {@const sl = pulseSlip(item.ref, day, slipCtx)}
  {@const held = sl.cert === 'hold' || sl.cert === 'proposed'}
  {@const where = sl.lead ? `${t('planner.slip_to', locale)} ${sl.name}` : sl.city || sl.name}
  <li class="tile__thing">
    <!-- In a narrow tile the monogram goes over the word, not beside it (rule 7). -->
    <span class="tile__what"
      >{#if item.ref.row.project}<IdentityMark
          mini
          accent={accentVarFor(item.ref.row.project)}
          name={item.ref.row.project.name}
          initials={item.ref.row.project.initials}
        />{/if}<span class:guess={held}>{kindLabel(sl.kind, tradeFor(perfWorkspaceId(item.ref.row)))}{held ? '?' : ''}</span></span
    >
    <small class="tile__meta">{[item.at ? hour(item.at, item.ref.tz) : null, where].filter(Boolean).join(' · ')}</small>
  </li>
{/snippet}

{#if !errored}
  <section class="dband coming" aria-labelledby="desk-coming-h" data-help-step="desk-coming">
    <div class="coming__head"><BlockHead title={t('desk.band_coming', locale)} titleId="desk-coming-h" /></div>
    {#if !settled}
      <ol class="coming__strip" aria-hidden="true">
        {#each [0, 1, 2] as i (i)}<li class="tile tile--wait"><span class="ghost-line">&nbsp;</span></li>{/each}
      </ol>
    {:else if tiles.length > 0}
      <ol class="coming__strip" data-testid="desk-coming">
        {#each tiles as tile (tile.day)}
          {@const href = tileHref(tile)}
          <li class="coming__cell">
            <svelte:element this={href ? 'a' : 'div'} {href} class="tile" data-testid="desk-tile" data-day={tile.day}>
              <span class="tile__date">
                <span class="tile__n">{Number(tile.day.slice(8, 10))}</span>
                <span class="tile__wd">{localeWeekdayShort(tile.day, locale)}</span>
                <span class="tile__mo">{localeMonthShort(tile.day, locale)}</span>
              </span>
              <ul class="tile__things">
                {#each tile.items as item (item.ref.of + item.ref.id)}{@render thing(item, tile.day)}{/each}
              </ul>
              {#if tile.more > 0}<span class="tile__more">{t('desk.coming_more', locale, { n: tile.more })}</span>{/if}
            </svelte:element>
          </li>
        {/each}
        {#if planner}
          <li class="coming__cell">
            <a class="tile tile--end" href="/h/planner" data-testid="desk-tile-planner">{t('lens.planner', locale)} →</a>
          </li>
        {/if}
      </ol>
    {:else if far}
      <!-- Far away is still «the next thing»: one sentence (ADR-149). -->
      {@const sl = pulseSlip(far.ref, far.day, slipCtx)}
      {@const farText = t('desk.next_far', locale, { day: localeDayMonthNear(far.day, today, locale), place: sl.city || sl.name })}
      <p class="empty-line">
        {#if farHref}<a class="empty-line__text coming__far" href={farHref}>{farText} →</a>{:else}<span class="empty-line__text">{farText}</span>{/if}
      </p>
    {:else}
      <EmptyLine text={t('desk.next_empty', locale)} />
    {/if}
  </section>
{/if}

<style>
  .coming__head {
    margin-block-end: var(--space-s);
  }
  /* DESKTOP (§ 6 c): one tile under another, the date on the left. */
  .coming__strip {
    display: grid;
    gap: var(--space-xs);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .coming__cell {
    display: grid;
    min-inline-size: 0;
  }
  /* THE TILE (design-system rule 2, the middle height): raised paper, a
     fine line, a large radius. */
  .tile {
    display: grid;
    grid-template-columns: 6rem minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--space-s);
    padding: var(--space-s);
    border: var(--line-hairline) solid var(--border-color-light);
    border-radius: var(--radius-l);
    background: var(--bg-ultra-light);
    color: var(--text-color);
    text-decoration: none;
    min-inline-size: 0;
  }
  a.tile:hover {
    border-color: var(--border-color-dark);
  }
  .tile--wait {
    min-block-size: var(--control-size-m);
  }
  /* The tile's date: the big number, weekday and month beside it (rule 8). */
  .tile__date {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    column-gap: var(--space-xs);
    align-items: center;
  }
  .tile__n {
    grid-row: span 2;
    font-family: var(--font-display);
    font-size: var(--display-tile);
    line-height: 1;
    color: var(--heading-color);
    font-variant-numeric: tabular-nums;
  }
  .tile__wd,
  .tile__mo,
  .tile__more {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    line-height: 1.25;
  }
  .tile__wd {
    color: var(--heading-color);
  }
  .tile__mo,
  .tile__more {
    color: var(--text-faint);
  }
  .tile__things {
    display: grid;
    gap: var(--space-xs);
    margin: 0;
    padding: 0;
    list-style: none;
    min-inline-size: 0;
  }
  .tile__thing {
    display: grid;
    gap: var(--space-2xs);
    min-inline-size: 0;
    font-size: var(--text-s);
    overflow-wrap: anywhere;
  }
  .tile__what {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs);
  }
  .tile__meta {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  /* The end door on a desktop: a low quiet row at the column's foot, the
     voice of a block's action (`.block-head__act`), not a tile. */
  .tile--end {
    display: flex;
    align-items: center;
    padding-block: var(--space-2xs);
    border-color: transparent;
    background: transparent;
    font-size: var(--text-s);
    color: var(--text-muted);
  }
  a.tile--end:hover {
    border-color: transparent;
    color: var(--text-color);
  }
  @media (pointer: coarse) {
    .tile--end {
      min-block-size: var(--touch-target);
    }
  }
  .coming__far {
    color: inherit;
    text-decoration: none;
  }
  .coming__far:hover {
    color: var(--text-color);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  /* THE PHONE (§ 6 b): a strip that slides, tiles of a fixed width, the
     third one peeking; the strip runs to the screen's edges. */
  @media (max-width: 47.999rem) {
    .coming__strip {
      display: flex;
      gap: var(--space-xs);
      overflow-x: auto;
      overscroll-behavior-x: contain;
      scroll-snap-type: x mandatory;
      margin-inline: calc(-1 * var(--shell-gutter));
      padding-inline: var(--shell-gutter);
      scroll-padding-inline: var(--shell-gutter);
      scrollbar-width: none;
    }
    .coming__strip::-webkit-scrollbar {
      display: none;
    }
    .coming__cell {
      flex: 0 0 var(--coming-tile-width);
      scroll-snap-align: start;
    }
    .tile {
      grid-template-columns: minmax(0, 1fr);
      align-content: start;
      gap: var(--space-xs);
      padding: var(--space-s);
    }
    /* On the strip the end door stays a tile: dashed, its word centred. */
    .tile--end {
      display: grid;
      place-content: center;
      text-align: center;
      padding: var(--space-s);
      border-color: var(--border-color-light);
      border-style: dashed;
      font-size: var(--text-m);
      color: var(--text-color);
    }
    a.tile--end:hover {
      border-color: var(--border-color-dark);
    }
    /* Over the word, not beside it: beside it split the word at 390. */
    .tile__what {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-2xs);
    }
  }
</style>
