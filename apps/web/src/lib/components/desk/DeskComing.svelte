<script lang="ts">
  /**
   * «COMING UP», Hoy's second block (ADR-202 § 6, replaces «Después»): a
   * strip of day tiles. The big number, the weekday and the month beside it,
   * one tile per day with something, two things a tile and «+N»; two weeks
   * or ten tiles at most, four on a phone (`$lib/hoy` comingTiles, ADR-205),
   * and a last tile «Planner →». On a phone the strip slides sideways, the third tile peeking; on a
   * desktop the tiles go one under the other (§ 6 c) and «Planner →» is a
   * low quiet row at their foot, lighter than any tile with something.
   *
   * THE PLACE LEADS (ADR-227): each thing is titled by where it happens
   * («Donostia», «a Donostia» on a trip); the kind and the hour go under it,
   * small, and «sin hora» in grey when it has none.
   *
   * ONE AMBER A SCREEN (ADR-227, amends ADR-211 § 3 and ADR-221 § 8): only
   * the tile with the thing that falls due first carries amber (its border
   * and «Hoja sin enviar»). Under the strip, one amber line says when, where,
   * what and its verb, which opens the pase; one grey line counts the other
   * performances with something open and opens the Agenda. Nothing open, no
   * line. Off in calm (ADR-203 § 5).
   *
   * THE DOOR IS THE TILE (§ 8, design-system rule 10): on a phone a tile
   * with one thing opens that thing's pase, with several its day in the
   * Planner (ADR-223); on a desktop the number opens the day, each row its pase; the block's head carries no written link. An option to
   * decide keeps its tile with its «?» even when «Te espera» asks it too
   * (ADR-203 § 10). With nothing in two weeks, the sentence of always.
   */
  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import { dualTime, hourMark, localeDayMonthNear, localeMonthShort, localeWeekdayShort } from '$lib/datetime';
  import { t, tradeFor, type Locale, type Voice } from '$lib/i18n';
  import { lensOn } from '$lib/lenses.svelte';
  import { perfWorkspaceId, type PerformanceEvent, type SlipContext, type SlipKind } from '$lib/month-events';
  import { plannerDayHref } from '$lib/planner';
  import { pulseSlip } from '$lib/pulse-feeds.svelte';
  import type { PulseNext } from '$lib/pulse';
  import { DRAWN_WHOLE, comingPlace, yourStop, type ComingOpen, type ComingTile, type TileUrgent } from '$lib/hoy';
  import { accentVarFor } from '$lib/utils/accent';

  interface Props {
    tiles: ComingTile[];
    /** What is open in the two weeks (`comingOpen`): the one amber and the grey figure. */
    open?: ComingOpen;
    /** The next thing when it is more than two weeks away, or null. */
    far?: PulseNext | null;
    settled: boolean;
    errored: boolean;
    today: string;
    viewerTz: string;
    slipCtx: SlipContext;
    /** The viewer's person (`/api/me`): «estás a las» on the tiles (ADR-234). */
    me?: string | null;
    locale: Locale;
    /** What is open, amber or grey (ADR-227); off in calm (ADR-203 § 5). */
    dots?: boolean;
    /** From 64rem (the Desk's two columns): a 3×2 calendar grid of day cards. */
    wide?: boolean;
  }

  let {
    tiles,
    open = { urgent: null, urgentDay: null, rest: 0 },
    far = null,
    settled,
    errored,
    today,
    viewerTz,
    slipCtx,
    me = null,
    locale,
    dots = true,
    wide = false,
  }: Props = $props();

  const kindLabel = (kind: SlipKind, voice?: Voice) => t(`planner.kind_${kind}`, locale, undefined, voice);
  const hour = (iso: string, tz: string | null) => hourMark(dualTime(iso, tz, viewerTz).primary);
  /** «estás a las 14h» when the list names you (ADR-234): the day's first stop. */
  const stopOf = (item: PulseNext) => (item.ref.of === 'performance' ? yourStop(item.ref.row as PerformanceEvent, me) : null);
  const dayDiff = (day: string) =>
    Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  /** Where a thing happens: its city, else its name; a trip, «to Donostia» without «to Viatge». */
  function placeOf(item: PulseNext, day: string): string {
    return comingPlace(pulseSlip(item.ref, day, slipCtx), t('planner.slip_to', locale));
  }
  /** The tile's own amber words: what, short («Hoja sin enviar»). */
  function urgentShort(u: TileUrgent): string {
    if (u.what === 'hand') return u.name ?? '';
    return t(`desk.urgent_short_${u.what}`, locale);
  }
  /** «Pasado mañana, Donostia: compartir la hoja» — when counts to its own
      day: a hold's deadline, else the performance's. */
  function urgentLine(u: TileUrgent): string {
    const n = dayDiff(u.day);
    const when =
      n < 0 && u.what === 'hold'
        ? t('desk.when_overdue', locale)
        : n <= 0
          ? t('desk.when_today', locale)
          : n === 1
            ? t('desk.when_tomorrow', locale)
            : n === 2
              ? t('desk.when_after_tomorrow', locale)
              : t('desk.when_days', locale, { n });
    const what =
      u.what === 'hand'
        ? (u.name ?? '')
        : t(
            { roadsheet: 'desk.urgent_roadsheet', hold: 'desk.urgent_hold', hours: 'desk.urgent_hours', team: 'desk.urgent_team' }[u.what],
            locale,
          );
    const where = u.item ? placeOf(u.item, u.item.day) : '';
    return where ? t('desk.urgent_line', locale, { when, where, what }) : t('desk.tile_urgent', locale, { when, what });
  }
  /** The amber line's verb, the pase's own («Compartir», «Decidir»). */
  const urgentVerb = (u: TileUrgent) => t(`desk.urgent_verb_${u.what}`, locale);
  let urgentHref = $derived.by(() => {
    const it = open.urgent?.item;
    return it ? (pulseSlip(it.ref, it.day, slipCtx).href ?? undefined) : undefined;
  });
  let restWords = $derived(
    t(
      `desk.open_${open.urgent ? 'more' : 'all'}${open.rest === 1 ? '_one' : ''}`,
      locale,
      { n: open.rest },
    ),
  );
  let showOpen = $derived(dots && settled && tiles.length > 0 && (open.urgent !== null || open.rest > 0));
  let planner = $derived(lensOn('planner'));
  /** A tile's day in the Planner, else its first thing's record. On the phone
      too, with one thing or five: the tile is a date, so it opens the day
      («tocas una fecha, se abre el día», ADR-248, which ends ADR-223's
      one-thing exception: it opened that thing's vistazo and the Day was
      never seen). Inside the day, each box opens its pase. */
  function dayHref(tile: ComingTile): string | undefined {
    if (planner) return plannerDayHref('day', tile.day);
    return pulseSlip(tile.items[0].ref, tile.day, slipCtx).href ?? undefined;
  }
  /** «15 funciones · 9 ciudades» for a day of more than three things (ADR-237), else null. */
  function manyOf(tile: ComingTile): string | null {
    if (tile.all.length <= DRAWN_WHOLE) return null;
    const perfs = tile.all.filter((x) => x.ref.of === 'performance');
    const voices = new Set(perfs.map((x) => tradeFor(perfWorkspaceId(x.ref.row))));
    const voice: Voice = voices.size === 1 ? [...voices][0] : 'mixed';
    const cities = new Set(tile.all.map((x) => pulseSlip(x.ref, tile.day, slipCtx).city).filter(Boolean));
    const others = tile.all.length - perfs.length;
    return [
      perfs.length > 0 ? t('desk.shows_n', locale, { n: perfs.length }, voice) : null,
      others > 0 ? t('desk.coming_more', locale, { n: others }) : null,
      cities.size > 1 ? t('desk.cities_n', locale, { n: cities.size }) : [...cities][0],
    ]
      .filter(Boolean)
      .join(' · ');
  }
  /** Does this tile carry the screen's one amber? */
  const amberOn = (tile: ComingTile) => dots && open.urgentDay === tile.day && tile.urgent !== null;
  let farHref = $derived.by(() => {
    if (!far) return undefined;
    return pulseSlip(far.ref, far.day, slipCtx).href ?? (planner ? plannerDayHref('day', far.day) : undefined);
  });
