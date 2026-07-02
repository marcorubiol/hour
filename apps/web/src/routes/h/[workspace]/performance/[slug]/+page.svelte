<script lang="ts">
  /**
   * Performance detail — Phase 0.1 trabajo #3, mobile-first (single
   * column; wide screens get breathing room, not a second column).
   *
   * Data: GET /api/performances/:slug?ws=<workspace> — the full bundle
   * (venue, schedule, jsonb, crew, cast, dates, assets, programmer).
   * The road sheet sub-view (ADR-023) links from the header.
   */

  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import ProductionStub from '$lib/components/ProductionStub.svelte';
  import type { Json } from '$lib/db-types';
  import { dayLabel } from '$lib/datetime';
  import { performanceStatusLabel, performanceStatusTone } from '$lib/performance';

  type PersonEmbed = {
    id: string;
    slug: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    organization_name?: string | null;
  };

  type Bundle = {
    performance: {
      id: string;
      slug: string | null;
      performed_at: string;
      status: string;
      venue_name: string | null;
      city: string | null;
      country: string | null;
      notes: string | null;
      load_in_at: string | null;
      soundcheck_at: string | null;
      start_at: string | null;
      loadout_at: string | null;
      wrap_at: string | null;
      logistics: Json;
      hospitality: Json;
      technical: Json;
      venue: {
        id: string;
        slug: string | null;
        name: string;
        city: string | null;
        country: string | null;
        address: string | null;
        capacity: number | null;
        timezone: string | null;
      } | null;
      line: { id: string; slug: string; name: string; kind: string } | null;
      project: { id: string; slug: string; name: string; accent: string | null } | null;
      engagement: {
        id: string;
        slug: string;
        status: string;
        person: PersonEmbed | null;
      } | null;
      crew_assignment: Array<{
        id: string;
        role: string;
        notes: string | null;
        person: PersonEmbed | null;
      }>;
      cast_override: Array<{
        id: string;
        role: string;
        reason: string | null;
        person: PersonEmbed | null;
        replaces_person: { id: string; full_name: string } | null;
      }>;
      date: Array<{
        id: string;
        kind: string;
        status: string;
        title: string | null;
        starts_at: string;
        ends_at: string | null;
        all_day: boolean;
        venue_name: string | null;
        city: string | null;
      }>;
      asset_version: Array<{
        id: string;
        kind: string;
        direction: string;
        notes: string | null;
        uploaded_at: string | null;
      }>;
    };
    cast_members: Array<{
      id: string;
      role: string;
      notes: string | null;
      person: PersonEmbed | null;
    }>;
  };

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let slug = $derived(page.params.slug ?? '');

  const queryOptions = toStore(() => {
    const k = { ws: workspaceSlug, slug };
    return {
      queryKey: ['performance', k] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<Bundle>(
          `/api/performances/${encodeURIComponent(k.slug)}?ws=${encodeURIComponent(k.ws)}`,
          signal,
        ),
    };
  });

  const query = createQuery(queryOptions);

  let bundle = $derived($query.data ?? null);
  let perf = $derived(bundle?.performance ?? null);
  let loading = $derived($query.isPending);
  let errorMsg = $derived($query.error instanceof Error ? $query.error.message : '');

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  let title = $derived(
    perf?.venue?.name ?? perf?.venue_name ?? perf?.project?.name ?? slug,
  );
  let placeLine = $derived(
    perf
      ? [perf.venue?.city ?? perf.city, perf.venue?.country ?? perf.country]
          .filter(Boolean)
          .join(', ')
      : '',
  );

  function formatDateRow(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
    });
  }

  let hasTeam = $derived(
    (bundle?.cast_members.length ?? 0) > 0 ||
      (perf?.cast_override.length ?? 0) > 0 ||
      (perf?.crew_assignment.length ?? 0) > 0,
  );
</script>

<svelte:head>
  <title>{title} — Performance — Hour</title>
</svelte:head>

