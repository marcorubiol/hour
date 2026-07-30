<script lang="ts">
  /**
   * One date-group chip on the month grid — travel chip or date/block card,
   * with its presentation helpers, extracted from MonthGrid verbatim.
   * Deliberately styleless: the hand-tuned `.cal__event*` grammar (shared
   * fill, dashed border, texture, earned radius) lives in MonthGrid's
   * :global block so a gig and a date card can never drift apart.
   *
   * Receives one GROUP (sessions of one block on one day collapse into a
   * single chip — MonthGrid's groupDates) and the run edges MonthGrid
   * derives from the whole month's rows (seriesEdges).
   */
  import { dualTime } from '$lib/datetime';
  import { accentVarFor } from '$lib/utils/accent';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import { dateStatusFamily } from '$lib/date';
  import type { DateEvent, ProjectLite } from '$lib/month-events';

  interface Props {
    /** The day's group — g[0] leads, the rest ride the "+N" count. */
    g: DateEvent[];
    /** seriesEdges(g[0], iso) from MonthGrid — null when the row stands alone. */
    edges: { first: boolean; last: boolean } | null;
    /** Column index in the week row — a run repeats its head on Mondays. */
    di: number;
    viewerTz: string;
    /** i18n hook — the page passes a t()-backed fn; default stays English. */
    dateKindLabel: (kind: string) => string;
    /** Monogram click — opens MonthGrid's identity quick panel (ADR-081). */
    onMarkOpen: (e: MouseEvent, project: ProjectLite | null) => void;
    /**
     * Chip click — opens the edit dialog on the LEAD row of the group.
     * Absent ⇒ the chip stays the inert span it has always been, so a
     * read-only surface never grows a dead affordance.
     *
     * Only sessions of ONE block on ONE day ever group (groupDates), and
     * the lead is the earliest — the "+N" sessions behind it are reached
     * from the agenda, which lists every row on its own line. The month
     * collapses them for space; it doesn't hide them from editing.
     */
    onOpen?: (d: DateEvent) => void;
  }

  let { g, edges, di, viewerTz, dateKindLabel, onMarkOpen, onOpen }: Props = $props();

  let d = $derived(g[0]);
  let more = $derived(g.length - 1);

  function dateTime(
    d: DateEvent,
  ): { primary: string; secondary: string | null; end: string | null } | null {
    if (d.all_day) return null;
    const t = dualTime(d.starts_at, d.venue?.timezone, viewerTz);
    // A day says its hours as a RANGE when it has an end. On a block's
    // continuation cell the range is the ONLY thing there is room for, and
    // "10:00" alone would hide that Wednesday runs four hours longer than
    // Tuesday — which is the whole reason the days are separate rows.
    const end =
      d.ends_at && d.ends_at !== d.starts_at
        ? dualTime(d.ends_at, d.venue?.timezone, viewerTz).primary
        : null;
    return { primary: t.primary, secondary: t.secondary, end };
  }
  function dateText(d: DateEvent): string {
    // "Altres" rows carry their free label; day_off shows its city if any.
    if (d.kind === 'other') return d.label ?? d.title ?? dateKindLabel(d.kind);
    if (d.kind === 'day_off') return d.city ?? d.title ?? '';
    return d.title ?? d.city ?? '';
  }
  function dateTitle(d: DateEvent): string {
    const base = d.title ?? dateKindLabel(d.kind);
    if (d.all_day) return base;
    const t = dualTime(d.starts_at, d.venue?.timezone, viewerTz);
    return t.secondary ? `${base} · ${t.primary} (${t.secondary} yours)` : `${base} · ${t.primary}`;
  }
  function travelText(d: DateEvent): string {
    const place = d.city ?? d.title ?? d.venue_name ?? dateKindLabel(d.kind);
    if (d.travel_direction === 'outbound') return `→ ${place}`;
    if (d.travel_direction === 'return') return `${place} →`;
    if (d.travel_direction === 'leg') return `→ ${place} →`;
    // No stored direction still reads as a trip: lead with the arrow so a
    // bare "Vitoria" can't be mistaken for a place label on some other chip.
    return `→ ${place}`;
  }

  // The chip's second row (venue on top, city underneath). Suppressed when
  // the label ALREADY fell back to the city — a chip never prints the same
  // place twice.
  function dateCity(d: DateEvent): string | null {
    const city = d.city ?? null;
    return city && city !== dateText(d) ? city : null;
  }

  // The ISO code beside the city (Marco, 2026-07-20): two letters are enough
  // to tell a Barcelona from a Bayonne at a glance, and unlike a full country
  // name they cannot wrap the line.
  function dateCountry(d: DateEvent): string | null {
    return d.country ? d.country.toUpperCase() : null;
  }

  /** The hover carries every session's hour — the chip had room for one. */
  function groupTitle(g: DateEvent[]): string {
    if (g.length < 2) return dateTitle(g[0]);
    const times = g.map((x) => dateTime(x)?.primary).filter(Boolean);
    return `${dateTitle(g[0])} · ${times.join(' · ')}`;
  }

  // The shell's attributes, computed once so the button and the span
  // versions cannot drift: the run classes and the family are what the
  // hand-tuned .cal__event grammar keys off, and a chip that loses one
  // when it becomes clickable would break the strip across the week.
  let travel = $derived(d.kind === 'travel_day');
  let chipClass = $derived(
    [
      'cal__event',
      travel ? 'cal__event--travel' : 'cal__event--date',
      !travel && d.kind === 'day_off' ? 'cal__event--off' : '',
      !travel && edges ? 'cal__event--run' : '',
      !travel && edges?.first ? 'cal__event--run-first' : '',
      !travel && edges?.last ? 'cal__event--run-last' : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
  let chipStyle = $derived(d.project ? `--c: ${accentVarFor(d.project)}` : undefined);
  let chipTitle = $derived(travel ? dateTitle(d) : groupTitle(g));
</script>

<!-- One chip body, two shells — PerfChip's pattern. A surface that can edit
     gains a hit layer over the card; one that can't keeps the inert span
     the grid has always had. The card grammar is written once either way. -->
{#snippet body()}
  {#if travel}
    <span class="cal__travel-text">{travelText(d)}</span>{#if d.project}<button type="button" class="cal__markbtn" onclick={(e) => onMarkOpen(e, d.project)}><IdentityMark accent={accentVarFor(d.project)} name={d.project.name} initials={d.project.initials} /></button>{/if}
  {:else}
    {@const time = dateTime(d)}
    {@const city = dateCity(d)}
    {@const cc = dateCountry(d)}
    {@const head = !edges || edges.first || di === 0}
    {#if head}
      <span class="cal__event-top">
        <span class="cal__event-name">{dateText(d)}</span>
        {#if d.project}<button
            type="button"
            class="cal__markbtn"
            onclick={(e) => onMarkOpen(e, d.project)}
          ><IdentityMark
              accent={accentVarFor(d.project)}
              name={d.project.name}
              initials={d.project.initials}
            /></button>{/if}
      </span>
      {#if city || time}
        <span class="cal__event-line">
          <span class="cal__event-city"
            >{city ?? ''}{#if city && cc}<i class="cal__event-cc">{cc}</i>{/if}</span
          >
          {#if time}<span class="cal__event-time"
              >{time.primary}{#if time.end}–{time.end}{/if}{#if more > 0}<i
                  class="cal__event-more">+{more}</i
                >{/if}</span
            >{/if}
        </span>
      {/if}
      <span class="cal__event-kind">{dateKindLabel(d.kind)}</span>
    {:else if time}
      <!-- A continuation day carries only its OWN hours. The block
           said its name at the head; repeating it would print the
           same words across five cells. -->
      <span class="cal__event-line cal__event-line--cont">
        <span class="cal__event-time"
          >{time.primary}{#if time.end}–{time.end}{/if}{#if more > 0}<i
              class="cal__event-more">+{more}</i
            >{/if}</span
        >
      </span>
    {/if}
  {/if}
{/snippet}

{#if onOpen}
  <!-- The open action is an absolutely-positioned SIBLING covering the
       card, not a <button> wrapped around it: the chip already contains
       the monogram button, and the HTML parser closes an open <button>
       the moment it meets a nested one — SSR would tear the card in two.
       The monogram lifts above this layer (z-index) so the identity panel
       (ADR-081) stays reachable from a date chip. -->
  <span
    class="{chipClass} cal__event--openable"
    data-family={dateStatusFamily(d.status)}
    style={chipStyle}
    title={chipTitle}
  ><button
      type="button"
      class="cal__event-hit"
      aria-label={chipTitle}
      onclick={() => onOpen?.(d)}
    ></button>{@render body()}</span>
{:else}
  <span
    class={chipClass}
    data-family={dateStatusFamily(d.status)}
    style={chipStyle}
    title={chipTitle}
  >{@render body()}</span>
{/if}
