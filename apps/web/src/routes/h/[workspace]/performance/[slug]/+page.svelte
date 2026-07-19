<script lang="ts">
  /**
   * Performance detail — Phase 0.1 trabajo #3, mobile-first (single
   * column; wide screens get breathing room, not a second column).
   *
   * Data: GET /api/performances/:slug?ws=<workspace> — the full bundle
   * (venue, schedule, jsonb, crew, cast, dates, assets, programmer).
   * The road sheet sub-view (ADR-023) links from the header.
   */

  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import ProductionStub from '$lib/components/ProductionStub.svelte';
  import YNotes from '$lib/components/YNotes.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import type { Json } from '$lib/db-types';
  import { dayLabel, dayMonth, instantToWallClock, wallClockToInstant } from '$lib/datetime';
  import { detectLocale, t } from '$lib/i18n';
  import {
    HOLD_NOTICE_DEFAULT,
    PERFORMANCE_STATUSES,
    isHoldStatus,
    isValidHoldNotice,
    performanceStatusLabel,
    performanceStatusTone,
    type PerformancePatch,
    type PerformanceStatus,
  } from '$lib/performance';
  import type { VenueContact } from '$lib/venue';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { accentVar } from '$lib/utils/accent';
  import { useBreadcrumb, type Crumb } from '$lib/stores/breadcrumb.svelte';

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
      workspace_id: string;
      venue_id: string | null;
      performed_at: string;
      status: string;
      venue_name: string | null;
      city: string | null;
      country: string | null;
      notes: string | null;
      hold_notice_days: number | null;
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
      conversation: {
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
        venue: { timezone: string | null } | null;
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
    /** Pre-migration DB — hold_notice_days degraded to null; hide the field. */
    hold_notice_absent?: boolean;
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

  const breadcrumb = useBreadcrumb();
  const wsQuery = createQuery(workspacesQueryOptions());
  let activeWorkspaceName = $derived(
    $wsQuery.data?.items.find((w) => w.slug === workspaceSlug)?.name ?? workspaceSlug,
  );

  // ── Write path (ADR-043): status menu + details dialog ─────────────────
  const queryClient = useQueryClient();

  const patchMutation = createMutation({
    mutationFn: async (patch: PerformancePatch) => {
      const body = await mutateJSON<{ performance?: unknown }>(
        'PATCH',
        `/api/performances/${encodeURIComponent(slug)}?ws=${encodeURIComponent(workspaceSlug)}`,
        patch,
      );
      if (!body?.performance) throw new Error('Unexpected response');
      return body.performance;
    },
    onSuccess: () => {
      dialogOpen = false;
      void queryClient.invalidateQueries({ queryKey: ['performance'] });
      void queryClient.invalidateQueries({ queryKey: ['calendar-performances'] });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Change not saved',
        message: `${err instanceof Error ? err.message : 'Unexpected error'} — try again.`,
      });
    },
  });

  function changeStatus(status: PerformanceStatus) {
    if (!perf || perf.status === status) return;
    $patchMutation.mutate({ status });
  }

  const locale = detectLocale(navigator.language);

  let dialogOpen = $state(false);
  let fDay = $state('');
  let fVenue = $state('');
  let fCity = $state('');
  let fCountry = $state('');
  let fVenueId = $state('');
  // ADR-079 §2 — hold decision notice; the field only exists in the dialog
  // while the gig's status is hold*. null = empty = standard default.
  let fHoldNotice = $state<number | null>(null);
  let fLoadIn = $state('');
  let fSoundcheck = $state('');
  let fStart = $state('');
  let fLoadout = $state('');
  let fWrap = $state('');

  // The zone the timeslot fields were POPULATED in, plus their populated
  // values — lets the cache-flip guard below tell "user typed something"
  // apart from "the workspaces/venues cache landed late".
  let populatedTz = $state('');
  let populatedSlots = $state<string[]>([]);

  function populateSlots() {
    if (!perf) return;
    fLoadIn = instantToWallClock(perf.load_in_at, entryTz);
    fSoundcheck = instantToWallClock(perf.soundcheck_at, entryTz);
    fStart = instantToWallClock(perf.start_at, entryTz);
    fLoadout = instantToWallClock(perf.loadout_at, entryTz);
    fWrap = instantToWallClock(perf.wrap_at, entryTz);
    populatedTz = entryTz;
    populatedSlots = [fLoadIn, fSoundcheck, fStart, fLoadout, fWrap];
  }

  function openEdit() {
    if (!perf) return;
    fDay = perf.performed_at.slice(0, 10);
    fVenue = perf.venue_name ?? '';
    fCity = perf.city ?? '';
    fCountry = perf.country ?? '';
    fVenueId = perf.venue_id ?? '';
    fHoldNotice = perf.hold_notice_days;
    // Stored instants → wall times in the entry zone (venue-local when a
    // venue is linked). entryTz reads fVenueId, set just above.
    populateSlots();
    dialogOpen = true;
  }

  // Cache-flip guard: if entryTz changes under the OPEN dialog because a
  // cold cache landed (not because the user re-linked the venue — that
  // deliberately keeps the typed wall times), re-derive untouched fields
  // from the stored instants so what's shown still means what will be
  // saved. If the user already typed, leave their input — the hint above
  // the fields always names the zone that will be used.
  $effect(() => {
    if (!dialogOpen || !perf || entryTz === populatedTz) return;
    if (fVenueId !== (perf.venue_id ?? '')) return;
    const untouched =
      fLoadIn === populatedSlots[0] &&
      fSoundcheck === populatedSlots[1] &&
      fStart === populatedSlots[2] &&
      fLoadout === populatedSlots[3] &&
      fWrap === populatedSlots[4];
    if (untouched) {
      populateSlots();
    } else {
      populatedTz = entryTz;
    }
  });

  function saveEdit() {
    if (!fDay) {
      addToast({ tone: 'warning', message: 'The performance needs a date.' });
      return;
    }
    // Same validation rule as PerformanceForm (isValidHoldNotice — THE
    // technique for this field): the input's min/max/step are hints, not
    // enforcement, and one bad digit must not 400 the whole PATCH and
    // lose every other edit in the dialog. Empty (null) stays valid —
    // "back to the standard default".
    if (showHoldNotice && !isValidHoldNotice(fHoldNotice)) {
      addToast({ tone: 'warning', message: t('perf.hold_notice_invalid', locale) });
      return;
    }
    // Wall times → instants in the CURRENTLY selected venue's zone: re-link
    // mid-edit and "show at 20:30" stays 20:30 in the new place.
    $patchMutation.mutate({
      performed_at: fDay,
      venue_name: fVenue.trim() || null,
      city: fCity.trim() || null,
      country: fCountry.trim() || null,
      venue_id: fVenueId || null,
      load_in_at: wallClockToInstant(fLoadIn, entryTz),
      soundcheck_at: wallClockToInstant(fSoundcheck, entryTz),
      start_at: wallClockToInstant(fStart, entryTz),
      loadout_at: wallClockToInstant(fLoadout, entryTz),
      wrap_at: wallClockToInstant(fWrap, entryTz),
      // ADR-079 §2 — only while the field is on screen (hold* status);
      // emptied field = null = back to the standard default.
      ...(showHoldNotice ? { hold_notice_days: fHoldNotice } : {}),
    });
  }

  let bundle = $derived($query.data ?? null);
  let perf = $derived(bundle?.performance ?? null);

  // ADR-079 §2 — the notice field rides the dialog only for hold* gigs,
  // and only while the DB has the column (a pre-migration bundle flags
  // `hold_notice_absent`; a PATCH carrying it would be rejected whole).
  let showHoldNotice = $derived(
    Boolean(perf && isHoldStatus(perf.status) && !bundle?.hold_notice_absent),
  );

  // Address: Space › Project › [Line ›] Performance. The current crumb is the
  // venue (a performance has no name of its own); the line is included when
  // the gig belongs to one. No pin — performances aren't in the pin model.
  $effect(() => {
    if (perf) {
      const crumbs: Crumb[] = [
        {
          label: activeWorkspaceName,
          href: `/h/${workspaceSlug}/`,
          kind: 'space',
          accent: accentVar(workspaceSlug),
        },
      ];
      if (perf.project) {
        crumbs.push({
          label: perf.project.name,
          href: `/h/${workspaceSlug}/project/${perf.project.slug}/`,
          kind: 'node',
        });
        if (perf.line) {
          crumbs.push({
            label: perf.line.name,
            href: `/h/${workspaceSlug}/project/${perf.project.slug}/line/${perf.line.slug}`,
            kind: 'node',
          });
        }
      }
      crumbs.push({
        label: perf.venue?.name ?? perf.venue_name ?? 'Performance',
        kind: 'node',
      });
      breadcrumb.set(crumbs);
    } else {
      breadcrumb.clear();
    }
    return () => breadcrumb.clear();
  });

  // ── Delete (ADR-052) — for gigs created by mistake. A gig that fell
  // through is status `cancelled`, not a deletion. ─────────────────────
  let confirmDeleteOpen = $state(false);

  const deleteMutation = createMutation({
    mutationFn: () =>
      mutateJSON(
        'DELETE',
        `/api/performances/${encodeURIComponent(slug)}?ws=${encodeURIComponent(workspaceSlug)}`,
      ),
    onSuccess: async () => {
      confirmDeleteOpen = false;
      dialogOpen = false;
      void queryClient.invalidateQueries({ queryKey: ['calendar-performances'] });
      void queryClient.invalidateQueries({ queryKey: ['money-performances'] });
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      addToast({ tone: 'success', message: 'Performance deleted.' });
      await goto(`/h/${workspaceSlug}/calendar`);
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Not deleted',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });

  // ── Venue entity (ADR-049) — after the `perf` derived: the toStore
  // callback runs on creation and would hit the TDZ otherwise. ─────────
  type VenueLite = {
    id: string;
    name: string;
    city: string | null;
    country: string | null;
    address: string | null;
    capacity: number | null;
    timezone: string | null;
    contacts: VenueContact[];
    notes: string | null;
  };

  const venuesOptions = toStore(() => {
    const wsId = perf?.workspace_id ?? '';
    return {
      queryKey: ['venues', wsId] as const,
      enabled: dialogOpen && Boolean(wsId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: VenueLite[] }>(`/api/venues?workspace_ids=${wsId}`, signal),
    };
  });
  const venuesQuery = createQuery(venuesOptions);
  let venues = $derived($venuesQuery.data?.items ?? []);

  // Promote the typed venue fields to a venue row and link it. Idempotent
  // server-side: an existing name+city match returns the existing venue.
  const promoteVenue = createMutation({
    mutationFn: async () => {
      const body = await mutateJSON<{ venue?: VenueLite }>('POST', '/api/venues', {
        workspace_id: perf!.workspace_id,
        name: fVenue.trim(),
        city: fCity.trim() || null,
        country: fCountry.trim() || null,
      });
      if (!body?.venue) throw new Error('Unexpected response');
      return body.venue;
    },
    onSuccess: (venue) => {
      fVenueId = venue.id;
      void queryClient.invalidateQueries({ queryKey: ['venues'] });
      addToast({ tone: 'success', message: `Linked to venue "${venue.name}".` });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Venue not created',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });
  // ── Venue edit (ADR-053): address, timezone (feeds dual-time on the
  // road sheet), contacts, capacity, notes. PATCH /api/venues/:id — no
  // RPC (venue_update RLS covers workspace members; ADR-048 only bites
  // soft-deletes). ─────────────────────────────────────────────────────
  type ContactDraft = { name: string; role: string; email: string; phone: string };

  let venueEditOpen = $state(false);
  let vName = $state('');
  let vCity = $state('');
  let vCountry = $state('');
  let vAddress = $state('');
  let vCapacity = $state('');
  let vTimezone = $state('');
  let vNotes = $state('');
  let vContacts = $state<ContactDraft[]>([]);

  // The native medium already knows every IANA zone — no bundled list.
  const timezoneOptions =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

  function openVenueEdit() {
    const venue = venues.find((vn) => vn.id === fVenueId);
    if (!venue) return;
    vName = venue.name;
    vCity = venue.city ?? '';
    vCountry = venue.country ?? '';
    vAddress = venue.address ?? '';
    vCapacity = venue.capacity != null ? String(venue.capacity) : '';
    vTimezone = venue.timezone ?? '';
    vNotes = venue.notes ?? '';
    vContacts = (venue.contacts ?? []).map((c) => ({
      name: c.name ?? '',
      role: c.role ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
    }));
    venueEditOpen = true;
  }

  function addContactRow() {
    vContacts = [...vContacts, { name: '', role: '', email: '', phone: '' }];
  }

  function removeContactRow(index: number) {
    vContacts = vContacts.filter((_, i) => i !== index);
  }

  const venuePatch = createMutation({
    mutationFn: () =>
      mutateJSON<{ venue: VenueLite }>('PATCH', `/api/venues/${fVenueId}`, {
        name: vName.trim(),
        city: vCity.trim() || null,
        country: vCountry.trim() || null,
        address: vAddress.trim() || null,
        capacity: vCapacity.trim() ? Number(vCapacity) : null,
        timezone: vTimezone.trim() || null,
        notes: vNotes.trim() || null,
        contacts: vContacts
          .filter((c) => c.name.trim())
          .map((c) => ({
            name: c.name.trim(),
            role: c.role.trim() || null,
            email: c.email.trim() || null,
            phone: c.phone.trim() || null,
          })),
      }),
    onSuccess: (result) => {
      venueEditOpen = false;
      void queryClient.invalidateQueries({ queryKey: ['venues'] });
      void queryClient.invalidateQueries({ queryKey: ['performance'] });
      addToast({ tone: 'success', message: `Venue "${result?.venue.name ?? vName}" updated.` });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Venue not saved',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
    },
  });

  function saveVenue() {
    if (!vName.trim()) {
      addToast({ tone: 'warning', message: 'The venue needs a name.' });
      return;
    }
    $venuePatch.mutate();
  }

  let loading = $derived($query.isPending);
  let errorMsg = $derived($query.error instanceof Error ? $query.error.message : '');

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Timezone rule (spec § Timezone rule): the timeslot inputs speak the
  // VENUE's wall clock, falling back to the home space's timezone when no
  // venue is linked — never silently the browser's (contracts don't move
  // with the laptop). Derived from the venue SELECTED in the dialog, so
  // re-linking mid-edit keeps the typed wall times and reinterprets them
  // in the new zone.
  let workspaceTz = $derived(
    $wsQuery.data?.items.find((w) => w.slug === workspaceSlug)?.timezone ?? null,
  );
  let entryTzInfo = $derived.by<{
    tz: string;
    source: 'venue' | 'workspace' | 'viewer';
    place: string | null;
  }>(() => {
    if (fVenueId) {
      const picked = venues.find((vn) => vn.id === fVenueId);
      const linked = fVenueId === perf?.venue_id ? perf?.venue : null;
      const tz = picked?.timezone ?? linked?.timezone;
      if (tz) return { tz, source: 'venue', place: picked?.name ?? linked?.name ?? null };
    }
    if (workspaceTz) return { tz: workspaceTz, source: 'workspace', place: null };
    return { tz: viewerTz, source: 'viewer', place: null };
  });
  let entryTz = $derived(entryTzInfo.tz);

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

  // Timezone rule: a related date renders on ITS venue's day, falling back
  // to the gig's venue, then the home space — never silently the browser's.
  // All-day rows are calendar dates: UTC-anchored, no zone shifting.
  function formatDateRow(d: {
    starts_at: string;
    all_day: boolean;
    venue: { timezone: string | null } | null;
  }): string {
    if (d.all_day) return dayMonth(d.starts_at);
    const tz = d.venue?.timezone ?? perf?.venue?.timezone ?? workspaceTz ?? viewerTz;
    return new Date(d.starts_at).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      timeZone: tz,
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
        <Menu label="Change status" triggerClass="state-badge" triggerAttrs={{ 'data-tone': performanceStatusTone(perf.status) }}>
          {#snippet trigger()}{performanceStatusLabel(perf.status)}<span class="status-caret" aria-hidden="true">▾</span>{/snippet}
          {#snippet children({ close })}
            {#each PERFORMANCE_STATUSES as s (s)}
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  class="menu__item{s === perf!.status ? ' menu__item--active' : ''}"
                  onclick={() => {
                    close();
                    changeStatus(s);
                  }}
                >
                  {performanceStatusLabel(s)}
                </button>
              </li>
            {/each}
          {/snippet}
        </Menu>
        <span class="perf__meta-sep" aria-hidden="true">·</span>
        <span class="perf__meta-date">{dayLabel(perf.performed_at, 'short')}</span>
        {#if placeLine}
          <span class="perf__meta-sep" aria-hidden="true">·</span>
          <span class="perf__meta-place">{placeLine}</span>
        {/if}
      </div>
      <p class="perf__roadsheet-link">
        <a class="link-arrow" href={`/h/${workspaceSlug}/performance/${slug}/roadsheet`}>Open road sheet →</a>
        <Button variant="outline" size="xs" onclick={openEdit}>Edit details</Button>
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
      fallbackTz={workspaceTz}
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
              <span class="perf__date-when">{formatDateRow(d)}</span>
              <span class="perf__date-kind">{d.kind.replace(/_/g, ' ')}</span>
              <span class="perf__date-title">{d.title ?? ''}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if perf.conversation?.person}
      <section class="perf__section" aria-label="Programmer">
        <p class="eyebrow">Programmer</p>
        <p class="perf__programmer">
          <a href={`/h/${workspaceSlug}/person/${perf.conversation.person.slug}`}>
            {perf.conversation.person.full_name}
          </a>
          {#if perf.conversation.person.organization_name}
            <span class="perf__person-note">{perf.conversation.person.organization_name}</span>
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

    <section class="perf__section" aria-label="Notes">
      <p class="eyebrow">Notes</p>
      <YNotes
        targetTable="performance"
        targetId={perf.id}
        placeholder="Production notes — shared, live."
      />
    </section>
  {/if}
</article>

<Dialog bind:open={dialogOpen} title="Edit performance" size="m">
  <div class="perf__form-grid">
    <Input label="Date" type="date" bind:value={fDay} required />
    <Input label="Venue" bind:value={fVenue} placeholder="Venue name" />
    <Input label="City" bind:value={fCity} />
    <Input label="Country" bind:value={fCountry} placeholder="ES" />
    {#if showHoldNotice}
      <!-- ADR-079 §2 — discreet, hold-only. Empty = default 30 (the
           placeholder says it), 0 = no notice. -->
      <div class="field">
        <label for="f-hold-notice">{t('perf.hold_notice', locale)}</label>
        <div class="field__control">
          <input
            id="f-hold-notice"
            type="number"
            min="0"
            max="365"
            step="1"
            inputmode="numeric"
            bind:value={fHoldNotice}
            placeholder={String(HOLD_NOTICE_DEFAULT)}
            aria-describedby={fHoldNotice === 0 ? 'f-hold-notice-msg' : undefined}
          />
          <span class="field__suffix">{t('perf.hold_notice_suffix', locale)}</span>
        </div>
        {#if fHoldNotice === 0}
          <p id="f-hold-notice-msg" class="field__msg">{t('perf.hold_notice_none', locale)}</p>
        {/if}
      </div>
    {/if}
  </div>
  <div class="perf__venue-link">
    <div class="field">
      <label for="f-venue-entity">Linked venue</label>
      <select id="f-venue-entity" bind:value={fVenueId}>
        <option value="">— none (free text above)</option>
        {#each venues as vn (vn.id)}
          <option value={vn.id}>{vn.name}{vn.city ? ` — ${vn.city}` : ''}</option>
        {/each}
      </select>
    </div>
    <Button
      variant="outline"
      size="s"
      disabled={!fVenue.trim()}
      loading={$promoteVenue.isPending}
      onclick={() => $promoteVenue.mutate()}
    >
      Save fields as venue
    </Button>
    <Button variant="outline" size="s" disabled={!fVenueId} onclick={openVenueEdit}>
      Edit venue…
    </Button>
  </div>
  <p class="perf__dialog-hint">
    A linked venue brings its timezone (dual-time on the road sheet), address and
    contacts. The free-text fields stay as the display fallback.
  </p>
  <p class="perf__dialog-hint" id="perf-times-tz">
    {#if entryTzInfo.source === 'venue'}
      Times below are the venue's local time{entryTzInfo.place ? ` at ${entryTzInfo.place}` : ''}
      ({entryTz}).
    {:else if entryTzInfo.source === 'workspace'}
      Times below are home-space time ({entryTz}) —
      {fVenueId ? 'set the venue’s timezone (Edit venue…) for its local time.' : 'link the venue for its local time.'}
    {:else}
      Times below are your device's time ({entryTz}) —
      {fVenueId ? 'set the venue’s timezone (Edit venue…) for its local time.' : 'link the venue for its local time.'}
    {/if}
  </p>
  <div class="perf__form-grid">
    <div class="field">
      <label for="f-loadin">Load in</label>
      <input id="f-loadin" type="datetime-local" bind:value={fLoadIn} aria-describedby="perf-times-tz" />
    </div>
    <div class="field">
      <label for="f-soundcheck">Soundcheck</label>
      <input id="f-soundcheck" type="datetime-local" bind:value={fSoundcheck} aria-describedby="perf-times-tz" />
    </div>
    <div class="field">
      <label for="f-start">Start</label>
      <input id="f-start" type="datetime-local" bind:value={fStart} aria-describedby="perf-times-tz" />
    </div>
    <div class="field">
      <label for="f-loadout">Load out</label>
      <input id="f-loadout" type="datetime-local" bind:value={fLoadout} aria-describedby="perf-times-tz" />
    </div>
    <div class="field">
      <label for="f-wrap">Wrap</label>
      <input id="f-wrap" type="datetime-local" bind:value={fWrap} aria-describedby="perf-times-tz" />
    </div>
  </div>
  <div class="perf__danger">
    <Button variant="outline" tone="warn" size="s" onclick={() => (confirmDeleteOpen = true)}>
      Delete performance…
    </Button>
    <span class="perf__dialog-hint">For gigs created by mistake — a gig that fell through is status “cancelled”.</span>
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (dialogOpen = false)}>Cancel</Button>
    <Button onclick={saveEdit} loading={$patchMutation.isPending}>Save</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={venueEditOpen} title="Edit venue" size="m">
  <p class="perf__dialog-hint">
    The timezone drives dual-time on the road sheet. Contacts show in the
    production block.
  </p>
  <div class="perf__form-grid">
    <Input label="Name" bind:value={vName} required />
    <Input label="City" bind:value={vCity} />
    <Input label="Country" bind:value={vCountry} placeholder="ES" />
    <Input label="Capacity" type="number" bind:value={vCapacity} />
  </div>
  <div class="perf__form-grid">
    <Input label="Address" bind:value={vAddress} placeholder="Street, number, zip" />
    <div class="field">
      <label for="v-timezone">Timezone</label>
      <input
        id="v-timezone"
        type="text"
        list="v-timezone-list"
        bind:value={vTimezone}
        placeholder="Europe/Madrid"
      />
      <datalist id="v-timezone-list">
        {#each timezoneOptions as tz (tz)}
          <option value={tz}></option>
        {/each}
      </datalist>
    </div>
  </div>
  <div class="perf__venue-contacts">
    <p class="eyebrow">Contacts</p>
    {#each vContacts as _, i (i)}
      <div class="perf__contact-row">
        <Input label={i === 0 ? 'Name' : undefined} bind:value={vContacts[i].name} placeholder="Name" />
        <Input label={i === 0 ? 'Role' : undefined} bind:value={vContacts[i].role} placeholder="Tech manager…" />
        <Input label={i === 0 ? 'Email' : undefined} type="email" bind:value={vContacts[i].email} placeholder="Email" />
        <Input label={i === 0 ? 'Phone' : undefined} type="tel" bind:value={vContacts[i].phone} placeholder="Phone" />
        <button
          type="button"
          class="perf__contact-remove"
          aria-label="Remove contact"
          onclick={() => removeContactRow(i)}
        >×</button>
      </div>
    {/each}
    <Button variant="outline" size="xs" onclick={addContactRow}>Add contact</Button>
  </div>
  <div class="field perf__venue-notes">
    <label for="v-notes">Notes</label>
    <textarea id="v-notes" rows="3" bind:value={vNotes}></textarea>
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (venueEditOpen = false)}>Cancel</Button>
    <Button onclick={saveVenue} loading={$venuePatch.isPending}>Save venue</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={confirmDeleteOpen} title="Delete performance" size="s">
  <p>
    This removes <strong>{title}</strong> ({perf ? dayLabel(perf.performed_at, 'short') : ''})
    from the calendar, money and road sheet. Active invoices block deletion.
  </p>
  <p class="perf__dialog-hint">There is no undo from the UI.</p>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (confirmDeleteOpen = false)}>Keep it</Button>
    <Button variant="danger" onclick={() => $deleteMutation.mutate()} loading={$deleteMutation.isPending}>
      Delete
    </Button>
  {/snippet}
</Dialog>

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
      display: flex;
      align-items: center;
      gap: var(--space-m);
    }

    .perf__dialog-hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .perf__form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: var(--space-s) var(--space-m);
      margin-block-start: var(--space-s);
    }

    .perf__venue-link {
      display: flex;
      align-items: end;
      gap: var(--space-m);
      margin-block-start: var(--space-s);
    }
    .perf__venue-link .field {
      flex: 1;
    }

    .perf__danger {
      display: flex;
      align-items: center;
      gap: var(--space-m);
      margin-block-start: var(--space-m);
      padding-block-start: var(--space-m);
      border-block-start: 1px solid var(--border-color-light);
    }

    .perf__venue-contacts {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      margin-block-start: var(--space-m);
    }

    .perf__contact-row {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1fr auto;
      gap: var(--space-xs);
      align-items: end;
    }

    .perf__contact-remove {
      inline-size: 2rem;
      block-size: 2rem;
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-s, 4px);
      background: none;
      color: var(--text-faint);
      cursor: pointer;
    }
    .perf__contact-remove:hover {
      color: var(--danger);
      border-color: var(--danger);
    }

    .perf__venue-notes {
      margin-block-start: var(--space-m);
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

  }
</style>