<article class="perf">
  {#if loading}
    <p class="perf__state">Loading…</p>
  {:else if errorMsg}
    <p class="perf__state perf__state--danger">{errorMsg}</p>
  {:else if perf}
    <header class="perf__head">
      <p class="eyebrow">
        Performance
        {#if perf.project}
          · <a href={`/h/${workspaceSlug}/project/${perf.project.slug}`}>{perf.project.name}</a>
        {/if}
        {#if perf.line}
          · {perf.line.name}
        {/if}
      </p>
      <h1 class="perf__title"><em>{title}</em></h1>
      <div class="perf__meta">
        <StateBadge
          label={performanceStatusLabel(perf.status)}
          tone={performanceStatusTone(perf.status)}
        />
        <span class="perf__meta-sep" aria-hidden="true">·</span>
        <span class="perf__meta-date">{dayLabel(perf.performed_at, 'short')}</span>
        {#if placeLine}
          <span class="perf__meta-sep" aria-hidden="true">·</span>
          <span class="perf__meta-place">{placeLine}</span>
        {/if}
      </div>
      <p class="perf__roadsheet-link">
        <a href={`/h/${workspaceSlug}/performance/${slug}/roadsheet`}>Open road sheet →</a>
      </p>
    </header>

    <ProductionStub
      venue={perf.venue}
      venueName={perf.venue_name}
      city={perf.city}
      country={perf.country}
      loadInAt={perf.load_in_at}
      soundcheckAt={perf.soundcheck_at}
      startAt={perf.start_at}
      loadoutAt={perf.loadout_at}
      wrapAt={perf.wrap_at}
      logistics={perf.logistics}
      hospitality={perf.hospitality}
      technical={perf.technical}
      {viewerTz}
    />

    {#if hasTeam}
      <section class="perf__section" aria-label="Team">
        <p class="eyebrow">Team</p>
        <ul class="perf__people" role="list">
          {#each bundle!.cast_members as m (m.id)}
            <li>
              <span class="perf__person-role">cast · {m.role}</span>
              <span class="perf__person-name">{m.person?.full_name ?? '—'}</span>
            </li>
          {/each}
          {#each perf.cast_override as o (o.id)}
            <li>
              <span class="perf__person-role">cast · {o.role}</span>
              <span class="perf__person-name">
                {o.person?.full_name ?? '—'}
                {#if o.replaces_person}
                  <span class="perf__person-note">
                    replaces {o.replaces_person.full_name}{#if o.reason} — {o.reason}{/if}
                  </span>
                {/if}
              </span>
            </li>
          {/each}
          {#each perf.crew_assignment as c (c.id)}
            <li>
              <span class="perf__person-role">crew · {c.role}</span>
              <span class="perf__person-name">
                {c.person?.full_name ?? '—'}
                {#if c.notes}<span class="perf__person-note">{c.notes}</span>{/if}
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if perf.date.length > 0}
      <section class="perf__section" aria-label="Related dates">
        <p class="eyebrow">Dates</p>
        <ul class="perf__dates" role="list">
          {#each perf.date as d (d.id)}
            <li>
              <span class="perf__date-when">{formatDateRow(d.starts_at)}</span>
              <span class="perf__date-kind">{d.kind.replace(/_/g, ' ')}</span>
              <span class="perf__date-title">{d.title ?? ''}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if perf.engagement?.person}
      <section class="perf__section" aria-label="Programmer">
        <p class="eyebrow">Programmer</p>
        <p class="perf__programmer">
          <a href={`/h/${workspaceSlug}/person/${perf.engagement.person.slug}`}>
            {perf.engagement.person.full_name}
          </a>
          {#if perf.engagement.person.organization_name}
            <span class="perf__person-note">{perf.engagement.person.organization_name}</span>
          {/if}
        </p>
      </section>
    {/if}

    {#if perf.asset_version.length > 0}
      <section class="perf__section" aria-label="Assets">
        <p class="eyebrow">Assets</p>
        <ul class="perf__assets" role="list">
          {#each perf.asset_version as a (a.id)}
            <li>
              <span class="perf__asset-dir">{a.direction}</span>
              <span class="perf__asset-kind">{a.kind.replace(/_/g, ' ')}</span>
              <span class="perf__person-note">registered — upload arrives Phase 0.3+</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if perf.notes}
      <section class="perf__section" aria-label="Notes">
        <p class="eyebrow">Notes</p>
        <p class="perf__notes">{perf.notes}</p>
      </section>
    {/if}
  {/if}
</article>

<style>
  @layer components {
    .perf {
      display: flex;
      flex-direction: column;
      gap: var(--space-xl);
      max-inline-size: 44rem;
      margin-inline: auto;
    }

    .perf__state {
      padding-block: var(--space-l);
      font-size: var(--text-s);
      color: var(--text-faint);
    }
    .perf__state--danger {
      color: var(--danger);
    }

    .perf__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding-block-end: var(--space-m);
      border-block-end: 1px solid var(--border-color-light);
    }

    .perf__title {
      font-family: var(--font-display);
      font-size: clamp(1.8rem, 3vw, 2.4rem);
      font-weight: 400;
      letter-spacing: -0.025em;
      line-height: 1.05;
      color: var(--text-color);
    }
    .perf__title em {
      font-style: italic;
    }

    .perf__meta {
      display: flex;
      align-items: baseline;
      gap: var(--space-xs);
      flex-wrap: wrap;
    }

    .perf__meta-sep {
      color: var(--text-faint);
    }

    .perf__meta-date,
    .perf__meta-place {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
    }

    .perf__roadsheet-link {
      font-size: var(--text-s);
    }

    .perf__section {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }


    .perf__people li,
    .perf__dates li,
    .perf__assets li {
      display: flex;
      gap: var(--space-m);
      align-items: baseline;
      padding-block: var(--space-xs);
      border-block-end: 1px solid var(--border-color-light);
    }

    .perf__person-role,
    .perf__date-kind,
    .perf__asset-dir {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
      min-inline-size: 8rem;
    }

    .perf__person-name,
    .perf__date-title,
    .perf__asset-kind {
      font-size: var(--text-s);
      color: var(--text-color);
    }

    .perf__person-note {
      display: block;
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .perf__date-when {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
      min-inline-size: 4rem;
    }

    .perf__programmer {
      font-size: var(--text-s);
    }

    .perf__notes {
      font-size: var(--text-s);
      color: var(--text-color);
      white-space: pre-wrap;
      line-height: 1.55;
    }
  }
</style>
