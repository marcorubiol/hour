<script lang="ts">
  /**
   * Road sheet document — the render body shared by the operator page
   * (role preview, ADR-041) and the public token page (ADR-047). Pure
   * presentation over an already-filtered projection: the server decides
   * what `sheet` contains, this only draws non-null sections. Mobile-first
   * (read on a phone in a van), print-friendly (pinned to a dressing-room
   * door).
   */

  import JsonKV, { hasJsonContent } from '$lib/components/JsonKV.svelte';
  import ScheduleTable from '$lib/components/ScheduleTable.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import { dayLabel } from '$lib/datetime';
  import { performanceStatusLabel, performanceStatusTone } from '$lib/performance';
  import type { Roadsheet } from '$lib/roadsheet';

  let {
    sheet,
    venueTz = null,
    backHref = null,
  }: {
    sheet: Roadsheet;
    venueTz?: string | null;
    backHref?: string | null;
  } = $props();

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
</script>

<div class="rsv">
  <header class="rsv__head">
    <p class="eyebrow">
      Road sheet{#if sheet.project} · {sheet.project.name}{/if}
    </p>
    <h1 class="rsv__title"><em>{sheet.title}</em></h1>
    <p class="rsv__day">{dayLabel(sheet.performed_at, 'long')}</p>
    <div class="rsv__meta">
      <StateBadge
        label={performanceStatusLabel(sheet.status)}
        tone={performanceStatusTone(sheet.status)}
      />
      {#if sheet.city}
        <span class="rsv__meta-place">{[sheet.city, sheet.country].filter(Boolean).join(', ')}</span>
      {/if}
    </div>
    {#if backHref}
      <p class="rsv__back"><a href={backHref}>← Performance</a></p>
    {/if}
  </header>

  {#if sheet.schedule}
    <section class="rsv__section" aria-label="Schedule">
      <h2 class="rsv__section-title">Schedule</h2>
      <ScheduleTable slots={sheet.schedule} {venueTz} {viewerTz} />
    </section>
  {/if}

  {#if sheet.venue || sheet.venue_name}
    <section class="rsv__section" aria-label="Venue">
      <h2 class="rsv__section-title">Venue</h2>
      <div class="rsv__venue">
        <strong>{sheet.venue?.name ?? sheet.venue_name}</strong>
        {#if sheet.venue?.address}<span>{sheet.venue.address}</span>{/if}
        {#if sheet.city}<span>{[sheet.city, sheet.country].filter(Boolean).join(', ')}</span>{/if}
        {#if sheet.venue?.capacity}<span class="rsv__muted">cap. {sheet.venue.capacity}</span>{/if}
      </div>
      {#if hasJsonContent(sheet.venue?.contacts)}
        <JsonKV value={sheet.venue!.contacts} />
      {/if}
    </section>
  {/if}

  {#if hasJsonContent(sheet.logistics)}
    <section class="rsv__section" aria-label="Logistics">
      <h2 class="rsv__section-title">Logistics</h2>
      <JsonKV value={sheet.logistics} />
    </section>
  {/if}

  {#if hasJsonContent(sheet.hospitality)}
    <section class="rsv__section" aria-label="Hospitality">
      <h2 class="rsv__section-title">Hospitality</h2>
      <JsonKV value={sheet.hospitality} />
    </section>
  {/if}

  {#if hasJsonContent(sheet.technical)}
    <section class="rsv__section" aria-label="Technical">
      <h2 class="rsv__section-title">Technical</h2>
      <JsonKV value={sheet.technical} />
    </section>
  {/if}

  {#if sheet.cast && sheet.cast.length > 0}
    <section class="rsv__section" aria-label="Cast">
      <h2 class="rsv__section-title">Cast</h2>
      <ul class="rsv__people" role="list">
        {#each sheet.cast as m, i (i)}
          <li>
            <span class="rsv__role">{m.role}</span>
            <span class="rsv__name">
              {m.person?.full_name ?? '—'}
              {#if m.replaces}
                <span class="rsv__muted">replaces {m.replaces}{#if m.reason} — {m.reason}{/if}</span>
              {/if}
              {#if m.person?.email || m.person?.phone}
                <span class="rsv__contact">
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
    <section class="rsv__section" aria-label="Crew">
      <h2 class="rsv__section-title">Crew</h2>
      <ul class="rsv__people" role="list">
        {#each sheet.crew as m, i (i)}
          <li>
            <span class="rsv__role">{m.role}</span>
            <span class="rsv__name">
              {m.person?.full_name ?? '—'}
              {#if m.notes}<span class="rsv__muted">{m.notes}</span>{/if}
              {#if m.person?.email || m.person?.phone}
                <span class="rsv__contact">
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
    <section class="rsv__section" aria-label="Programmer">
      <h2 class="rsv__section-title">Programmer</h2>
      <p class="rsv__programmer">
        {sheet.contacts.programmer.full_name}
        {#if sheet.contacts.programmer.email || sheet.contacts.programmer.phone}
          <span class="rsv__contact">
            {[sheet.contacts.programmer.email, sheet.contacts.programmer.phone]
              .filter(Boolean)
              .join(' · ')}
          </span>
        {/if}
      </p>
    </section>
  {/if}

  {#if sheet.assets && sheet.assets.length > 0}
    <section class="rsv__section" aria-label="Assets">
      <h2 class="rsv__section-title">Assets</h2>
      <ul class="rsv__people" role="list">
        {#each sheet.assets as a, i (i)}
          <li>
            <span class="rsv__role">{a.direction}</span>
            <span class="rsv__name">{a.kind.replace(/_/g, ' ')}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if sheet.notes}
    <section class="rsv__section" aria-label="Notes">
      <h2 class="rsv__section-title">Notes</h2>
      <p class="rsv__notes">{sheet.notes}</p>
    </section>
  {/if}
</div>

<style>
  @layer components {
    .rsv {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
    }

    .rsv__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      padding-block-end: var(--space-m);
      border-block-end: 1px solid var(--border-color-light);
    }

    .rsv__title {
      font-family: var(--font-display);
      font-size: clamp(1.6rem, 3vw, 2.2rem);
      font-weight: 400;
      letter-spacing: -0.02em;
      line-height: 1.05;
      color: var(--text-color);
    }
    .rsv__title em {
      font-style: italic;
    }

    .rsv__day {
      font-size: var(--text-m);
      color: var(--text-muted);
    }

    .rsv__meta {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
    }

    .rsv__meta-place {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
    }

    .rsv__back {
      font-size: var(--text-s);
    }

    .rsv__section {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .rsv__section-title {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 500;
      color: var(--text-faint);
    }

    .rsv__venue {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      font-size: var(--text-s);
      color: var(--text-color);
    }

    .rsv__people li {
      display: flex;
      gap: var(--space-m);
      align-items: baseline;
      padding-block: var(--space-xs);
      border-block-end: 1px solid var(--border-color-light);
    }

    .rsv__role {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
      min-inline-size: 7rem;
    }

    .rsv__name {
      font-size: var(--text-s);
      color: var(--text-color);
    }

    .rsv__muted {
      display: block;
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .rsv__contact {
      display: block;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .rsv__programmer {
      font-size: var(--text-s);
    }

    .rsv__notes {
      font-size: var(--text-s);
      white-space: pre-wrap;
      line-height: 1.55;
    }

    @media print {
      .rsv__back {
        display: none;
      }
    }
  }
</style>
