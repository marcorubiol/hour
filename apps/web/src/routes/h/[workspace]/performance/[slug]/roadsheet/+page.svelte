<script lang="ts">
  /**
   * Road sheet — read-only role-filtered projection (ADR-023 / ADR-041).
   * Mobile-first: it gets read on a phone in a van. Print-friendly: it
   * gets pinned to a dressing-room door.
   *
   * The role pills are an OPERATOR PREVIEW — filtering happens server-side
   * per request, so switching roles refetches; the browser never holds
   * hidden sections. Collaborative editing of notes (CRDT, ADR-025) is
   * deliberately NOT wired yet — it needs two live clients to verify.
   */

  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import Pill from '$lib/components/Pill.svelte';
  import JsonKV, { hasJsonContent } from '$lib/components/JsonKV.svelte';
  import ScheduleTable from '$lib/components/ScheduleTable.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import { dayLabel } from '$lib/datetime';
  import { performanceStatusLabel, performanceStatusTone } from '$lib/performance';
  import { ROADSHEET_ROLES, type Roadsheet, type RoadsheetRole } from '$lib/roadsheet';

  type Response = { roadsheet: Roadsheet; venue_timezone: string | null };

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let slug = $derived(page.params.slug ?? '');
  let role = $state<RoadsheetRole>('full');

  const queryOptions = toStore(() => {
    const k = { ws: workspaceSlug, slug, role };
    return {
      queryKey: ['roadsheet', k] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<Response>(
          `/api/performances/${encodeURIComponent(k.slug)}/roadsheet?ws=${encodeURIComponent(k.ws)}&role=${k.role}`,
          signal,
        ),
    };
  });

  const query = createQuery(queryOptions);

  let sheet = $derived($query.data?.roadsheet ?? null);
  let venueTz = $derived($query.data?.venue_timezone ?? null);
  let loading = $derived($query.isPending);
  let errorMsg = $derived($query.error instanceof Error ? $query.error.message : '');

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

</script>

<svelte:head>
  <title>{sheet ? `${sheet.title} — Road sheet` : 'Road sheet'} — Hour</title>
</svelte:head>

