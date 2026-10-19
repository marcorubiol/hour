<script lang="ts">
  /**
   * Performance detail — Phase 0.1 trabajo #3, mobile-first (single
   * column; wide screens get breathing room, not a second column).
   *
   * Data: GET /api/performances/:slug?ws=<workspace> — the full bundle
   * (venue, schedule, jsonb, crew, cast, dates, assets, programmer).
   * The road sheet sub-view (ADR-023) links from the header.
   */

  import { docTitle } from '$lib/doc-title';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { retryLoad } from '$lib/load-fail';
  import RecordState from '$lib/components/RecordState.svelte';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import ProductionStub from '$lib/components/ProductionStub.svelte';
  import RunningOrder from '$lib/components/RunningOrder.svelte';
  import YNotes from '$lib/components/YNotes.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import type { Json } from '$lib/db-types';
  import { dayLabel, dayMonth } from '$lib/datetime';
  import { LOCALE_TAG, detectLocale, t } from '$lib/i18n';
  import {
    HOLD_NOTICE_DEFAULT,
    PERFORMANCE_STATUSES,
    isHoldStatus,
    isValidHoldNotice,
    performanceStatusLabel,
    performanceStatusTone,
    type PerformancePatch,
    type PerformanceStatus,
    READINESS_KEYS,
    readinessLabelKey,
    isReady,
  } from '$lib/performance';
  import type { VenueContact } from '$lib/venue';
  import DirectoryPicker from '$lib/components/DirectoryPicker.svelte';
  import WhoGoes from '$lib/components/planner/WhoGoes.svelte';
  import BoloBoard from '$lib/components/BoloBoard.svelte';
  import ConceptHint from '$lib/components/ConceptHint.svelte';
  import type { Commitment } from '$lib/people';
  import { performanceRoster } from '$lib/planner';
  import Select from '$lib/components/Select.svelte';
  import { boloOf, boloOptions, boloPatch, booksHref, type BoloLite } from '$lib/bolo-pick';
  import { lensOn } from '$lib/lenses.svelte';
  import { performanceBoloQueryOptions, projectBolosQueryOptions } from '$lib/bolo-queries';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import RecordHead from '$lib/components/RecordHead.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import { spaceCrumb, type Crumb } from '$lib/record-crumbs';

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
      /* ADR-084 §3 — the verdict, next to the content it summarises. Typed
         narrower than Json on purpose: the key set is closed app-side. */
      readiness: Record<string, boolean> | null;
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
        organization?: { name: string } | null;
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
      /** ADR-103 — each person's «voy / no voy». */
      commitments?: Commitment[];
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
      retry: retryLoad,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<Bundle>(
          `/api/performances/${encodeURIComponent(k.slug)}?ws=${encodeURIComponent(k.ws)}`,
          signal,
        ),
    };
  });

  const query = createQuery(queryOptions);

  const wsQuery = createQuery(workspacesQueryOptions());
  let activeWorkspaceName = $derived(
    $wsQuery.data?.items.find((w) => w.slug === workspaceSlug)?.name ?? workspaceSlug,
  );

  // ── Write path (ADR-043): status menu + details dialog ─────────────────
  const queryClient = useQueryClient();

  const patchMutation = createMutation({
    mutationFn: async (patch: PerformancePatch) => {
      const body = await mutateJSON<{
        performance?: unknown;
        schedule_rezoned?: { from: string; to: string };
        schedule_rezone_failed?: { from: string; to: string };
      }>(
        'PATCH',
        `/api/performances/${encodeURIComponent(slug)}?ws=${encodeURIComponent(workspaceSlug)}`,
        patch,
      );
      if (!body?.performance) throw new Error(t('perf.unexpected_response', locale));
      return body;
    },
    onSuccess: (body, patch) => {
      dialogOpen = false;
      void queryClient.invalidateQueries({ queryKey: ['performance'] });
      void queryClient.invalidateQueries({ queryKey: ['planner-performances'] });
      // Mover una función de bolo cambia el enlace y el recuento de los dos.
      if ('bolo_id' in patch) void queryClient.invalidateQueries({ queryKey: ['money-bolos'] });
      // Relinked to a venue in another zone: the running order kept its wall
      // clock and moved to new instants (the PATCH asks the collab doc, which
      // owns the order, ADR-090 P2). Say so, or say it could not.
      if (body.schedule_rezoned) {
        void queryClient.invalidateQueries({ queryKey: ['schedule'] });
        addToast({
          tone: 'info',
          message: t('planner.ro_rezoned', locale, body.schedule_rezoned),
        });
      } else if (body.schedule_rezone_failed) {
        addToast({ tone: 'warning', message: t('planner.ro_rezone_failed', locale) });
      }
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('edit.not_saved', locale),
        message: t('perf.try_again', locale, {
          error: err instanceof Error ? err.message : t('perf.unexpected', locale),
        }),
      });
    },
  });

  /**
   * ADR-084 §3 — tick "is it sorted?". Reuses the generic patch mutation on
   * purpose: a readiness tick is an ordinary field write, and that mutation
   * already invalidates the planner feed, so the month card's foot repaints
   * without a second invalidation path to keep in sync.
   */
  function toggleReady(key: string) {
    if (!perf) return;
    const current = (perf.readiness ?? {}) as Record<string, boolean>;
    $patchMutation.mutate({ readiness: { ...current, [key]: !current[key] } });
  }

  /* CANCELAR SE CONFIRMA (Marco, 2026-10-18). Es la única puerta para
     cancelar una función: la Agenda tenía un «soltado» de un clic que se
     leía como estado y cancelaba un bolo firme. Aquí se pregunta antes. */
  let confirmCancelOpen = $state(false);
  function changeStatus(status: PerformanceStatus) {
    if (!perf || perf.status === status) return;
    if (status === 'cancelled') {
      confirmCancelOpen = true;
      return;
    }
    $patchMutation.mutate({ status });
  }

  const locale = detectLocale(navigator.language);

  let dialogOpen = $state(false);
  let fDay = $state('');
  let fVenue = $state('');
  let fCity = $state('');
  let fCountry = $state('');
  let fVenueId = $state('');
  // ADR-080 §2 — hold decision notice; the field only exists in the dialog
  // while the gig's status is hold*. null = empty = standard default.
  let fHoldNotice = $state<number | null>(null);
  // ADR-087 · § 36 — el bolo del que cuelga; '' = sin bolo.
  let fBolo = $state('');

  function openEdit() {
    if (!perf) return;
    fDay = perf.performed_at.slice(0, 10);
    fVenue = perf.venue_name ?? '';
    fCity = perf.city ?? '';
    fCountry = perf.country ?? '';
    fVenueId = perf.venue_id ?? '';
    fHoldNotice = perf.hold_notice_days;
    fBolo = currentBoloId ?? '';
    dialogOpen = true;
  }

  function saveEdit() {
    if (!fDay) {
      addToast({ tone: 'warning', message: t('perf.needs_date', locale) });
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
    $patchMutation.mutate({
      performed_at: fDay,
      venue_name: fVenue.trim() || null,
      city: fCity.trim() || null,
      country: fCountry.trim() || null,
      venue_id: fVenueId || null,
      // ADR-080 §2 — only while the field is on screen (hold* status);
      // emptied field = null = back to the standard default.
      ...(showHoldNotice ? { hold_notice_days: fHoldNotice } : {}),
      // § 36 — solo si el campo está en pantalla y cambió (ver boloPatch).
      ...(showBoloSelect ? boloPatch(currentBoloId, fBolo) : {}),
    });
  }

  let bundle = $derived($query.data ?? null);
  let perf = $derived(bundle?.performance ?? null);

  // ADR-087 · § 36 — DE QUÉ BOLO CUELGA. `bolo_id` no viaja en el bundle (es
  // dinero, fuera del SELECT por columnas), así que se lee aparte por la
  // puerta de `read:money`. Sin fila, la ficha no dice nada del trato ni
  // ofrece cambiarlo: «no te toca» y «sin bolo» no se distinguen.
  const boloLinkQuery = createQuery(
    toStore(() => performanceBoloQueryOptions(perf?.id ?? '')),
  );
  let boloLink = $derived($boloLinkQuery.data ?? null);
  let boloReadable = $derived(boloLink?.readable === true);
  let currentBoloId = $derived(boloLink?.readable ? boloLink.bolo_id : null);
  const projectBolosQuery = createQuery(
    toStore(() => projectBolosQueryOptions(perf?.project?.id ?? '', boloReadable)),
  );
  let projectBolos = $derived<BoloLite[]>($projectBolosQuery.data?.items ?? []);
  let currentBolo = $derived(projectBolos.find((b) => b.id === currentBoloId) ?? null);
  let bolosOptions = $derived(boloOptions(projectBolos, locale, currentBoloId));
  // El campo solo existe si el enlace se pudo leer Y hay algo que elegir:
  // guardar sin saber el valor actual lo borraría.
  // Y si el bolo actual no está entre las opciones (borrado, fuera del
  // límite), tampoco: el desplegable diría «sin bolo» sobre uno que existe.
  let showBoloSelect = $derived(
    boloReadable &&
      bolosOptions.length > 1 &&
      (currentBoloId === null || currentBolo !== null),
  );
  // Quien lee dinero en un proyecto sin bolos: el campo apagado y el enlace
  // a Cuentas, igual que en el alta.
  let showBoloEmpty = $derived(
    boloReadable &&
      currentBoloId === null &&
      $projectBolosQuery.isSuccess &&
      bolosOptions.length === 1,
  );

  // ADR-080 §2 — the notice field rides the dialog only for hold* gigs,
  // and only while the DB has the column (a pre-migration bundle flags
  // `hold_notice_absent`; a PATCH carrying it would be rejected whole).
  let showHoldNotice = $derived(
    Boolean(perf && isHoldStatus(perf.status) && !bundle?.hold_notice_absent),
  );

  // Address: Space › Project › [Line ›] Función. The title is the venue (a
  // performance has no name of its own), so the address ends with the kind.
  let crumbs = $derived.by<Crumb[]>(() => {
    const out: Crumb[] = [spaceCrumb(activeWorkspaceName, workspaceSlug)];
    if (perf?.project) {
      out.push({ label: perf.project.name, href: `/h/${workspaceSlug}/project/${perf.project.slug}/` });
      if (perf.line) {
        out.push({
          label: perf.line.name,
          href: `/h/${workspaceSlug}/project/${perf.project.slug}/line/${perf.line.slug}`,
        });
      }
    }
    out.push({ label: t('perf.label', locale) });
    return out;
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
      void queryClient.invalidateQueries({ queryKey: ['planner-performances'] });
      // money v3: lo que cuenta una función borrada es su bolo, no un feed
      // de funciones con caché (`money-performances` ya no existe).
      void queryClient.invalidateQueries({ queryKey: ['money-bolos'] });
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      addToast({ tone: 'success', message: t('perf.deleted', locale) });
      // Calendar se llama Planner desde ADR-088; la ruta vieja solo vive como
      // redirect del servidor, y desde aquí costaba una recarga entera.
      await goto('/h/planner');
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('edit.not_deleted', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
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
      if (!body?.venue) throw new Error(t('perf.unexpected_response', locale));
      return body.venue;
    },
    onSuccess: (venue) => {
      fVenueId = venue.id;
      void queryClient.invalidateQueries({ queryKey: ['venues'] });
      addToast({ tone: 'success', message: t('perf.linked_to_venue', locale, { name: venue.name }) });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('perf.venue_not_created', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });
  // A venue adopted from the directory is linked at once; the free-text
  // fields take its words only when they are empty (never overwritten).
  function onDirectoryAdopt(venue: { id: string; name: string; city: string | null; country: string | null }) {
    fVenueId = venue.id;
    if (!fVenue.trim()) {
      fVenue = venue.name;
      fCity = venue.city ?? '';
      fCountry = venue.country ?? '';
    }
    void queryClient.invalidateQueries({ queryKey: ['venues'] });
  }

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
      addToast({
        tone: 'success',
        message: t('venue.updated', locale, { name: result?.venue.name ?? vName }),
      });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('venue.not_saved', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });

  function saveVenue() {
    if (!vName.trim()) {
      addToast({ tone: 'warning', message: t('venue.needs_name', locale) });
      return;
    }
    $venuePatch.mutate();
  }

  let loading = $derived($query.isPending);

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Timezone rule (spec § Timezone rule): hours are the VENUE's wall clock,
  // falling back to the home space's when no venue is linked, never silently
  // the browser's. The running order (ADR-090 P3) types its hours here; the
  // details dialog no longer carries the five slots.
  let workspaceTz = $derived(
    $wsQuery.data?.items.find((w) => w.slug === workspaceSlug)?.timezone ?? null,
  );

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
    return new Date(d.starts_at).toLocaleDateString(LOCALE_TAG[locale], {
      day: '2-digit',
      month: 'short',
      timeZone: tz,
    });
  }

  /** The word for a DB enum value (date kind, asset direction/kind); the raw
      value with spaces when the dictionary has no word for it. */
  function enumWord(prefix: string, value: string): string {
    const key = prefix + value;
    const word = t(key, locale);
    return word === key ? value.replace(/_/g, ' ') : word;
  }

  let hasTeam = $derived(
    (bundle?.cast_members.length ?? 0) > 0 ||
      (perf?.cast_override.length ?? 0) > 0 ||
      (perf?.crew_assignment.length ?? 0) > 0,
  );
</script>

<svelte:head>
  <title>{docTitle(title, t('perf.label', locale))}</title>
</svelte:head>

<article class="record perf" aria-busy={loading}>
  {#if loading || ($query.isError && !perf)}
    <RecordState
      {loading}
      error={$query.error}
      missingText={t('perf.not_found', locale)}
      failedText={t('perf.load_error', locale)}
      onretry={() => void $query.refetch()}
      back={lensOn('planner') ? { href: '/h/planner', label: t('perf.back_planner', locale) } : null}
      {locale}
    />
  {:else if perf}
    <RecordHead {crumbs} {title}>
      {#snippet actions()}
        <span class="perf__roadsheet-link"
          ><a class="link-arrow" href={`/h/${workspaceSlug}/performance/${slug}/roadsheet`}>{t('roadsheet.open', locale)}</a
          ><ConceptHint concept="roadsheet" /></span
        >
        <Button variant="outline" size="xs" onclick={openEdit}>{t('perf.edit_details', locale)}</Button>
      {/snippet}
      {#snippet facts()}
        <Menu label={t('perf.status_menu', locale, { status: performanceStatusLabel(perf!.status, locale) })} triggerClass={`badge badge--xs badge--${performanceStatusTone(perf!.status)}`}>
          {#snippet trigger()}{performanceStatusLabel(perf!.status, locale)}<span class="status-caret" aria-hidden="true">▾</span>{/snippet}
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
                  {performanceStatusLabel(s, locale)}
                </button>
              </li>
            {/each}
          {/snippet}
        </Menu>
        <span>{dayLabel(perf!.performed_at, 'short')}</span>
        {#if placeLine}<span>{placeLine}</span>{/if}
        {#if boloReadable && currentBolo && perf!.project}
          <span
            >{#if lensOn('books')}<a class="lenshead__frag" href={booksHref(perf!.project.id, { boloId: currentBolo.id })}>{boloOf(currentBolo, locale)}</a>{:else}{boloOf(currentBolo, locale)}{/if}<ConceptHint
              concept="bolo"
            /></span
          >
        {:else if boloReadable && currentBoloId === null}
          <span>{boloOf(null, locale)}<ConceptHint concept="bolo" /></span>
        {/if}
      {/snippet}
    </RecordHead>

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
      {locale}
    >
      <!-- ADR-090 P3: the same running order as the Planner's day, in place
           of the fixed five. One way to write an hour in the whole app. -->
      {#snippet schedule()}
        <RunningOrder
          target="performance"
          id={perf.id}
          dayIso={perf.performed_at.slice(0, 10)}
          tz={perf.venue?.timezone ?? workspaceTz ?? viewerTz}
          {viewerTz}
          {locale}
        />
      {/snippet}
    </ProductionStub>

    <!-- ADR-084 §3 — the answer to "is it sorted?", which the month card's
         foot reads. Deliberately separate from the logistics/technical
         CONTENT above: that is where the detail lives, this is the verdict. -->
    <section class="perf__section" aria-label={t('perf.readiness', locale)}>
      <BlockHead title={t('perf.readiness', locale)} />
      <ul class="perf__ready" role="list">
        {#each READINESS_KEYS as key (key)}
          {@const on = isReady(perf.readiness, key)}
          <li>
            <button
              type="button"
              class="perf__ready-item"
              class:perf__ready-item--on={on}
              aria-pressed={on}
              disabled={$patchMutation.isPending}
              onclick={() => toggleReady(key)}
            >
              <span class="perf__ready-box" aria-hidden="true">{on ? '✓' : ''}</span>
              {t(readinessLabelKey(key), locale)}
            </button>
          </li>
        {/each}
      </ul>
    </section>

    {#if hasTeam}
      <section class="perf__section" aria-label={t('perf.team', locale)}>
        <BlockHead title={t('perf.team', locale)} />
        <ul class="perf__people" role="list">
          {#each bundle!.cast_members as m (m.id)}
            <li>
              <span class="perf__person-role">{t('perf.role_cast', locale)} · {m.role}</span>
              <span class="perf__person-name">{m.person?.full_name ?? '—'}</span>
            </li>
          {/each}
          {#each perf.cast_override as o (o.id)}
            <li>
              <span class="perf__person-role">{t('perf.role_cast', locale)} · {o.role}</span>
              <span class="perf__person-name">
                {o.person?.full_name ?? '—'}
                {#if o.replaces_person}
                  <span class="perf__person-note">
                    {t('perf.replaces', locale, { name: o.replaces_person.full_name })}{#if o.reason} — {o.reason}{/if}
                  </span>
                {/if}
              </span>
            </li>
          {/each}
          {#each perf.crew_assignment as c (c.id)}
            <li>
              <span class="perf__person-role">{t('perf.role_crew', locale)} · {c.role}</span>
              <span class="perf__person-name">
                {c.person?.full_name ?? '—'}
                {#if c.notes}<span class="perf__person-note">{c.notes}</span>{/if}
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- ADR-103: «quién va». Next to a roster it only adds people; without
         one it answers the inference from the project cast. The roster is
         drawn above, so it is passed to be left out, not drawn twice. -->
    <!-- `#who-goes`: the Day's clash line lands here (uso #12). -->
    <section class="perf__section" id="who-goes">
      <WhoGoes
        target="performance"
        id={perf.id}
        projectId={bundle!.performance.project?.id ?? null}
        workspaceId={perf.workspace_id}
        commitments={perf.commitments}
        roster={performanceRoster(bundle!)}
        showRoster={false}
        {locale}
      />
    </section>

    <!-- ADR-106: el tablón del bolo. Sin bolo dice que no hay; sin dinero
         siempre (la puerta es la función, no Cuentas). -->
    <BoloBoard
      performanceId={perf.id}
      {workspaceSlug}
      tz={perf.venue?.timezone ?? workspaceTz ?? viewerTz}
      {locale}
    />

    {#if perf.date.length > 0}
      <section class="perf__section" aria-label={t('perf.related_dates', locale)}>
        <BlockHead title={t('perf.dates', locale)} />
        <ul class="perf__dates" role="list">
          {#each perf.date as d (d.id)}
            <li>
              <span class="perf__date-when">{formatDateRow(d)}</span>
              <span class="perf__date-kind">{enumWord('perf.date_kind_', d.kind)}</span>
              <span class="perf__date-title">{d.title ?? ''}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if perf.conversation?.person || perf.conversation?.organization}
      <section class="perf__section" aria-label={t('perf.programmer', locale)}>
        <BlockHead title={t('perf.programmer', locale)} />
        <p class="perf__programmer">
          {#if perf.conversation.person}
            <a href={`/h/${workspaceSlug}/person/${perf.conversation.person.slug}`}>
              {perf.conversation.person.full_name}
            </a>
          {/if}
          {#if perf.conversation.organization?.name || perf.conversation.person?.organization_name}
            <span class="perf__person-note">{perf.conversation.organization?.name || perf.conversation.person?.organization_name}</span>
          {/if}
        </p>
      </section>
    {/if}

    {#if perf.asset_version.length > 0}
      <section class="perf__section" aria-label={t('perf.assets', locale)}>
        <BlockHead title={t('perf.assets', locale)} />
        <ul class="perf__assets" role="list">
          {#each perf.asset_version as a (a.id)}
            <li>
              <span class="perf__asset-dir">{enumWord('perf.asset_dir_', a.direction)}</span>
              <span class="perf__asset-kind">{enumWord('perf.asset_kind_', a.kind)}</span>
              <span class="perf__person-note">{t('perf.asset_registered', locale)}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section class="perf__section" aria-label={t('perf.notes', locale)}>
      <BlockHead title={t('perf.notes', locale)} />
      <YNotes
        targetTable="performance"
        targetId={perf.id}
        placeholder={t('perf.notes_placeholder', locale)}
        {locale}
      />
    </section>
  {/if}
</article>

{#snippet boloMessage()}
  {t('perf.bolo_helper_short', locale)}
  {#if perf?.project && lensOn('books')}
    <!-- Otra pestaña: la edición a medio escribir no se pierde (Marco, 2026-10-10). -->
    <a href={booksHref(perf.project.id, { newBolo: true })} target="_blank" rel="noopener"
      >{t('perf.bolo_create_link', locale)}</a
    >
  {/if}
{/snippet}

<Dialog bind:open={dialogOpen} title={t('perf.edit_title', locale)} size="m">
  {#if showBoloSelect}
    <!-- ADR-087 · § 36 — el mismo campo que el alta, en el mismo orden: el
         trato antes que la fecha. Mover de bolo no toca sala ni ciudad. -->
    <Select
      label={t('perf.bolo', locale)}
      options={bolosOptions}
      bind:value={fBolo}
      message={boloMessage}
    />
  {:else if showBoloEmpty}
    <Select
      label={t('perf.bolo', locale)}
      options={[{ value: '', label: t('perf.bolo_empty', locale) }]}
      disabled
      message={boloMessage}
    />
  {/if}
  <div class="perf__form-grid">
    <Input label={t('perf.date', locale)} type="date" bind:value={fDay} required />
    <Input label={t('create.venue', locale)} bind:value={fVenue} placeholder={t('perf.venue_placeholder', locale)} />
    <Input label={t('create.city', locale)} bind:value={fCity} />
    <Input label={t('perf.country', locale)} bind:value={fCountry} placeholder="ES" />
    {#if showHoldNotice}
      <!-- ADR-080 §2 — discreet, hold-only. Empty = default 30 (the
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
      <label for="f-venue-entity">{t('perf.linked_venue', locale)}</label>
      <select id="f-venue-entity" bind:value={fVenueId}>
        <option value="">{t('perf.linked_venue_none', locale)}</option>
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
      {t('perf.save_as_venue', locale)}
    </Button>
    <Button variant="outline" size="s" disabled={!fVenueId} onclick={openVenueEdit}>
      {t('perf.edit_venue', locale)}
    </Button>
  </div>
  <p class="perf__dialog-hint">{t('perf.linked_venue_hint', locale)}</p>
  {#if perf?.workspace_id}
    <!-- Directorio global de salas: adopt a venue instead of typing it. -->
    <DirectoryPicker workspaceId={perf.workspace_id} {locale} onadopt={onDirectoryAdopt} />
    <p class="perf__dialog-hint">{t('directory.hint', locale)}</p>
  {/if}
  <div class="perf__danger">
    <Button variant="outline" tone="warn" size="s" onclick={() => (confirmDeleteOpen = true)}>
      {t('perf.delete', locale)}
    </Button>
    <span class="perf__dialog-hint">{t('perf.delete_hint', locale)}</span>
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (dialogOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={saveEdit} loading={$patchMutation.isPending}>{t('edit.save', locale)}</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={venueEditOpen} title={t('venue.edit_title', locale)} size="m">
  <p class="perf__dialog-hint">{t('venue.edit_hint', locale)}</p>
  <div class="perf__form-grid">
    <Input label={t('venue.name', locale)} bind:value={vName} required />
    <Input label={t('create.city', locale)} bind:value={vCity} />
    <Input label={t('perf.country', locale)} bind:value={vCountry} placeholder="ES" />
    <Input label={t('venue.capacity', locale)} type="number" bind:value={vCapacity} />
  </div>
  <div class="perf__form-grid">
    <Input label={t('venue.address', locale)} bind:value={vAddress} placeholder={t('venue.address_placeholder', locale)} />
    <div class="field">
      <label for="v-timezone">{t('venue.timezone', locale)}</label>
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
    <p class="eyebrow">{t('venue.contacts', locale)}</p>
    {#each vContacts as _, i (i)}
      <div class="perf__contact-row">
        <Input label={i === 0 ? t('venue.name', locale) : undefined} bind:value={vContacts[i].name} placeholder={t('venue.name', locale)} />
        <Input label={i === 0 ? t('venue.contact_role', locale) : undefined} bind:value={vContacts[i].role} placeholder={t('venue.contact_role_placeholder', locale)} />
        <Input label={i === 0 ? t('settings.email', locale) : undefined} type="email" bind:value={vContacts[i].email} placeholder={t('settings.email', locale)} />
        <Input label={i === 0 ? t('venue.phone', locale) : undefined} type="tel" bind:value={vContacts[i].phone} placeholder={t('venue.phone', locale)} />
        <button
          type="button"
          class="perf__contact-remove"
          aria-label={t('venue.remove_contact', locale)}
          onclick={() => removeContactRow(i)}
        >×</button>
      </div>
    {/each}
    <Button variant="outline" size="xs" onclick={addContactRow}>{t('venue.add_contact', locale)}</Button>
  </div>
  <div class="field perf__venue-notes">
    <label for="v-notes">{t('perf.notes', locale)}</label>
    <textarea id="v-notes" rows="3" bind:value={vNotes}></textarea>
  </div>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (venueEditOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={saveVenue} loading={$venuePatch.isPending}>{t('venue.save', locale)}</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={confirmCancelOpen} title={t('perf.cancel_title', locale)} size="s">
  <p>
    {t('perf.cancel_body', locale, {
      what: title,
      when: perf ? dayLabel(perf.performed_at, 'short') : '',
    })}
  </p>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (confirmCancelOpen = false)}>{t('perf.keep', locale)}</Button>
    <Button
      variant="danger"
      onclick={() => {
        confirmCancelOpen = false;
        $patchMutation.mutate({ status: 'cancelled' });
      }}
      loading={$patchMutation.isPending}
    >
      {t('perf.cancel_confirm', locale)}
    </Button>
  {/snippet}
</Dialog>

<Dialog bind:open={confirmDeleteOpen} title={t('perf.delete_title', locale)} size="s">
  <p>
    {t('perf.delete_body', locale, {
      what: title,
      when: perf ? dayLabel(perf.performed_at, 'short') : '',
    })}
  </p>
  <p class="perf__dialog-hint">{t('perf.delete_no_undo', locale)}</p>
  {#snippet actions()}
    <Button variant="outline" onclick={() => (confirmDeleteOpen = false)}>{t('perf.keep', locale)}</Button>
    <Button variant="danger" onclick={() => $deleteMutation.mutate()} loading={$deleteMutation.isPending}>
      {t('edit.delete', locale)}
    </Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .perf__roadsheet-link {
      display: inline-flex;
      align-items: center;
      font-size: var(--text-s);
    }

    .perf__dialog-hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .perf__danger > :global(button) {
      flex: none;
    }

    .perf__danger .perf__dialog-hint {
      flex: 1 1 14rem;
    }

    .perf__form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: var(--space-s) var(--space-m);
      margin-block-start: var(--space-s);
    }

    /* Wraps: at phone width the select was squeezed to its caret by the
       two buttons beside it. */
    .perf__venue-link {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: var(--space-s) var(--space-m);
      margin-block-start: var(--space-s);
    }
    .perf__venue-link .field {
      flex: 1 1 14rem;
    }

    /* The button keeps its one line; the hint is what wraps (it broke
       «Delete performance…» in two at every width). */
    .perf__danger {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-s) var(--space-m);
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

    /* Readiness — a checklist you TICK, not a status you read. The whole
       row is the target (box + word), never a 12px square. */
    .perf__ready {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs) var(--space-m);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .perf__ready-item {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2xs);
      appearance: none;
      border: 0;
      padding: 0;
      background: none;
      font: inherit;
      color: var(--text-muted);
      cursor: pointer;
    }
    .perf__ready-item:disabled {
      cursor: progress;
      opacity: 0.6;
    }
    .perf__ready-item--on {
      color: var(--text-color);
    }
    .perf__ready-box {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: 1.1em;
      block-size: 1.1em;
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-s);
      font-size: 0.8em;
      line-height: 1;
    }
    .perf__ready-item--on .perf__ready-box {
      border-color: transparent;
      background: color-mix(in oklch, var(--success, var(--text-color)) 18%, transparent);
      color: var(--success, var(--text-color));
    }
    .perf__ready-item:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 2px;
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
      min-inline-size: var(--record-label-inline);
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
