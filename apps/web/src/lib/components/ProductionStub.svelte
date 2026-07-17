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

  interface VenueContact {
    name?: string;
    role?: string | null;
    email?: string | null;
    phone?: string | null;
  }

  interface VenueBlock {
    name: string;
    city: string | null;
    country: string | null;
    address: string | null;
    capacity: number | null;
    timezone: string | null;
    /** venue.contacts jsonb (ADR-053) — tolerated loose: legacy rows may
     * hold anything, so entries without a name are skipped. */
    contacts?: Json;
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
    /** Home-space timezone — the schedule's primary zone when the venue
        has none (timezone rule: entry and display must agree; never
        silently the browser's). */
    fallbackTz?: string | null;
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
    fallbackTz = null,
  }: Props = $props();

  // The venue meta line shows only the venue's OWN timezone; the schedule
  // falls back to the home space's so display matches the entry zone.
  let venueTz = $derived(venue?.timezone ?? null);
  let scheduleTz = $derived(venue?.timezone ?? fallbackTz ?? null);

  let venueContacts = $derived.by((): VenueContact[] => {
    const raw = venue?.contacts;
    if (!Array.isArray(raw)) return [];
    const rows: VenueContact[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
      const c = entry as Record<string, Json | undefined>;
      if (typeof c.name !== 'string' || c.name === '') continue;
      rows.push({
        name: c.name,
        role: typeof c.role === 'string' ? c.role : null,
        email: typeof c.email === 'string' ? c.email : null,
        phone: typeof c.phone === 'string' ? c.phone : null,
      });
    }
    return rows;
  });

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
    {#if venue?.name ?? venueName}
      <strong class="production__venue-name">{venue?.name ?? venueName}</strong>
    {:else}
      <p class="production__empty">No venue yet.</p>
    {/if}
    {#if placeLine}<span class="production__venue-place">{placeLine}</span>{/if}
    {#if venue?.address}<span class="production__venue-address">{venue.address}</span>{/if}
    <span class="production__venue-meta">
      {#if venue?.capacity}cap. {venue.capacity}{/if}
      {#if venue?.capacity && venueTz} · {/if}
      {#if venueTz}{venueTz}{/if}
    </span>
    {#if venueContacts.length > 0}
      <ul class="production__contacts" role="list">
        {#each venueContacts as c, i (i)}
          <li>
            <span class="production__contact-name">{c.name}</span>
            {#if c.role}<span class="production__contact-role">{c.role}</span>{/if}
            {#if c.phone}<a href={`tel:${c.phone}`}>{c.phone}</a>{/if}
            {#if c.email}<a href={`mailto:${c.email}`}>{c.email}</a>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <ScheduleTable
    slots={{
      load_in_at: loadInAt,
      soundcheck_at: soundcheckAt,
      start_at: startAt,
      loadout_at: loadoutAt,
      wrap_at: wrapAt,
    }}
    venueTz={scheduleTz}
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

    .production__empty {
      margin: 0;
      font-size: var(--text-s);
      color: var(--text-faint);
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

    .production__contacts {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      margin-block-start: var(--space-xs);
    }

    .production__contacts li {
      display: flex;
      gap: var(--space-s);
      align-items: baseline;
      font-size: var(--text-s);
      flex-wrap: wrap;
    }

    .production__contact-name {
      color: var(--text-color);
    }

    .production__contact-role {
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