<article class="rs">
  <nav class="rs__roles" aria-label="Preview as role">
    <span class="rs__roles-label">View as</span>
    {#each ROADSHEET_ROLES as r (r)}
      <Pill size="sm" active={role === r} onclick={() => (role = r)}>
        {r.replace(/_/g, ' ')}
      </Pill>
    {/each}
  </nav>

  {#if loading}
    <p class="rs__state">Loading…</p>
  {:else if errorMsg}
    <p class="rs__state rs__state--danger">{errorMsg}</p>
  {:else if sheet}
    <header class="rs__head">
      <p class="eyebrow">
        Road sheet{#if sheet.project} · {sheet.project.name}{/if}
      </p>
      <h1 class="rs__title"><em>{sheet.title}</em></h1>
      <p class="rs__day">{dayLabel(sheet.performed_at, 'long')}</p>
      <div class="rs__meta">
        <StateBadge
          label={performanceStatusLabel(sheet.status)}
          tone={performanceStatusTone(sheet.status)}
        />
        {#if sheet.city}
          <span class="rs__meta-place">{[sheet.city, sheet.country].filter(Boolean).join(', ')}</span>
        {/if}
      </div>
      <p class="rs__back">
        <a href={`/h/${workspaceSlug}/performance/${slug}`}>← Performance</a>
      </p>
    </header>

    {#if sheet.schedule}
      <section class="rs__section" aria-label="Schedule">
        <h2 class="rs__section-title">Schedule</h2>
        <ScheduleTable slots={sheet.schedule} {venueTz} {viewerTz} />
      </section>
    {/if}

    {#if sheet.venue || sheet.venue_name}
      <section class="rs__section" aria-label="Venue">
        <h2 class="rs__section-title">Venue</h2>
        <div class="rs__venue">
          <strong>{sheet.venue?.name ?? sheet.venue_name}</strong>
          {#if sheet.venue?.address}<span>{sheet.venue.address}</span>{/if}
          {#if sheet.city}<span>{[sheet.city, sheet.country].filter(Boolean).join(', ')}</span>{/if}
          {#if sheet.venue?.capacity}<span class="rs__muted">cap. {sheet.venue.capacity}</span>{/if}
        </div>
        {#if hasJsonContent(sheet.venue?.contacts)}
          <JsonKV value={sheet.venue!.contacts} />
        {/if}
      </section>
    {/if}

    {#if hasJsonContent(sheet.logistics)}
      <section class="rs__section" aria-label="Logistics">
        <h2 class="rs__section-title">Logistics</h2>
        <JsonKV value={sheet.logistics} />
      </section>
    {/if}

    {#if hasJsonContent(sheet.hospitality)}
      <section class="rs__section" aria-label="Hospitality">
        <h2 class="rs__section-title">Hospitality</h2>
        <JsonKV value={sheet.hospitality} />
      </section>
    {/if}

    {#if hasJsonContent(sheet.technical)}
      <section class="rs__section" aria-label="Technical">
        <h2 class="rs__section-title">Technical</h2>
        <JsonKV value={sheet.technical} />
      </section>
    {/if}

    {#if sheet.cast && sheet.cast.length > 0}
      <section class="rs__section" aria-label="Cast">
        <h2 class="rs__section-title">Cast</h2>
        <ul class="rs__people" role="list">
          {#each sheet.cast as m, i (i)}
            <li>
              <span class="rs__role">{m.role}</span>
              <span class="rs__name">
                {m.person?.full_name ?? '—'}
                {#if m.replaces}
                  <span class="rs__muted">replaces {m.replaces}{#if m.reason} — {m.reason}{/if}</span>
                {/if}
                {#if m.person?.email || m.person?.phone}
                  <span class="rs__contact">
                    {[m.person?.email, m.person?.phone].filter(Boolean).join(' · ')}
                  </span>
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if sheet.crew && sheet.crew.length > 0}
      <section class="rs__section" aria-label="Crew">
        <h2 class="rs__section-title">Crew</h2>
        <ul class="rs__people" role="list">
          {#each sheet.crew as m, i (i)}
            <li>
              <span class="rs__role">{m.role}</span>
              <span class="rs__name">
                {m.person?.full_name ?? '—'}
                {#if m.notes}<span class="rs__muted">{m.notes}</span>{/if}
                {#if m.person?.email || m.person?.phone}
                  <span class="rs__contact">
                    {[m.person?.email, m.person?.phone].filter(Boolean).join(' · ')}
                  </span>
                {/if}
                {#if hasJsonContent(m.contact_override)}
                  <JsonKV value={m.contact_override!} />
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if sheet.contacts}
      <section class="rs__section" aria-label="Programmer">
        <h2 class="rs__section-title">Programmer</h2>
        <p class="rs__programmer">
          {sheet.contacts.programmer.full_name}
          {#if sheet.contacts.programmer.email || sheet.contacts.programmer.phone}
            <span class="rs__contact">
              {[sheet.contacts.programmer.email, sheet.contacts.programmer.phone]
                .filter(Boolean)
                .join(' · ')}
            </span>
          {/if}
        </p>
      </section>
    {/if}

    {#if sheet.assets && sheet.assets.length > 0}
      <section class="rs__section" aria-label="Assets">
        <h2 class="rs__section-title">Assets</h2>
        <ul class="rs__people" role="list">
          {#each sheet.assets as a, i (i)}
            <li>
              <span class="rs__role">{a.direction}</span>
              <span class="rs__name">{a.kind.replace(/_/g, ' ')}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if sheet.notes}
      <section class="rs__section" aria-label="Notes">
        <h2 class="rs__section-title">Notes</h2>
        <p class="rs__notes">{sheet.notes}</p>
      </section>
    {/if}
  {/if}
</article>

<style>
  @layer components {
    .rs {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
      max-inline-size: 40rem;
      margin-inline: auto;
    }

    .rs__roles {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      flex-wrap: wrap;
    }

    .rs__roles-label {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
    }

    .rs__state {
      padding-block: var(--space-l);
      font-size: var(--text-s);
      color: var(--text-faint);
    }
    .rs__state--danger {
      color: var(--danger);
    }

    .rs__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      padding-block-end: var(--space-m);
      border-block-end: 1px solid var(--border-color-light);
    }

    .rs__title {
      font-family: var(--font-display);
      font-size: clamp(1.6rem, 3vw, 2.2rem);
      font-weight: 400;
      letter-spacing: -0.02em;
      line-height: 1.05;
      color: var(--text-color);
    }
    .rs__title em {
      font-style: italic;
    }

    .rs__day {
      font-size: var(--text-m);
      color: var(--text-muted);
    }

    .rs__meta {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
    }

    .rs__meta-place {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
    }

    .rs__back {
      font-size: var(--text-s);
    }

    .rs__section {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .rs__section-title {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 500;
      color: var(--text-faint);
    }

    .rs__venue {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      font-size: var(--text-s);
      color: var(--text-color);
    }

    .rs__people li {
      display: flex;
      gap: var(--space-m);
      align-items: baseline;
      padding-block: var(--space-xs);
      border-block-end: 1px solid var(--border-color-light);
    }

    .rs__role {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
      min-inline-size: 7rem;
    }

    .rs__name {
      font-size: var(--text-s);
      color: var(--text-color);
    }

    .rs__muted {
      display: block;
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .rs__contact {
      display: block;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .rs__programmer {
      font-size: var(--text-s);
    }

    .rs__notes {
      font-size: var(--text-s);
      white-space: pre-wrap;
      line-height: 1.55;
    }

    /* Print: drop the operator chrome, keep the document. */
    @media print {
      .rs__roles,
      .rs__back {
        display: none;
      }
      .rs {
        max-inline-size: none;
      }
    }
  }
</style>
