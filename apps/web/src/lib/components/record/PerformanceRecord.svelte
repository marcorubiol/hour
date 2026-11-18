<script lang="ts">
  /**
   * Performance detail — Phase 0.1 trabajo #3, mobile-first (single
   * column; wide screens get breathing room, not a second column).
   *
   * Data: GET /api/performances/:slug?ws=<workspace> — the full bundle
   * (venue, schedule, jsonb, crew, cast, dates, assets, programmer).
   * The road sheet sub-view (ADR-023) links from the header.
   *
   * One record, two frames (ADR-139 p1 A): the page `/h/<space>/performance/
   * <slug>` and the vistazo over a lens draw THIS component, so «abrir
   * completa» lands on the same head, facts, «Falta» and blocks.
   *
   * The «pase» (brief `ficha-pase`; ADR-212, ADR-213): the piece and its
   * stub, then the day stop by stop (the running order, `placing="stops"`,
   * with a trip's ends, the show without an hour and the night woven in, and
   * the address and the contact hung on their stop). No «Edit details»: the
   * date and the place change in place on the piece, each saving itself;
   * only what does not fit a row (the linked venue, the directory) waits
   * behind «Cambiar de sala…», and the bolo behind its own small dialog.
   */

  import { docTitle } from '$lib/doc-title';
  import { goto } from '$app/navigation';
  import { closePeek } from '$lib/peek.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { retryLoad } from '$lib/load-fail';
  import RecordState from '$lib/components/RecordState.svelte';
  import Button from '$lib/components/Button.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import VenueEditDialog, { type VenueEditable } from '$lib/components/VenueEditDialog.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Field from '$lib/components/Field.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import ProductionStub from '$lib/components/ProductionStub.svelte';
  import PerformanceCopyDialog from './PerformanceCopyDialog.svelte';
  import RunningOrder from '$lib/components/RunningOrder.svelte';
  import YNotes from '$lib/components/YNotes.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import type { Json } from '$lib/db-types';
  import type { KVObject } from '$lib/kv-lines';
  import { dayLabel, dayMonth, localDayISO, timeInTz, viewerTimeZone } from '$lib/datetime';
  import { LOCALE_TAG, appLocale, tHere, setRecordSpace, tradeFor } from '$lib/i18n';
  import {
    HOLD_NOTICE_DEFAULT,
    PERFORMANCE_MENU_STATUSES,
    holdDeadlineLabel,
    isHoldStatus,
    isValidHoldNotice,
    performanceStatusTone,
    performanceStatusLabel,
    type PerformancePatch,
    type PerformanceStatus,
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
  import { usePins } from '$lib/stores/pins.svelte';
  import { lensOn } from '$lib/lenses.svelte';
  import { performanceBoloQueryOptions, projectBolosQueryOptions } from '$lib/bolo-queries';
  import { teamQueryOptions, workspacesQueryOptions } from '$lib/nav-queries';
  import { goingPersonIds, type GoingPerson } from '$lib/bolo-access';
  import RecordHead from '$lib/components/RecordHead.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import { spaceCrumb, type Crumb } from '$lib/record-crumbs';
  import { isGuestIn } from '$lib/workspace-role';
  import Fold from '$lib/components/Fold.svelte';
  import RecordPass, { passToneVar, type PassAct, type PassBox, type PassLine } from './RecordPass.svelte';
  import { daysBetween } from '$lib/away';
  import { logisticsLines, mapsHref, telHref, venueCall } from '$lib/ahora';
  import MapLink from '$lib/components/MapLink.svelte';
  import { tripStops, type ExtraStop, type TripStage, type TripStop } from '$lib/pass-stops';
  import { dayOf } from '$lib/running-order';
  import { hasJsonContent } from '$lib/components/JsonKV.svelte';
  import {
    MISSING_MAX,
    performanceMissing,
    performanceReadiness,
    type PerformanceMissing,
    type PerformanceMissingInput,
    type ReadinessBox,
  } from '$lib/record-missing';
  import { shareExpired, type RoadsheetShare } from '$lib/roadsheet';

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
        contacts?: Json;
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
  };

  interface Props {
    workspaceSlug: string;
    slug: string;
    /** Drawn in the vistazo (ADR-139 p1): no document title, and a delete closes the panel. */
    inPeek?: boolean;
  }

  let { workspaceSlug, slug, inPeek = false }: Props = $props();
  setRecordSpace(() => workspaceSlug);
  const t = tHere();
  // «Crear el bolo» in Cuentas leaves your scope alone when it already shows
  // the project. The bolo links keep `scope=p:`: a click peeks the bolo, and
  // the peek reads its project there (`peekFromLink`).
  const pins = usePins();
  let booksHere = $derived({ pins: pins.pins, workspaceSlug });

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
      boloDialogOpen = false;
      markSaved();
      // The row the PATCH answers goes into the cache now: reopening «Edit
      // details» before the refetch lands must not fill the form from the old
      // row (a «save as venue» would read «None» and unlink it on the next
      // save). The embeds are not in the answer: the venue's stays only while
      // the link is the same, and the refetch brings the rest.
      queryClient.setQueryData<Bundle>(['performance', { ws: workspaceSlug, slug }], (old) => {
        if (!old) return old;
        const row = body.performance as Partial<Bundle['performance']>;
        const venueId = row.venue_id === undefined ? old.performance.venue_id : row.venue_id;
        return {
          ...old,
          performance: {
            ...old.performance,
            ...row,
            venue: old.performance.venue?.id === venueId ? old.performance.venue : null,
          },
        };
      });
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
   * Logística, acogida y técnica, línea a línea (Marco, 2026-10-20): the
   * same PATCH, without the generic mutation's toast. These save in place,
   * so «guardado» and a failure are said on the row (`JsonKVEdit`), never in
   * a corner (ADR-139 p7).
   */
  async function saveJson(field: 'logistics' | 'hospitality' | 'technical', next: KVObject) {
    await mutateJSON(
      'PATCH',
      `/api/performances/${encodeURIComponent(slug)}?ws=${encodeURIComponent(workspaceSlug)}`,
      { [field]: next } satisfies PerformancePatch,
    );
    void queryClient.invalidateQueries({ queryKey: ['performance'] });
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

  const locale = appLocale();

  /** «Cambiar de sala…»: the linked venue and the directory (ADR-213). */
  let dialogOpen = $state(false);
  let fVenue = $state('');
  let fCity = $state('');
  let fCountry = $state('');
  let fVenueId = $state('');
  // «Save as venue» is kept as an intent and done by «Save» (ADR-139 p7).
  let fSaveAsVenue = $state(false);
  // ADR-080 §2 — hold decision notice, in place while the gig is hold*.
  // null = empty = standard default.
  let fHoldNotice = $state<number | null>(null);
  let holdNoticeBad = $state(false);
  // ADR-087 · § 36 — el bolo del que cuelga; '' = sin bolo.
  let fBolo = $state('');
  let boloDialogOpen = $state(false);

  function openVenueDialog() {
    if (!perf) return;
    fVenue = perf.venue_name ?? '';
    fCity = perf.city ?? '';
    fCountry = perf.country ?? '';
    fVenueId = perf.venue_id ?? '';
    fSaveAsVenue = false;
    dialogOpen = true;
  }

  function openBolo() {
    fBolo = currentBoloId ?? '';
    boloDialogOpen = true;
  }

  // ── Each change saves itself (ADR-139 p4, p7; ADR-213) ─────────────────
  let saved = $state(false);
  let savedTimer: ReturnType<typeof setTimeout> | undefined;
  function markSaved() {
    saved = true;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (saved = false), 2000);
  }
  /** One field, one PATCH: «Guardado» on the piece, a failure in a toast. */
  function savePatch(patch: PerformancePatch) {
    $patchMutation.mutate(patch);
  }

  let editingDate = $state(false);
  let editingPlace = $state(false);
  function onDateChange(value: string) {
    if (!perf || !value || value === perf.performed_at.slice(0, 10)) return;
    savePatch({ performed_at: value });
  }
  /** A text field of the place, saved when it changes; empty is null. */
  function onPlaceChange(field: 'venue_name' | 'city' | 'country', value: string) {
    if (!perf) return;
    const next = value.trim() || null;
    if (next === (perf[field] ?? null)) return;
    savePatch({ [field]: next });
  }
  function onHoldNoticeChange() {
    holdNoticeBad = !isValidHoldNotice(fHoldNotice);
    if (holdNoticeBad || !perf || fHoldNotice === perf.hold_notice_days) return;
    savePatch({ hold_notice_days: fHoldNotice });
  }
  $effect(() => {
    if (perf) fHoldNotice = perf.hold_notice_days;
  });

  /** Focus a field the moment it appears (the date opened in place). */
  function focusNow(node: HTMLInputElement) {
    node.focus();
  }

  // «Cambiar de sala…»: the venue asked for with «Save as venue» is made
  // now, then linked in the same PATCH; if it cannot be made, nothing else
  // is written either.
  async function saveVenue() {
    let venueId = fVenueId || null;
    if (fSaveAsVenue && !venueId && fVenue.trim()) {
      try {
        venueId = (await $promoteVenue.mutateAsync()).id;
      } catch {
        return;
      }
    }
    $patchMutation.mutate({
      venue_name: fVenue.trim() || null,
      city: fCity.trim() || null,
      country: fCountry.trim() || null,
      venue_id: venueId,
    });
  }

  function saveBolo() {
    const next = boloPatch(currentBoloId, fBolo);
    if ('bolo_id' in next) $patchMutation.mutate(next);
    else boloDialogOpen = false;
  }

  let bundle = $derived($query.data ?? null);
  let perf = $derived(bundle?.performance ?? null);

  // WHO WRITES HERE (`edit:performance` on the project): the running order's
  // own answer (`/api/schedule`), under its key, so the two share one
  // request. Only an explicit «no» takes the doors away (as the lenses and
  // access do): a guest of a bolo reads the performance, its board and its
  // road sheet, and is offered no editor that would answer 403.
  const editQuery = createQuery(
    toStore(() => ({
      queryKey: ['schedule', 'performance', perf?.id ?? ''] as const,
      enabled: Boolean(perf?.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ slots: unknown[]; can_edit: boolean }>(`/api/schedule/performance/${perf!.id}`, signal),
    })),
  );
  let canEdit = $derived($editQuery.data?.can_edit !== false);

  // «Invitar» (ADR-173 § 10, plan del público § 6.1): una invitación en
  // borrador con proyecto y función puestos, sin destinatarios; en su pantalla
  // se elige la lista, profesionales o los dos.
  const inviteAccess = createQuery(
    toStore(() => ({
      queryKey: ['can-invite', perf?.workspace_id ?? '', perf?.project?.id ?? ''] as const,
      enabled: Boolean(perf?.workspace_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ can_invite: boolean }>(
          `/api/mailout/invitation?workspace_id=${perf!.workspace_id}&project_id=${perf!.project?.id ?? ''}`,
          signal,
        ),
    })),
  );
  let canInvite = $derived($inviteAccess.data?.can_invite === true);
  const invite = createMutation({
    mutationFn: () =>
      mutateJSON<{ id: string; workspace_slug: string }>('POST', '/api/mailout/invitation', {
        workspace_id: perf!.workspace_id,
        performance_id: perf!.id,
      }),
    onSuccess: (r) => {
      if (r) void goto(`/h/${r.workspace_slug}/mailout/${r.id}`);
    },
    onError: (err) =>
      addToast({
        tone: 'danger',
        title: t('mailout.not_created', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      }),
  });

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
  let bolosOptions = $derived(boloOptions(projectBolos, locale, currentBoloId, tradeFor(workspaceSlug)));
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

  // ADR-080 §2 — the notice field rides the dialog only for hold* gigs.
  let showHoldNotice = $derived(Boolean(perf && isHoldStatus(perf.status)));

  // Address: Space › Project › [Line ›] Función. The title is the venue (a
  // performance has no name of its own), so the address ends with the kind.
  let crumbs = $derived.by<Crumb[]>(() => {
    // A guest of the space (here through a bolo) has no portada of it to go
    // back to: the space is named, not linked.
    const space = spaceCrumb(activeWorkspaceName, workspaceSlug);
    const out: Crumb[] = [
      isGuestIn($wsQuery.data?.items.find((w) => w.slug === workspaceSlug)) ? { ...space, href: undefined } : space,
    ];
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
      if (inPeek) closePeek();
      else await goto('/h/planner');
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

  // Promote the typed venue fields to a venue row, from «Save» only (see
  // saveEdit). Idempotent server-side: an existing name+city match returns
  // the existing venue.
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
      fSaveAsVenue = false;
      void queryClient.invalidateQueries({ queryKey: ['venues'] });
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

  // ── Venue edit (ADR-053): one editor, `VenueEditDialog`, also drawn by
  // the venue's own record (ADR-164 § 1). ────────────────────────────────
  let venueEditOpen = $state(false);
  let editingVenue = $derived<VenueEditable | null>(venues.find((vn) => vn.id === fVenueId) ?? null);

  function openVenueEdit() {
    if (editingVenue) venueEditOpen = true;
  }

  let loading = $derived($query.isPending);

  const viewerTz = viewerTimeZone();

  // Timezone rule (spec § Timezone rule): hours are the VENUE's wall clock,
  // falling back to the home space's when no venue is linked, never silently
  // the browser's. The running order (ADR-090 P3) types its hours here; the
  // details dialog no longer carries the five slots.
  let workspaceTz = $derived(
    $wsQuery.data?.items.find((w) => w.slug === workspaceSlug)?.timezone ?? null,
  );

  // The title is the venue: when it is a venue of the space, it links to its
  // record (ADR-164 § 1); its id while it has no slug (the route reads both).
  let titleHref = $derived(
    perf?.venue ? `/h/${workspaceSlug}/venue/${encodeURIComponent(perf.venue.slug ?? perf.venue.id)}` : null,
  );

  // «Con <organización>»: who the deal is with, a fact of the head that opens
  // the conversation (ADR-138 § 6, ADR-164 § 3). Its organization, else the
  // contact's own, else the contact.
  let withWhom = $derived.by(() => {
    const c = perf?.conversation;
    if (!c) return null;
    const name = c.organization?.name || c.person?.organization_name || c.person?.full_name || '';
    return name ? { name, href: `/h/${workspaceSlug}/conversation/${encodeURIComponent(c.slug || c.id)}` } : null;
  });

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

  // Comms carril 2, fase 2: quién va (reparto y «voy»), con nombre, para
  // que el acceso del bolo proponga invitar a quien va y no lo ve. Los
  // nombres, del propio bundle y del equipo (la misma consulta que «quién va»).
  const goingTeamQuery = createQuery(
    toStore(() => teamQueryOptions(perf?.workspace_id ? [perf.workspace_id] : [])),
  );
  let goingPeople = $derived.by<GoingPerson[]>(() => {
    if (!bundle || !perf) return [];
    const names = new Map<string, string>();
    for (const m of $goingTeamQuery.data?.items ?? []) names.set(m.person_id, m.full_name);
    for (const c of bundle.cast_members) if (c.person) names.set(c.person.id, c.person.full_name);
    for (const o of perf.cast_override) if (o.person) names.set(o.person.id, o.person.full_name);
    for (const c of perf.crew_assignment) if (c.person) names.set(c.person.id, c.person.full_name);
    return goingPersonIds(performanceRoster(bundle), perf.commitments).flatMap((id) => {
      const name = names.get(id);
      return name ? [{ person_id: id, name }] : [];
    });
  });

  let hasTeam = $derived(
    (bundle?.cast_members.length ?? 0) > 0 ||
      (perf?.cast_override.length ?? 0) > 0 ||
      (perf?.crew_assignment.length ?? 0) > 0,
  );

  // ── Hechos y «Falta» (ADR-139 p2 A) ────────────────────────────────────
  // La hora de la función, en el reloj de la sala (regla de zona horaria).
  let startTime = $derived(
    perf?.start_at ? timeInTz(perf.start_at, perf.venue?.timezone ?? workspaceTz ?? viewerTz) : null,
  );

  // Los enlaces de la hoja de ruta: la misma lectura (y caché) que su página.
  // Solo los ve quien edita la función; para el resto la respuesta es un
  // error y «Falta» no pregunta por ellos (null: no lo sabe).
  const sharesQuery = createQuery(
    toStore(() => {
      const k = { ws: workspaceSlug, slug };
      return {
        queryKey: ['roadsheet-shares', k] as const,
        enabled: perf?.status === 'confirmed',
        retry: false,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          fetchJSON<{ items: RoadsheetShare[] }>(
            `/api/performances/${encodeURIComponent(k.slug)}/roadsheet/shares?ws=${encodeURIComponent(k.ws)}`,
            signal,
          ),
      };
    }),
  );

  const today = localDayISO();
  let missingInput = $derived<PerformanceMissingInput | null>(
    perf && bundle
      ? {
          status: perf.status,
          day: perf.performed_at,
          hold_notice_days: perf.hold_notice_days,
          roster: performanceRoster(bundle),
          commitments: perf.commitments,
          start_at: perf.start_at,
          hasBolo: boloReadable ? currentBoloId !== null : null,
          // An expired link opens nothing (ADR-163 § 2): it does not count.
          roadsheetLinks: $sharesQuery.isSuccess
            ? $sharesQuery.data.items.filter((l) => !shareExpired(l.expires_at)).length
            : null,
        }
      : null,
  );
  let missing = $derived<PerformanceMissing[]>(missingInput ? performanceMissing(missingInput, today) : []);
  // El talón del pase: las casillas, derivadas de lo mismo que «Falta».
  let readiness = $derived<ReadinessBox[]>(missingInput ? performanceReadiness(missingInput, today) : []);

  function missingItem(m: PerformanceMissing): PassLine {
    switch (m.kind) {
      case 'hold_deadline':
        return {
          id: 'hold_deadline',
          text: t('record.missing_hold', locale),
          meta: holdDeadlineLabel(m.day, today, locale, LOCALE_TAG[locale]),
          verbs: [
            { label: t('record.verb_confirm', locale), onclick: () => changeStatus('confirmed'), disabled: $patchMutation.isPending },
            { label: t('record.verb_release', locale), onclick: () => changeStatus('cancelled'), disabled: $patchMutation.isPending },
          ],
        };
      case 'nobody_going':
        return {
          id: 'nobody_going',
          text: t('record.missing_nobody_going', locale),
          verbs: [{ label: t('record.verb_sign_up', locale), href: '#who-goes' }],
        };
      case 'no_bolo':
        return {
          id: 'no_bolo',
          text: t('record.missing_no_bolo', locale),
          verbs: showBoloSelect
            ? [{ label: t('record.verb_pick', locale), onclick: openBolo }]
            : perf?.project && lensOn('books')
              ? [{ label: t('perf.bolo_create_link', locale), href: booksHref(perf.project.id, { newBolo: true, here: booksHere }) }]
              : [],
        };
      case 'no_time':
        return {
          id: 'no_time',
          text: t('record.missing_no_time', locale),
          verbs: [{ label: t('record.verb_add', locale), href: '#running-order' }],
        };
      case 'roadsheet_unshared':
        return {
          id: 'roadsheet_unshared',
          text: t('record.missing_roadsheet', locale),
          verbs: [{ label: t('record.verb_share', locale), href: `/h/${workspaceSlug}/performance/${slug}/roadsheet` }],
        };
    }
  }
  let missingItems = $derived(missing.map(missingItem));

  // ── El pase (brief ficha-pase, fase 1) ─────────────────────────────────
  const BOX_LABEL: Record<ReadinessBox['id'], string> = {
    status: 'pass.box_status',
    hours: 'pass.box_hours',
    team: 'pass.box_team',
    sheet: 'pass.box_sheet',
  };
  let passBoxes = $derived<PassBox[]>(readiness.map((b) => ({ id: b.id, label: t(BOX_LABEL[b.id], locale), done: b.done })));

  /** One line per open box, with its verb, then what the stub has no box for
      («sin bolo»); never more than `MISSING_MAX` (ADR-139 § 2). */
  function boxLine(b: ReadinessBox): PassLine | null {
    switch (b.id) {
      case 'status':
        if (b.holdDay) return missingItem({ kind: 'hold_deadline', day: b.holdDay });
        return {
          id: 'status',
          text: t('pass.line_status', locale),
          verbs: [{ label: t('record.verb_confirm', locale), onclick: () => changeStatus('confirmed'), disabled: $patchMutation.isPending }],
        };
      case 'hours':
        return missingItem({ kind: 'no_time' });
      case 'team':
        return missingItem({ kind: 'nobody_going' });
      case 'sheet':
        return missingItem({ kind: 'roadsheet_unshared' });
    }
  }
  let passLines = $derived<PassLine[]>(
    canEdit
      ? [
          ...readiness.filter((b) => !b.done).flatMap((b) => boxLine(b) ?? []),
          ...missing.filter((m) => m.kind === 'no_bolo').map(missingItem),
        ].slice(0, MISSING_MAX)
      : [],
  );

  let passWhen = $derived.by(() => {
    if (!perf) return '';
    const d = daysBetween(today, perf.performed_at.slice(0, 10));
    if (d === 0) return t('pass.when_today', locale);
    if (d === 1) return t('pass.when_tomorrow', locale);
    if (d === -1) return t('pass.when_yesterday', locale);
    return t(d > 0 ? 'pass.when_in' : 'pass.when_ago', locale, { n: Math.abs(d) });
  });
  let passPlace = $derived(
    [perf?.venue?.name ?? perf?.venue_name, placeLine].filter(Boolean).join(' · '),
  );
  let passActs = $derived.by<PassAct[]>(() => {
    if (!perf) return [];
    const out: PassAct[] = [];
    const call = venueCall(perf.venue?.contacts);
    if (call?.phone) {
      out.push({ id: 'call', label: t('ahora.call', locale), href: telHref(call.phone), ariaLabel: t('ahora.call_aria', locale, { name: call.name }) });
    }
    const v = perf.venue;
    const mapParts = v?.address ? [v.address, v.city ?? perf.city] : [v?.name ?? perf.venue_name, v?.city ?? perf.city];
    if (mapsHref(mapParts) !== null) out.push({ id: 'map', label: t('ahora.map', locale), map: mapParts });
    out.push({ id: 'sheet', label: t('ahora.sheet', locale), href: `/h/${workspaceSlug}/performance/${slug}/roadsheet`, ariaLabel: t('roadsheet.open', locale) });
    return out;
  });

  // ── El día, parada a parada (ADR-213) ──────────────────────────────────
  let dayTz = $derived(perf?.venue?.timezone ?? workspaceTz ?? viewerTz);
  let dayIso = $derived(perf?.performed_at.slice(0, 10) ?? '');

  // A trip of the same project that day lends its ends as stops, read-only,
  // with a link to it (Marco's answer 3, 18-11). Same feed as the Planner's.
  type TripRow = { id: string; kind: string; stages?: TripStage[] };
  const tripsQuery = createQuery(
    toStore(() => ({
      queryKey: ['performance-day-trips', perf?.project?.id ?? '', dayIso] as const,
      enabled: Boolean(perf?.project?.id && dayIso),
      retry: false,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: TripRow[] }>(
          `/api/dates?project_ids=${perf!.project!.id}&from=${dayIso}&to=${dayIso}&spans=1&stages=1&limit=20`,
          signal,
        ),
    })),
  );
  let tripExtras = $derived<TripStop[]>(
    ($tripsQuery.data?.items ?? [])
      .filter((d) => d.kind === 'travel_day')
      .flatMap((d) => tripStops(d.id, d.stages ?? [], (iso) => dayOf(iso, dayTz) === dayIso)),
  );

  let logistics = $derived(logisticsLines(perf?.logistics));
  let hotelLine = $derived(logistics.hotel ?? null);
  let dayExtras = $derived<ExtraStop[]>([
    ...tripExtras,
    // The show without an hour: a stop with a dash (the running order drops
    // it once a row is the show).
    { key: 'show', kind: 'show', at: null },
    ...(hotelLine ? [{ key: 'night', kind: 'night' as const, at: null }] : []),
  ]);

  // What hangs on the stops: the address and the load access on the arrival,
  // the contact on the load-in (`hangPlaces`).
  let dayAddress = $derived(
    [perf?.venue?.address, logistics.load_access, logistics.parking].filter(Boolean).join(' · ') || null,
  );
  let dayMap = $derived(
    perf?.venue?.address ? [perf.venue.address, perf.venue.city ?? perf.city] : null,
  );
  let dayCall = $derived(venueCall(perf?.venue?.contacts));
  let dayContact = $derived(
    dayCall ? [dayCall.name, dayCall.role].filter(Boolean).join(', ') : null,
  );

  // «Detalles»: lo de consulta, plegado. Cerrado, dice lo que guarda.
  let detailsOpen = $state(false);
  let copyOpen = $state(false);
  let hasProduction = $derived(
    Boolean(
      perf &&
        (perf.venue?.address ||
          perf.venue?.capacity ||
          perf.venue?.timezone ||
          (Array.isArray(perf.venue?.contacts) && perf.venue.contacts.length > 0) ||
          hasJsonContent(perf.logistics) ||
          hasJsonContent(perf.hospitality) ||
          hasJsonContent(perf.technical)),
    ),
  );
  let detailsKeeps = $derived(
    perf
      ? [
          hasProduction ? t('perf.production', locale) : null,
          perf.date.length > 0 ? `${t('perf.dates', locale)} ${perf.date.length}` : null,
          perf.asset_version.length > 0 ? `${t('perf.assets', locale)} ${perf.asset_version.length}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : '',
  );
</script>

<svelte:head>
  {#if !inPeek}<title>{docTitle(title, t('perf.label', locale))}</title>{/if}
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
    <RecordHead
      {crumbs}
      {title}
      {titleHref}
      tools={[
        {
          label: t('roadsheet.open', locale),
          href: `/h/${workspaceSlug}/performance/${slug}/roadsheet`,
          concept: 'roadsheet' as const,
        },
        ...(canInvite
          ? [{ label: t('audience.invite_from_performance', locale), loading: $invite.isPending, onclick: () => $invite.mutate() }]
          : []),
      ]}
    >
      <!-- Los hechos, cada uno su editor (ADR-139 p2): el estado, la insignia
           de siempre con su menú (ADR-130 § 2, tarea 134), el cuándo y el dónde abren los datos, el bolo se
           elige en sitio. La sala no: es el título. -->
      {#snippet facts()}
        {#if withWhom}
          <span data-testid="perf-with"
            >{t('perf.with', locale)} <a class="lenshead__frag" href={withWhom.href}>{withWhom.name}</a></span
          >
        {/if}
        {#if boloReadable && currentBolo && perf!.project}
          <span class="perf__bolo-fact">
            {#if showBoloSelect}
              <Menu label={t('record.bolo_menu', locale, { bolo: boloOf(currentBolo, locale, tradeFor(workspaceSlug)) })} triggerClass="fact-act">
                {#snippet trigger()}{boloOf(currentBolo, locale, tradeFor(workspaceSlug))}<span class="status-caret" aria-hidden="true">▾</span>{/snippet}
                {#snippet children({ close })}
                  {#each bolosOptions as o (o.value)}
                    <li role="none">
                      <button
                        type="button"
                        role="menuitem"
                        class="menu__item{o.value === (currentBoloId ?? '') ? ' menu__item--active' : ''}"
                        onclick={() => {
                          close();
                          const next = boloPatch(currentBoloId, o.value);
                          if ('bolo_id' in next) $patchMutation.mutate(next);
                        }}>{o.label}</button
                      >
                    </li>
                  {/each}
                  {#if lensOn('books')}
                    <li class="menu-separator" role="separator"></li>
                    <li role="none">
                      <a role="menuitem" class="menu__item" href={booksHref(perf!.project!.id, { boloId: currentBolo!.id })}
                        >{t('record.bolo_in_books', locale)}</a
                      >
                    </li>
                  {/if}
                {/snippet}
              </Menu>
            {:else if lensOn('books')}
              <a class="lenshead__frag" href={booksHref(perf!.project.id, { boloId: currentBolo.id })}>{boloOf(currentBolo, locale, tradeFor(workspaceSlug))}</a>
            {:else}
              {boloOf(currentBolo, locale, tradeFor(workspaceSlug))}
            {/if}
            <ConceptHint concept="bolo" />
          </span>
        {/if}
      {/snippet}
    </RecordHead>

    <!-- El pase (brief ficha-pase, fase 1): la pieza llena con la hora, el
         estado como etiqueta, el talón «Listo N de M» y las acciones. Sustituye
         a la línea de datos y a «Falta»; lo demás de la ficha sigue igual. -->
    <RecordPass
      {locale}
      project={perf.project}
      eyebrow={`${t('perf.label', locale)} · ${passWhen}`}
      date={dayLabel(perf.performed_at, 'short')}
      time={startTime}
      show={perf.project?.name ?? null}
      place={passPlace}
      onEditDate={canEdit ? () => (editingDate = true) : null}
      onEditPlace={canEdit ? () => (editingPlace = true) : null}
      dateEdit={editingDate ? dateEdit : null}
      placeEdit={editingPlace ? placeEdit : null}
      {saved}
      editDateLabel={t('record.edit_when', locale)}
      editPlaceLabel={t('record.edit_where', locale)}
      acts={passActs}
      boxes={passBoxes}
      lines={passLines}
    >
      {#snippet tag()}
        {#if canEdit}
          <Menu
            label={t('perf.status_menu', locale, { status: performanceStatusLabel(perf!.status, locale) })}
            triggerClass="pass__tag"
            triggerAttrs={{ 'data-testid': 'perf-status', style: `--pass-tone: ${passToneVar(performanceStatusTone(perf!.status))}` }}
          >
            {#snippet trigger()}{performanceStatusLabel(perf!.status, locale)}<span class="status-caret" aria-hidden="true">▾</span>{/snippet}
            {#snippet children({ close })}
              <!-- «Facturado» y «cobrado» son del bolo: se leen en el trigger si
                   la función ya los tiene, no se ofrecen (Marco, 2026-10-20). -->
              {#each PERFORMANCE_MENU_STATUSES as s (s)}
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
        {:else}
          <span
            class="pass__tag"
            data-testid="perf-status"
            style={`--pass-tone: ${passToneVar(performanceStatusTone(perf!.status))}`}>{performanceStatusLabel(perf!.status, locale)}</span
          >
        {/if}
      {/snippet}
    </RecordPass>


    {#snippet dateEdit()}
      <input
        class="pass__in"
        type="date"
        aria-label={t('perf.date', locale)}
        value={perf!.performed_at.slice(0, 10)}
        use:focusNow
        onchange={(e) => onDateChange(e.currentTarget.value)}
        onblur={() => (editingDate = false)}
        onkeydown={(e) => {
          if (e.key === 'Escape' || e.key === 'Enter') editingDate = false;
        }}
      />
    {/snippet}

    {#snippet placeEdit()}
      {#if perf!.venue}
        <span class="perf__place-linked">{passPlace}</span>
      {:else}
        <span class="perf__place-fields">
          <label class="perf__place-field"
            ><span>{t('perf.venue', locale)}</span><input
              class="pass__in"
              value={perf!.venue_name ?? ''}
              placeholder={t('perf.venue_placeholder', locale)}
              onchange={(e) => onPlaceChange('venue_name', e.currentTarget.value)}
            /></label
          >
          <label class="perf__place-field"
            ><span>{t('create.city', locale)}</span><input
              class="pass__in"
              value={perf!.city ?? ''}
              onchange={(e) => onPlaceChange('city', e.currentTarget.value)}
            /></label
          >
          <label class="perf__place-field perf__place-field--short"
            ><span>{t('perf.country', locale)}</span><input
              class="pass__in"
              value={perf!.country ?? ''}
              placeholder="ES"
              onchange={(e) => onPlaceChange('country', e.currentTarget.value)}
            /></label
          >
        </span>
      {/if}
      <span class="perf__place-acts">
        <button type="button" class="pass__btn" onclick={openVenueDialog}>{t('pass.change_venue', locale)}</button>
        <button type="button" class="pass__btn" onclick={() => (editingPlace = false)}>{t('pass.done', locale)}</button>
      </span>
    {/snippet}

    {#snippet dayStop(stop: ExtraStop)}
      {#if stop.kind === 'show'}
        <span class="hours__w perf__stop-show">{t('desk.anchor_show', locale)}</span>
      {:else if stop.kind === 'night'}
        <span class="hours__w">{t('pass.stop_hotel', locale)}</span>
        {#if hotelLine}<span class="hours__n">{hotelLine}</span>{/if}
      {:else}
        {@const trip = stop as TripStop}
        <span class="hours__w"
          >{trip.place
            ? t(trip.kind === 'depart' ? 'pass.stop_depart' : 'pass.stop_arrive', locale, { place: trip.place })
            : t(trip.kind === 'depart' ? 'pass.stop_depart_bare' : 'pass.stop_arrive_bare', locale)}</span
        >
        <a class="hours__n perf__stop-link" href={`/h/planner?peek=date/${trip.tripId}`}>{t('pass.stop_trip', locale)}</a>
      {/if}
    {/snippet}

    {#snippet addressHang()}
      <span class="hours__n">{dayAddress}</span>
      {#if dayMap}
        <span class="perf__hang-acts"><MapLink class="perf__hang-act" parts={dayMap} changeIn="settings">{t('ahora.map', locale)}</MapLink></span>
      {/if}
    {/snippet}

    {#snippet contactHang()}
      <span class="hours__n">{dayContact}</span>
      {#if dayCall?.phone}
        <span class="perf__hang-acts"
          ><a class="perf__hang-act" href={telHref(dayCall.phone)}>{t('pass.call_name', locale, { name: dayCall.name })}</a></span
        >
      {/if}
    {/snippet}
    <!-- El día, parada a parada (ADR-213): the running order as stops, the
         show the big one, a trip's ends and the night woven in, and the
         address and the contact hung on their stop. One way to write an
         hour in the whole app (ADR-090 P3). -->
    <div id="running-order">
      <RunningOrder
        target="performance"
        id={perf.id}
        dayIso={perf.performed_at.slice(0, 10)}
        tz={perf.venue?.timezone ?? workspaceTz ?? viewerTz}
        {viewerTz}
        {locale}
        placing="stops"
        title={t(perf.start_at ? 'pass.day_title' : 'pass.day_title_open', locale)}
        extras={dayExtras}
        extra={dayStop}
        hangs={{ address: dayAddress ? addressHang : undefined, contact: dayContact ? contactHang : undefined }}
      />
    </div>
    <!-- ADR-103: «quién va», con el reparto al lado. Sube: es lo que se
         decide (ADR-139 p2); `#who-goes` es donde cae la línea de choques
         del Día (uso #12) y el «apuntar» de «Falta». -->
    <!-- Read-only and empty (a guest of a bolo, nobody said anything yet):
         nothing to read and nothing to do, so no block. -->
    {#if canEdit || hasTeam || (perf.commitments?.length ?? 0) > 0}
      <section class="perf__section" id="who-goes">
        <WhoGoes
          target="performance"
          id={perf.id}
          workspaceId={perf.workspace_id}
          commitments={perf.commitments}
          roster={performanceRoster(bundle!)}
          showRoster={false}
          editable={canEdit}
          {locale}
        />
        {#if hasTeam}
          <ul class="perf__people" role="list" aria-label={t('perf.team', locale)}>
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
                      {t('perf.replaces', locale, { name: o.replaces_person.full_name })}{#if o.reason} · {o.reason}{/if}
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
        {/if}
      </section>
    {/if}

    <!-- ADR-106: el tablón del bolo. Sin bolo dice que no hay; sin dinero
         siempre (la puerta es la función, no Cuentas). -->
    <BoloBoard
      performanceId={perf.id}
      {workspaceSlug}
      tz={perf.venue?.timezone ?? workspaceTz ?? viewerTz}
      workspaceTz={workspaceTz ?? viewerTz}
      going={goingPeople}
      {locale}
    />

    <!-- The notes are a live doc only an editor opens (`lib/do/auth.ts`,
         `edit:performance`): whoever cannot write them cannot read them
         either, so they are not drawn (a guest of a bolo: their board is
         the place to talk). -->
    {#if canEdit}
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

    <!-- Lo de consulta, plegado (ADR-139 p2): la sala por dentro,
         las fechas y los materiales. Quién programa es un hecho de la
         cabecera («Con…», ADR-164 § 3). -->
    <Fold word={t('record.details', locale)} keeps={detailsKeeps} bind:open={detailsOpen} id="details" testid="record-details">
      {#if canEdit && showHoldNotice}
        <!-- ADR-080 §2 — discreet, hold-only, saved when it changes. Empty =
             default 30 (the placeholder says it), 0 = no notice. -->
        <Field
          id="f-hold-notice"
          label={t('perf.hold_notice', locale)}
          helper={fHoldNotice === 0 ? t('perf.hold_notice_none', locale) : undefined}
          error={holdNoticeBad ? t('perf.hold_notice_invalid', locale) : undefined}
        >
          <input
            id="f-hold-notice"
            type="number"
            min="0"
            max="365"
            step="1"
            inputmode="numeric"
            bind:value={fHoldNotice}
            onchange={onHoldNoticeChange}
            placeholder={String(HOLD_NOTICE_DEFAULT)}
          />
          {#snippet suffix()}{t('perf.hold_notice_suffix', locale)}{/snippet}
        </Field>
      {/if}
      <ProductionStub
        venue={perf.venue}
        venueName={perf.venue_name}
        city={perf.city}
        country={perf.country}
        logistics={perf.logistics}
        hospitality={perf.hospitality}
        technical={perf.technical}
        {viewerTz}
        fallbackTz={workspaceTz}
        withSchedule={false}
        {locale}
        saveJson={canEdit ? saveJson : undefined}
      />

      {#if perf.date.length > 0}
        <section class="perf__section" aria-label={t('perf.related_dates', locale)}>
          <BlockHead title={t('perf.dates', locale)} level={3} />
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

      {#if perf.asset_version.length > 0}
        <section class="perf__section" aria-label={t('perf.assets', locale)}>
          <BlockHead title={t('perf.assets', locale)} level={3} />
          <ul class="perf__assets" role="list">
            {#each perf.asset_version as a (a.id)}
              <li>
                <span class="perf__asset-dir">{enumWord('perf.asset_dir_', a.direction)}</span>
                <span class="perf__asset-kind">{enumWord('perf.asset_kind_', a.kind)}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </Fold>

    {#if canEdit}
      <!-- Al pie (ADR-213): copiar de otra función (ADR-169) y borrar la que
           se creó por error (ADR-052). -->
      <footer class="perf__foot" data-testid="perf-foot">
        {#if perf.project}
          <button type="button" class="perf__foot-act" onclick={() => (copyOpen = true)}>{t('perf_copy.open', locale)}</button>
          <PerformanceCopyDialog
            bind:open={copyOpen}
            perf={{ ...perf, project_id: perf.project.id }}
            {workspaceSlug}
            tz={perf.venue?.timezone ?? workspaceTz ?? viewerTz}
            fallbackTz={workspaceTz ?? viewerTz}
            {locale}
            oncopied={() => {
              void queryClient.invalidateQueries({ queryKey: ['performance'] });
              void queryClient.invalidateQueries({ queryKey: ['schedule'] });
            }}
          />
        {/if}
        <button type="button" class="perf__foot-act perf__foot-act--warn" onclick={() => (confirmDeleteOpen = true)}
          >{t('perf.delete', locale)}</button
        >
      </footer>
    {/if}
  {/if}
</article>

{#snippet boloMessage()}
  {t('perf.bolo_helper_short', locale)}
  {#if perf?.project && lensOn('books')}
    <!-- Otra pestaña: la edición a medio escribir no se pierde (Marco, 2026-10-10). -->
    <a href={booksHref(perf.project.id, { newBolo: true, here: booksHere })} target="_blank" rel="noopener"
      >{t('perf.bolo_create_link', locale)}</a
    >
  {/if}
{/snippet}

<!-- «Cambiar de sala…» (ADR-213): only what does not fit a row, the linked
     venue and the directory. The date, the room's name and the city change
     in place on the piece. -->
<Dialog bind:open={dialogOpen} title={t('pass.change_venue_title', locale)} size="m">
  <div class="perf__venue-link">
    <Select id="f-venue-entity" label={t('perf.linked_venue', locale)} bind:value={fVenueId}>
      <option value="">{t('perf.linked_venue_none', locale)}</option>
      {#each venues as vn (vn.id)}
        <option value={vn.id}>{vn.name}{vn.city ? ` — ${vn.city}` : ''}</option>
      {/each}
    </Select>
    <!-- An intent, not an act (ADR-139 p7): the venue is created and linked
         by «Save», with everything else, and «Cancel» leaves nothing behind. -->
    {#if !fVenueId}
      <Checkbox label={t('perf.save_as_venue', locale)} bind:checked={fSaveAsVenue} disabled={!fVenue.trim()} />
    {/if}
    <Button variant="secondary" size="s" disabled={!fVenueId} onclick={openVenueEdit}>
      {t('perf.edit_venue', locale)}
    </Button>
  </div>
  <p class="perf__dialog-hint">{t('perf.linked_venue_hint', locale)}</p>
  {#if perf?.workspace_id}
    <!-- Directorio global de salas: adopt a venue instead of typing it. -->
    <DirectoryPicker workspaceId={perf.workspace_id} {locale} onadopt={onDirectoryAdopt} />
    <p class="perf__dialog-hint">{t('directory.hint', locale)}</p>
  {/if}
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (dialogOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={saveVenue} loading={$patchMutation.isPending || $promoteVenue.isPending}>{t('edit.save', locale)}</Button>
  {/snippet}
</Dialog>

<!-- ADR-087 · § 36: el bolo del que cuelga, elegido desde «Falta» cuando no
     cuelga de ninguno (con uno, se cambia desde su dato en la cabecera). -->
<Dialog bind:open={boloDialogOpen} title={t('perf.bolo', locale)} size="s">
  {#if showBoloSelect}
    <Select label={t('perf.bolo', locale)} options={bolosOptions} bind:value={fBolo} message={boloMessage} />
  {:else if showBoloEmpty}
    <Select
      label={t('perf.bolo', locale)}
      options={[{ value: '', label: t('perf.bolo_empty', locale) }]}
      disabled
      message={boloMessage}
    />
  {/if}
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (boloDialogOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={saveBolo} loading={$patchMutation.isPending}>{t('edit.save', locale)}</Button>
  {/snippet}
</Dialog>

<VenueEditDialog bind:open={venueEditOpen} venue={editingVenue} workspaceId={perf?.workspace_id ?? ''} />

<Dialog bind:open={confirmCancelOpen} title={t('perf.cancel_title', locale)} size="s">
  <p>
    {t('perf.cancel_body', locale, {
      what: title,
      when: perf ? dayLabel(perf.performed_at, 'short') : '',
    })}
  </p>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (confirmCancelOpen = false)}>{t('perf.keep', locale)}</Button>
    <Button
      variant="secondary"
      tone="warn"
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
  <p class="perf__dialog-hint">{t('perf.delete_hint', locale)}</p>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (confirmDeleteOpen = false)}>{t('perf.keep', locale)}</Button>
    <Button variant="secondary" tone="warn" onclick={() => $deleteMutation.mutate()} loading={$deleteMutation.isPending}>
      {t('edit.delete', locale)}
    </Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .perf__bolo-fact {
      display: inline-flex;
      align-items: baseline;
    }


    .perf__dialog-hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }


    /* Wraps: at phone width the select was squeezed to its caret by the
       two buttons beside it. */
    .perf__venue-link {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-s) var(--space-m);
      margin-block-start: var(--space-s);
    }
    .perf__venue-link > :global(.field) {
      flex: 1 1 100%;
    }


    /* Al pie: two quiet verbs, the second one in the warning ink. */
    .perf__foot {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-s) var(--space-l);
      margin-block-start: var(--space-l);
      padding-block-start: var(--space-m);
      border-block-start: var(--line-hairline) solid var(--border-color-light);
    }
    .perf__foot-act {
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      font-size: var(--text-s);
      color: var(--text-muted);
      text-decoration: underline;
      text-decoration-thickness: var(--line-hairline);
      text-underline-offset: 3px;
      cursor: pointer;
    }
    .perf__foot-act:hover {
      color: var(--text-color);
    }
    .perf__foot-act--warn {
      color: var(--danger);
    }

    /* The place, changed in place on the piece. */
    .perf__place-fields {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-s) var(--space-m);
    }
    .perf__place-field {
      display: grid;
      flex: 1 1 10rem;
      gap: var(--space-2xs);
      font-size: var(--text-xs);
      color: var(--surface-focus-muted);
    }
    .perf__place-field--short {
      flex: 0 1 4rem;
    }
    .perf__place-field :global(input) {
      font-size: var(--text-m);
      color: var(--surface-focus-ink);
    }
    .perf__place-linked {
      font-size: var(--text-m);
    }
    .perf__place-acts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-s);
    }

    /* What hangs on a stop: a line of text and, when there is data, a verb. */
    .perf__hang-acts {
      display: flex;
      gap: var(--space-s);
    }
    .perf__hang-acts :global(.perf__hang-act) {
      display: inline-flex;
      align-items: center;
      padding: var(--space-2xs) var(--space-s);
      border: var(--line-hairline) solid var(--border-color-dark);
      border-radius: var(--radius);
      font-size: var(--text-s);
      color: var(--text-color);
      text-decoration: none;
    }
    .perf__hang-acts :global(.perf__hang-act:hover) {
      background: var(--bg-hover);
    }
    .perf__stop-show {
      font-family: var(--font-display);
      font-size: var(--text-l);
    }
    .perf__stop-link {
      color: var(--text-muted);
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
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }

    .perf__person-role,
    .perf__date-kind,
    .perf__asset-dir {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-s);
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


  }
</style>
