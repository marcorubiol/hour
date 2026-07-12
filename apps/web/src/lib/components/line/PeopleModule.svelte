<script lang="ts">
  /**
   * People module (ADR-056 v1) — the line's read-only contact sheet:
   * your own team on the road plus the venue folks, per performance.
   * Content-only; the line detail shell owns the module frame and title.
   *
   * Zero writes on purpose: every datum here is edited where it already
   * lives — cast on the project, crew on the performance, contacts on
   * the venue dialog. This module only gathers them in one place.
   */

  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import { dayLabel } from '$lib/datetime';

  type PersonLite = {
    id: string;
    slug: string | null;
    full_name: string;
    email: string | null;
    phone: string | null;
  };

  type LinePeople = {
    cast: Array<{
      id: string;
      role: string;
      notes: string | null;
      person: PersonLite | null;
    }>;
    crew: Array<{
      id: string;
      role: string;
      notes: string | null;
      person: PersonLite | null;
      performance: {
        id: string;
        slug: string | null;
        performed_at: string;
        venue_name: string | null;
        city: string | null;
      } | null;
    }>;
    venues: Array<{
      venue: { id: string; name: string; city: string | null };
      contacts: Array<{
        name: string | null;
        role: string | null;
        email: string | null;
        phone: string | null;
      }>;
      performances: Array<{ id: string; slug: string | null; performed_at: string }>;
    }>;
  };

  let {
    line,
    workspaceSlug,
  }: {
    line: {
      id: string;
      slug: string | null;
      name: string;
      kind: string;
      project_id: string;
      workspace_id: string;
    };
    workspaceSlug: string;
  } = $props();

  const peopleOptions = toStore(() => {
    const id = line.id;
    return {
      queryKey: ['line-people', id] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<LinePeople>(`/api/lines/${id}/people`, signal),
    };
  });
  const peopleQuery = createQuery(peopleOptions);

  let people = $derived($peopleQuery.data ?? null);
  let loading = $derived($peopleQuery.isPending);
  let errorMsg = $derived($peopleQuery.error instanceof Error ? $peopleQuery.error.message : '');

  // Venue contacts arrive as parsed rows that may still be all-empty
  // (blank editor rows saved on the venue). Keep only contacts with at
  // least one filled field, then skip venues left with none.
  let venueGroups = $derived.by(() =>
    (people?.venues ?? [])
      .map((v) => ({
        venue: v.venue,
        contacts: v.contacts.filter((c) => c.name || c.role || c.email || c.phone),
      }))
      .filter((g) => g.contacts.length > 0),
  );
</script>

