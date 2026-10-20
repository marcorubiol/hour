<script lang="ts">
  /**
   * ProductionStub — production block for Performance detail (Phase 0.1
   * trabajo #5): venue, schedule (5 timeslots, dual-timezone per
   * D-PRE-10), and the three jsonb summaries (logistics / hospitality /
   * technical) rendered generically via JsonKV.
   *
   * The venue's NAME is not drawn: the record's title already is the venue
   * (ADR-139 p2, «la sala sale tres veces»). What is left is what the title
   * does not say: where it is, how to reach it, who to call.
   */

  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import type { Snippet } from 'svelte';
  import type { Json } from '$lib/db-types';
  import { appLocale, t, type Locale } from '$lib/i18n';
  import JsonKV, { hasJsonContent } from './JsonKV.svelte';
  import JsonKVEdit from './JsonKVEdit.svelte';
  import type { KVObject } from '$lib/kv-lines';
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
    /**
     * The running order, when the host draws it (ADR-090 P3: the detail page
     * hosts the same `RunningOrder` as the Planner's day, so there is one
     * way to write an hour in the whole app). Without it the block falls back
     * to the read-only five (the playground).
     */
    schedule?: Snippet;
    /** False where the host draws the running order elsewhere (the record
        puts the day's plan above its details): no schedule here at all. */
    withSchedule?: boolean;
    /** The reader's language; defaults to the session's. */
    locale?: Locale;
    /**
     * Where the three columns are written (the record, Marco 2026-10-20):
     * with it, each is drawn even when empty, a line at a time
     * (`JsonKVEdit`). Without it, only what has content, read-only.
     */
    saveJson?: (field: JsonField, next: KVObject) => Promise<void>;
  }

  type JsonField = 'logistics' | 'hospitality' | 'technical';

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
    schedule,
    withSchedule = true,
    locale = appLocale(),
    saveJson,
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

  let jsonColumns = $derived(
    [
      ['logistics', t('perf.logistics', locale), logistics],
      ['hospitality', t('perf.hospitality', locale), hospitality],
      ['technical', t('perf.technical', locale), technical],
    ] as const,
  );
  let jsonSections = $derived(jsonColumns.filter(([, , v]) => hasJsonContent(v)));
</script>

<section class="production" aria-label={t('perf.production', locale)}>
  <BlockHead title={t('perf.production', locale)} />

  <div class="production__venue">
    {#if !(venue?.name ?? venueName)}
      <EmptyLine text={t('venue.none_yet', locale)} />
    {/if}
    {#if venue?.address}<span class="production__venue-address">{venue.address}</span>{/if}
    <span class="production__venue-meta">
      {#if venue?.capacity}{t('venue.capacity_short', locale, { n: venue.capacity })}{/if}
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

  {#if !withSchedule}
    <!-- the host draws the running order -->
  {:else if schedule}
    {@render schedule()}
  {:else}
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
    {locale}
  />
  {/if}

  {#if saveJson}
    {#each jsonColumns as [field, label, value] (field)}
      <JsonKVEdit title={label} {value} idBase="perf-{field}" save={(next) => saveJson(field, next)} {locale} />
    {/each}
  {:else}
    {#each jsonSections as [field, label, value] (field)}
      <div class="production__section">
        <BlockHead title={label} level={3} />
        <JsonKV {value} />
      </div>
    {/each}
  {/if}
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

    .production__section {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
  }
</style>
