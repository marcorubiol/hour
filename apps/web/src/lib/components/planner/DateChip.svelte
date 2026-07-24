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
  }

  let { g, edges, di, viewerTz, dateKindLabel, onMarkOpen }: Props = $props();

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
</script>

{#if d.kind === 'travel_day'}
  <span
    class="cal__event cal__event--travel"
    data-family={dateStatusFamily(d.status)}
    style={d.project ? `--c: ${accentVarFor(d.project)}` : undefined}
    title={dateTitle(d)}
  ><span class="cal__travel-text">{travelText(d)}</span>{#if d.project}<button type="button" class="cal__markbtn" onclick={(e) => onMarkOpen(e, d.project)}><IdentityMark accent={accentVarFor(d.project)} name={d.project.name} initials={d.project.initials} /></button>{/if}</span>
{:else}
  {@const time = dateTime(d)}
  {@const city = dateCity(d)}
  {@const cc = dateCountry(d)}
  {@const head = !edges || edges.first || di === 0}
  <span
    class="cal__event cal__event--date"
    class:cal__event--off={d.kind === 'day_off'}
    class:cal__event--run={!!edges}
    class:cal__event--run-first={edges?.first}
    class:cal__event--run-last={edges?.last}
    data-family={dateStatusFamily(d.status)}
    style={d.project ? `--c: ${accentVarFor(d.project)}` : undefined}
    title={groupTitle(g)}
  >
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
  </span>
{/if}