</script>

<!-- One thing: its place on top; under it, small, the monogram, the kind and
     the hour (omitted when none, avoiding ten repeated «no hour» lines). -->
{#snippet body(item: PulseNext, day: string)}
  {@const sl = pulseSlip(item.ref, day, slipCtx)}
  {@const held = sl.cert === 'hold' || sl.cert === 'proposed'}
  {@const stop = stopOf(item)}
  <span class="tile__place">{placeOf(item, day)}</span>
  <small class="tile__meta"
    >{#if item.ref.row.project}<IdentityMark
        mini
        accent={accentVarFor(item.ref.row.project)}
        name={item.ref.row.project.name}
        initials={item.ref.row.project.initials}
      />{/if}<span class:guess={held}>{kindLabel(sl.kind, tradeFor(perfWorkspaceId(item.ref.row)))}{held ? '?' : ''}</span>{#if stop} · {t('desk.you_at', locale, { time: hour(stop.at, item.ref.tz) })}{:else if item.at} · {hour(item.at, item.ref.tz)}{/if}</small
  >
{/snippet}

{#snippet many(tile: ComingTile)}
  <!-- More than three (ADR-237): counted, not listed; the tile opens the day. -->
  <p class="tile__many" data-testid="desk-tile-many">{manyOf(tile)}</p>
{/snippet}

{#snippet amber(tile: ComingTile)}
  {#if amberOn(tile) && tile.urgent}<p class="tile__falta" data-testid="desk-tile-missing">
      <span class="missing-dot missing-dot--s missing-dot--urgent" aria-hidden="true"></span>{urgentShort(tile.urgent)}
    </p>{/if}
{/snippet}

{#if !errored}
  <section class="dband coming" aria-labelledby="desk-coming-h" data-help-step="desk-coming">
    <div class="coming__head">
      <BlockHead title={t('desk.band_coming', locale)} titleId="desk-coming-h" display>
        {#if wide && planner && settled && tiles.length > 0}
          <a class="block-head__act" href="/h/planner" data-testid="desk-tile-planner">{t('lens.planner', locale)} →</a>
        {/if}
      </BlockHead>
    </div>
    {#if !settled}
      <ol class="coming__strip" class:coming__strip--grid={wide} aria-hidden="true">
        {#each [0, 1, 2] as i (i)}<li class="tile tile--wait"><span class="ghost-line">&nbsp;</span></li>{/each}
      </ol>
    {:else if tiles.length > 0}
      <ol class="coming__strip" class:coming__strip--grid={wide} data-testid="desk-coming">
        {#each tiles as tile (tile.day)}
          {#if wide}
          {@const manyText = planner ? manyOf(tile) : null}
          {@const single = !manyText && tile.items.length === 1 && tile.more === 0}
          {@const href = dayHref(tile)}
          <li class="coming__cell">
            <div
              class="tile tile--card"
              class:tile--single={single || Boolean(manyText)}
              class:tile--urgent={amberOn(tile)}
              data-testid="desk-tile"
              data-day={tile.day}
            >
              <svelte:element this={href ? 'a' : 'span'} {href} class="tile__date">
                <span class="tile__n">{Number(tile.day.slice(8, 10))}</span>
                <span class="tile__wd">{localeWeekdayShort(tile.day, locale)}</span>
                <span class="tile__mo">{localeMonthShort(tile.day, locale)}</span>
              </svelte:element>
              {#if manyText}
                <svelte:element this={href ? 'a' : 'div'} {href} class="tile__rowlink tile__rowlink--many">
                  {@render many(tile)}
                </svelte:element>
              {:else}
                <ul class="tile__things tile__things--rows">
                  {#each tile.items as item (item.ref.of + item.ref.id)}
                    {@const door = pulseSlip(item.ref, tile.day, slipCtx).href ?? href}
                    <li class="tile__row">
                      <svelte:element this={door ? 'a' : 'span'} href={door} class="tile__rowlink" data-testid="desk-tile-row">
                        {@render body(item, tile.day)}
                      </svelte:element>
                    </li>
                  {/each}
                </ul>
                {#if tile.more > 0}
                  {#if href}
                    <a class="tile__more tile__more--link" {href}>{t('desk.coming_more', locale, { n: tile.more })}</a>
                  {:else}
                    <span class="tile__more">{t('desk.coming_more', locale, { n: tile.more })}</span>
                  {/if}
                {/if}
              {/if}
              {@render amber(tile)}
            </div>
          </li>
          {:else}
          {@const href = dayHref(tile)}
          <li class="coming__cell">
            <svelte:element
              this={href ? 'a' : 'div'}
              {href}
              class="tile"
              class:tile--urgent={amberOn(tile)}
              data-testid="desk-tile"
              data-day={tile.day}
            >
              <span class="tile__date">
                <span class="tile__n">{Number(tile.day.slice(8, 10))}</span>
                <span class="tile__wd">{localeWeekdayShort(tile.day, locale)}</span>
                <span class="tile__mo">{localeMonthShort(tile.day, locale)}</span>
              </span>
              {#if planner && manyOf(tile)}
                {@render many(tile)}
              {:else}
              <ul class="tile__things">
                {#each tile.items as item (item.ref.of + item.ref.id)}
                  <li class="tile__thing">{@render body(item, tile.day)}</li>
                {/each}
              </ul>
              {#if tile.more > 0}<span class="tile__more">{t('desk.coming_more', locale, { n: tile.more })}</span>{/if}
              {/if}
              {@render amber(tile)}
            </svelte:element>
          </li>
          {/if}
        {/each}
        {#if planner && !wide}
          <li class="coming__cell">
            <a class="tile tile--end" href="/h/planner" data-testid="desk-tile-planner">{t('lens.planner', locale)} →</a>
          </li>
        {/if}
      </ol>
      {#if showOpen}
        <div class="coming__open">
          {#if open.urgent}
            <p class="coming__line coming__line--urgent" data-testid="desk-coming-urgent">
              <span class="missing-dot missing-dot--s missing-dot--urgent" aria-hidden="true"></span><span
                >{urgentLine(open.urgent)}{#if urgentHref}{' · '}<a href={urgentHref}>{urgentVerb(open.urgent)}</a>{/if}</span
              >
            </p>
          {/if}
          {#if open.rest > 0}
            <p class="coming__line" data-testid="desk-coming-open">
              <span class="missing-dot missing-dot--s" aria-hidden="true"></span><span
                >{restWords}{#if planner}{' · '}<a href="/h/planner?view=agenda">{t('desk.open_see', locale)}</a>{/if}</span
              >
            </p>
          {/if}
        </div>
      {/if}
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
  .coming {
    container: coming / inline-size;
  }
  .coming__head {
    margin-block-end: var(--space-s);
  }
  /* DESKTOP: a 3×2 calendar grid of day cards so the urgent line and
     «Te espera» stay above the fold; steps down cleanly by container width. */
  .coming__strip {
    display: grid;
    gap: var(--space-xs);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .coming__strip--grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  @container coming (max-width: 34rem) {
    .coming__strip--grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @container coming (max-width: 20rem) {
    .coming__strip--grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .coming__cell {
    display: grid;
    min-inline-size: 0;
  }
  /* THE TILE (design-system rule 2, the middle height): raised paper, a
     fine line, a large radius. */
  .tile {
    position: relative;
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
    transition:
      background var(--transition),
      border-color var(--transition);
  }
  @media (hover: hover) and (pointer: fine) {
    a.tile:not(.tile--end):hover {
      border-color: var(--border-color-dark);
      background: color-mix(in oklch, var(--bg-ultra-light) 96%, var(--heading-color));
      text-decoration: none;
    }
    a.tile--urgent:hover {
      border-color: var(--missing-ink);
      background: color-mix(in oklch, var(--missing-ink) 4%, var(--bg-ultra-light));
    }
  }
  /* The screen's one amber (ADR-227): the tile of what falls due first. */
  .tile--urgent,
  a.tile--urgent:hover {
    border-color: var(--missing-ink);
  }
  .tile__more {
    align-self: end;
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
  /* The place leads (ADR-227): whole, in two lines before an ellipsis. */
  .tile__place {
    font-size: var(--text-m);
    color: var(--heading-color);
    overflow-wrap: anywhere;
  }
  .tile__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: var(--space-2xs);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  /* WIDE (the Desk's 3×2 calendar grid): calm day container; the date header
     always opens the day in the Planner and each event row always opens its
     own sheet (ADR-223), with soft rounded hover surfaces and zero underlines. */
  .tile--card {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto 1fr auto auto;
    grid-template-areas: 'date' 'things' 'more' 'falta';
    align-items: stretch;
    gap: var(--space-xs);
    padding: var(--space-s);
  }
  .tile--card .tile__date {
    grid-area: date;
    padding: var(--space-2xs) var(--space-xs);
    margin-block: calc(-1 * var(--space-2xs));
    margin-inline: calc(-1 * var(--space-xs));
    border-radius: var(--radius-m);
    color: inherit;
    text-decoration: none;
    transition: background var(--transition);
  }
  @media (hover: hover) and (pointer: fine) {
    .tile--card a.tile__date:hover {
      background: color-mix(in oklch, var(--text-color) 5%, transparent);
      text-decoration: none;
    }
    .tile--card a.tile__date:active {
      background: color-mix(in oklch, var(--text-color) 8%, transparent);
    }
  }
  .tile--card .tile__things {
    grid-area: things;
  }
  /* A day of many (ADR-237): one line, the size of a place. */
  .tile__many {
    margin: 0;
    font-size: var(--text-m);
    color: var(--heading-color);
    overflow-wrap: anywhere;
  }
  .tile--card .tile__rowlink--many {
    grid-area: things;
    align-content: start;
  }
  .tile--card .tile__more {
    grid-area: more;
    align-self: start;
  }
  .tile__more--link {
    justify-self: start;
    padding: var(--space-2xs) var(--space-xs);
    margin-block: calc(-1 * var(--space-2xs));
    margin-inline: calc(-1 * var(--space-xs));
    border-radius: var(--radius-s);
    text-decoration: none;
    transition:
      background var(--transition),
      color var(--transition);
  }
  @media (hover: hover) and (pointer: fine) {
    .tile__more--link:hover {
      background: color-mix(in oklch, var(--text-color) 5%, transparent);
      color: var(--text-color);
      text-decoration: none;
    }
  }
  .tile--card .tile__falta {
    grid-area: falta;
    grid-column: 1 / -1;
  }
  .tile__things--rows {
    gap: var(--space-xs);
    align-content: start;
  }
  .tile--single .tile__things--rows {
    align-content: stretch;
  }
  .tile--single .tile__row {
    display: grid;
  }
  .tile__rowlink {
    display: grid;
    align-content: start;
    gap: var(--space-2xs);
    padding: var(--space-2xs) var(--space-xs);
    margin-block: calc(-1 * var(--space-2xs));
    margin-inline: calc(-1 * var(--space-xs));
    border-radius: var(--radius-m);
    color: inherit;
    text-decoration: none;
    transition: background var(--transition);
  }
  @media (hover: hover) and (pointer: fine) {
    a.tile__rowlink:hover {
      background: color-mix(in oklch, var(--text-color) 5%, transparent);
      text-decoration: none;
    }
    a.tile__rowlink:active {
      background: color-mix(in oklch, var(--text-color) 8%, transparent);
    }
  }
  .tile__falta {
    grid-column: 2 / -1;
    display: flex;
    align-items: center;
    margin: 0;
    font-size: var(--text-xs);
    color: var(--missing-ink);
  }
  /* Under the strip: the one amber line with its verb, and the grey figure
     of the rest with the Agenda's door (ADR-227). */
  /* What a date asks for is a row in the soft box of «Te espera» (Marco,
     23-11-2026): tinted, no edge; the one that is due is the screen's one
     orange row. */
  .coming__open {
    display: grid;
    gap: var(--space-2xs);
    margin-block-start: var(--space-s);
  }
  .coming__line {
    margin: 0;
    padding: var(--space-s);
    border-radius: var(--radius-m);
    background: var(--bg-box);
    font-size: var(--text-s);
    color: var(--text-muted);
  }
  /* Inline, so a line that breaks in two keeps its dot on the first. */
  .coming__line .missing-dot {
    vertical-align: 0.05em;
    margin-inline-end: var(--space-xs);
  }
  .coming__line--urgent {
    color: var(--missing-ink);
    background: color-mix(in oklch, var(--bg), var(--missing-ink) 7%);
  }
  .coming__line a {
    color: inherit;
    font-weight: 500;
    padding: var(--space-2xs) var(--space-xs);
    margin-block: calc(-1 * var(--space-2xs));
    margin-inline: calc(-1 * var(--space-2xs));
    border-radius: var(--radius-s);
    text-decoration: none;
    transition:
      background var(--transition),
      color var(--transition);
  }
  .coming__line a:hover {
    background: color-mix(in oklch, currentColor 10%, transparent);
    color: var(--heading-color);
    text-decoration: none;
  }
  .coming__line--urgent a:hover {
    color: var(--missing-ink);
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
    text-decoration: none;
  }
  @media (pointer: coarse) {
    .tile--end {
      min-block-size: var(--touch-target);
    }
  }
  .coming__far {
    display: inline-block;
    padding: var(--space-2xs) var(--space-xs);
    margin-block: calc(-1 * var(--space-2xs));
    margin-inline: calc(-1 * var(--space-xs));
    border-radius: var(--radius-m);
    color: inherit;
    text-decoration: none;
    transition:
      background var(--transition),
      color var(--transition);
  }
  .coming__far:hover {
    background: color-mix(in oklch, var(--text-color) 4%, transparent);
    color: var(--text-color);
    text-decoration: none;
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
      /* Each tile as tall as what it says (ADR-227): no empty half. */
      align-items: flex-start;
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
    .tile__falta {
      grid-column: 1 / -1;
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
  }
</style>