{#if loading}
  <p class="ppl__state">Loading…</p>
{:else if errorMsg}
  <p class="ppl__state ppl__state--danger">{errorMsg}</p>
{:else if people}
  <div class="ppl">
    <section class="ppl__section" aria-label="Own team">
      <p class="ppl__sub">Own team</p>
      {#if people.cast.length > 0}
        <ul class="ppl__rows" role="list">
          {#each people.cast as c (c.id)}
            <li>
              <span class="ppl__row-main">
                {#if c.person?.slug}
                  <a href={`/h/${workspaceSlug}/person/${c.person.slug}`}>{c.person.full_name}</a>
                {:else}
                  {c.person?.full_name ?? '—'}
                {/if}
                <span class="ppl__row-role">{c.role}</span>
              </span>
              {#if c.person && (c.person.email || c.person.phone)}
                <span class="ppl__row-contact">
                  {#if c.person.email}
                    <a href={`mailto:${c.person.email}`}>{c.person.email}</a>
                  {/if}
                  {#if c.person.phone}
                    <a href={`tel:${c.person.phone}`}>{c.person.phone}</a>
                  {/if}
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="ppl__state">No canonical team on this project yet.</p>
      {/if}
    </section>

    <section class="ppl__section" aria-label="Crew">
      <p class="ppl__sub">Crew</p>
      {#if people.crew.length > 0}
        <ul class="ppl__rows" role="list">
          {#each people.crew as c (c.id)}
            <li>
              <span class="ppl__row-main">
                {#if c.person?.slug}
                  <a href={`/h/${workspaceSlug}/person/${c.person.slug}`}>{c.person.full_name}</a>
                {:else}
                  {c.person?.full_name ?? '—'}
                {/if}
                <span class="ppl__row-role">{c.role}</span>
              </span>
              {#if c.person && (c.person.email || c.person.phone)}
                <span class="ppl__row-contact">
                  {#if c.person.email}
                    <a href={`mailto:${c.person.email}`}>{c.person.email}</a>
                  {/if}
                  {#if c.person.phone}
                    <a href={`tel:${c.person.phone}`}>{c.person.phone}</a>
                  {/if}
                </span>
              {/if}
              {#if c.performance}
                {#if c.performance.slug}
                  <a
                    class="ppl__row-perf"
                    href={`/h/${workspaceSlug}/performance/${c.performance.slug}`}
                  >
                    {c.performance.venue_name ?? c.performance.city ?? '—'}
                    · {dayLabel(c.performance.performed_at)}
                  </a>
                {:else}
                  <span class="ppl__row-perf">
                    {c.performance.venue_name ?? c.performance.city ?? '—'}
                    · {dayLabel(c.performance.performed_at)}
                  </span>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="ppl__state">No crew assigned on this line's performances.</p>
      {/if}
    </section>

    <section class="ppl__section" aria-label="Venue contacts">
      <p class="ppl__sub">Venue contacts</p>
      {#if venueGroups.length > 0}
        {#each venueGroups as g (g.venue.id)}
          <div class="ppl__venue">
            <p class="ppl__venue-head">
              {g.venue.name}
              {#if g.venue.city}<span class="ppl__venue-city">{g.venue.city}</span>{/if}
            </p>
            <ul class="ppl__rows ppl__rows--indent" role="list">
              {#each g.contacts as c, i (i)}
                <li>
                  <span class="ppl__row-main">
                    {c.name ?? '—'}
                    {#if c.role}<span class="ppl__row-role">{c.role}</span>{/if}
                  </span>
                  {#if c.email || c.phone}
                    <span class="ppl__row-contact">
                      {#if c.email}<a href={`mailto:${c.email}`}>{c.email}</a>{/if}
                      {#if c.phone}<a href={`tel:${c.phone}`}>{c.phone}</a>{/if}
                    </span>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      {:else}
        <p class="ppl__state">
          No venue contacts yet — add them from a performance's venue dialog.
        </p>
      {/if}
    </section>
  </div>
{/if}

<style>
  @layer components {
    .ppl {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
    }

    .ppl__state {
      font-size: var(--text-s);
      color: var(--text-faint);
    }
    .ppl__state--danger {
      color: var(--danger);
    }

    .ppl__section {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    /* Sub-eyebrow — smaller sibling of the page eyebrow: same mono
       uppercase register, lighter tracking, scoped to module subsections. */
    .ppl__sub {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-faint);
    }

    .ppl__rows li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2xs) var(--space-m);
      align-items: baseline;
      padding-block: var(--space-xs);
      border-block-end: 1px solid var(--border-color-light);
    }

    .ppl__row-main {
      flex: 1;
      min-inline-size: 10rem;
      font-size: var(--text-s);
      color: var(--text-color);
    }
    .ppl__row-main a {
      color: var(--text-color);
      text-decoration: none;
    }
    .ppl__row-main a:hover {
      text-decoration: underline;
    }

    .ppl__row-role {
      margin-inline-start: var(--space-xs);
      font-size: var(--text-s);
      color: var(--text-muted);
    }

    .ppl__row-contact {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
    }
    .ppl__row-contact a {
      color: var(--text-muted);
      text-decoration: none;
      transition: color var(--transition);
    }
    .ppl__row-contact a:hover {
      color: var(--text-color);
      text-decoration: underline;
    }

    .ppl__row-perf {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
      text-decoration: none;
      white-space: nowrap;
    }
    a.ppl__row-perf {
      transition: color var(--transition);
    }
    a.ppl__row-perf:hover {
      color: var(--text-color);
      text-decoration: underline;
    }

    .ppl__venue {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }

    .ppl__venue-head {
      font-size: var(--text-s);
      font-weight: 500;
      color: var(--text-color);
    }

    .ppl__venue-city {
      margin-inline-start: var(--space-xs);
      font-weight: 400;
      color: var(--text-muted);
    }

    .ppl__rows--indent {
      padding-inline-start: var(--space-m);
    }
  }
</style>
