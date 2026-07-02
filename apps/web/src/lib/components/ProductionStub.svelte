<script lang="ts">
  /**
   * ProductionStub — production block for Performance detail (Phase 0.1
   * trabajo #5): venue, schedule (5 timeslots, dual-timezone per
   * D-PRE-10), and the three jsonb summaries (logistics / hospitality /
   * technical) rendered generically via JsonKV.
   */

  import type { Json } from '$lib/db-types';
  import JsonKV, { hasJsonContent } from './JsonKV.svelte';
  import ScheduleTable from './ScheduleTable.svelte';

  interface VenueBlock {
    name: string;
    city: string | null;
    country: string | null;
    address: string | null;
    capacity: number | null;
    timezone: string | null;
  }

  interface Props {
    venue: VenueBlock | null;
    /** Denormalized fallback when no venue row is linked. */
    venueName?: string | null;
    city?: string | null;
    country?: string | null;
    loadInAt?: string | null;
    soundcheckAt?: string | null;
    startAt?: string | null;
    loadoutAt?: string | null;
    wrapAt?: string | null;
    logistics?: Json;
    hospitality?: Json;
    technical?: Json;
    /** Viewer IANA timezone (defaults resolved by the page). */
    viewerTz: string;
  }

  let {
    venue,
    venueName = null,
    city = null,
    country = null,
    loadInAt = null,
    soundcheckAt = null,
    startAt = null,
    loadoutAt = null,
    wrapAt = null,
    logistics = {},
    hospitality = {},
    technical = {},
    viewerTz,
  }: Props = $props();

  let venueTz = $derived(venue?.timezone ?? null);

  let placeLine = $derived(
    [venue?.city ?? city, venue?.country ?? country].filter(Boolean).join(', '),
  );

  let jsonSections = $derived(
    (
      [
        ['Logistics', logistics],
        ['Hospitality', hospitality],
        ['Technical', technical],
      ] as const
    ).filter(([, v]) => hasJsonContent(v)),
  );
</script>

<section class="production" aria-label="Production">
  <header class="production__header">
    <p class="eyebrow">Production</p>
  </header>

  <div class="production__venue">
    <strong class="production__venue-name">{venue?.name ?? venueName ?? 'No venue yet'}</strong>
    {#if placeLine}<span class="production__venue-place">{placeLine}</span>{/if}
    {#if venue?.address}<span class="production__venue-address">{venue.address}</span>{/if}
    <span class="production__venue-meta">
      {#if venue?.capacity}cap. {venue.capacity}{/if}
      {#if venue?.capacity && venueTz} · {/if}
      {#if venueTz}{venueTz}{/if}
    </span>
  </div>

  <ScheduleTable
    slots={{
      load_in_at: loadInAt,
      soundcheck_at: soundcheckAt,
      start_at: startAt,
      loadout_at: loadoutAt,
      wrap_at: wrapAt,
    }}
    {venueTz}
    {viewerTz}
  />

  {#each jsonSections as [label, value] (label)}
    <details class="production__section" open>
      <summary>{label}</summary>
      <JsonKV {value} />
    </details>
  {/each}
</section>

<style>
  @layer components {
    .production {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }

    .production__venue {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }

    .production__venue-name {
      font-size: var(--text-l);
      color: var(--text-color);
      font-weight: 500;
    }

    .production__venue-place {
      font-size: var(--text-s);
      color: var(--text-muted);
    }

    .production__venue-address {
      font-size: var(--text-s);
      color: var(--text-muted);
    }

    .production__venue-meta {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
    }

    .production__section summary {
      cursor: pointer;
      font-size: var(--text-s);
      color: var(--text-muted);
      margin-block-end: var(--space-xs);
    }
  }
</style>
