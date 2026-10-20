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
  import Dialog from '$lib/components/Dialog.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Textarea from '$lib/components/Textarea.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import ProductionStub from '$lib/components/ProductionStub.svelte';
  import RunningOrder from '$lib/components/RunningOrder.svelte';
  import YNotes from '$lib/components/YNotes.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { FormErrors } from '$lib/form-errors.svelte';
  import type { Json } from '$lib/db-types';
  import type { KVObject } from '$lib/kv-lines';
  import { dayLabel, dayMonth, localDayISO, timeInTz } from '$lib/datetime';
  import { LOCALE_TAG, detectLocale, t } from '$lib/i18n';
  import {
    HOLD_NOTICE_DEFAULT,
    PERFORMANCE_MENU_STATUSES,
    holdDeadlineLabel,
    isHoldStatus,
    isValidHoldNotice,
    performanceStatusFamily,
    performanceStatusLabel,
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
  import Fold from '$lib/components/Fold.svelte';
  import MissingBand, { type MissingItem } from '$lib/components/MissingBand.svelte';
  import { hasJsonContent } from '$lib/components/JsonKV.svelte';
  import { performanceMissing, type PerformanceMissing } from '$lib/record-missing';

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
    /** Pre-migration DB — hold_notice_days degraded to null; hide the field. */
    hold_notice_absent?: boolean;
  };

  interface Props {
    workspaceSlug: string;
    slug: string;
    /** Drawn in the vistazo (ADR-139 p1): no document title, and a delete closes the panel. */
    inPeek?: boolean;
  }

  let { workspaceSlug, slug, inPeek = false }: Props = $props();

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

  const locale = detectLocale(navigator.language);

  let dialogOpen = $state(false);
  let fDay = $state('');
  let fVenue = $state('');
  let fCity = $state('');
  let fCountry = $state('');
  let fVenueId = $state('');
  // «Save as venue» is kept as an intent and done by «Save» (ADR-139 p7).
  let fSaveAsVenue = $state(false);
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
    fSaveAsVenue = false;
    fHoldNotice = perf.hold_notice_days;
    fBolo = currentBoloId ?? '';
    dialogOpen = true;
  }

  // ADR-139 p7: what is wrong is said under its field, never as a toast.
  const formErrors = new FormErrors();

  async function saveEdit() {
    formErrors.clear();
    if (!fDay) formErrors.set('f-day', t('perf.needs_date', locale));
    // Same validation rule as PerformanceForm (isValidHoldNotice — THE
    // technique for this field): the input's min/max/step are hints, not
    // enforcement, and one bad digit must not 400 the whole PATCH and
    // lose every other edit in the dialog. Empty (null) stays valid —
    // "back to the standard default".
    if (showHoldNotice && !isValidHoldNotice(fHoldNotice)) {
      formErrors.set('f-hold-notice', t('perf.hold_notice_invalid', locale));
    }
    if (formErrors.any) return void formErrors.focusFirst();
    // The venue asked for with «Save as venue» is made now, then linked in
    // the same PATCH; if it cannot be made, nothing else is written either.
    let venueId = fVenueId || null;
    if (fSaveAsVenue && !venueId && fVenue.trim()) {
      try {
        venueId = (await $promoteVenue.mutateAsync()).id;
      } catch {
        return;
      }
    }
    $patchMutation.mutate({
      performed_at: fDay,
      venue_name: fVenue.trim() || null,
      city: fCity.trim() || null,
      country: fCountry.trim() || null,
      venue_id: venueId,
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
    formErrors.clear();
    if (!vName.trim()) {
      formErrors.set('v-name', t('venue.needs_name', locale));
      return void formErrors.focusFirst();
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
          fetchJSON<{ items: unknown[] }>(
            `/api/performances/${encodeURIComponent(k.slug)}/roadsheet/shares?ws=${encodeURIComponent(k.ws)}`,
            signal,
          ),
      };
    }),
  );

  const today = localDayISO();
  let missing = $derived<PerformanceMissing[]>(
    perf && bundle
      ? performanceMissing(
          {
            status: perf.status,
            day: perf.performed_at,
            hold_notice_days: perf.hold_notice_days,
            readiness: perf.readiness,
            roster: performanceRoster(bundle),
            commitments: perf.commitments,
            hasBolo: boloReadable ? currentBoloId !== null : null,
            roadsheetLinks: $sharesQuery.isSuccess ? $sharesQuery.data.items.length : null,
          },
          today,
        )
      : [],
  );

  function missingItem(m: PerformanceMissing): MissingItem {
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
      case 'ready': {
        const word = t(readinessLabelKey(m.key), locale);
        return {
          id: `ready_${m.key}`,
          text: t('record.missing_ready', locale, { item: word }),
          verbs: [
            {
              label: t('record.verb_done', locale),
              ariaLabel: t('record.verb_done_aria', locale, { item: word }),
              onclick: () => toggleReady(m.key),
              disabled: $patchMutation.isPending,
            },
          ],
        };
      }
      case 'no_bolo':
        return {
          id: 'no_bolo',
          text: t('record.missing_no_bolo', locale),
          verbs: showBoloSelect
            ? [{ label: t('record.verb_pick', locale), onclick: openEdit }]
            : perf?.project && lensOn('books')
              ? [{ label: t('perf.bolo_create_link', locale), href: booksHref(perf.project.id, { newBolo: true }) }]
              : [],
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

  // «Detalles»: lo de consulta, plegado. Cerrado, dice lo que guarda.
  let detailsOpen = $state(false);
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
  let readyCount = $derived(perf ? READINESS_KEYS.filter((k) => isReady(perf!.readiness, k)).length : 0);
  let detailsKeeps = $derived(
    perf
      ? [
          `${t('perf.readiness', locale)} ${readyCount}/${READINESS_KEYS.length}`,
          hasProduction ? t('perf.production', locale) : null,
          perf.date.length > 0 ? `${t('perf.dates', locale)} ${perf.date.length}` : null,
          perf.conversation?.person || perf.conversation?.organization ? t('perf.programmer', locale) : null,
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
    <RecordHead {crumbs} {title}>
      {#snippet actions()}
        <span class="perf__roadsheet-link"
          ><a class="link-arrow" href={`/h/${workspaceSlug}/performance/${slug}/roadsheet`}>{t('roadsheet.open', locale)}</a
          ><ConceptHint concept="roadsheet" /></span
        >
        <Button variant="secondary" size="xs" onclick={openEdit}>{t('perf.edit_details', locale)}</Button>
      {/snippet}
      <!-- Los hechos, cada uno su editor (ADR-139 p2): el estado como palabra
           mono con su menú, el cuándo y el dónde abren los datos, el bolo se
           elige en sitio. La sala no: es el título. -->
      {#snippet facts()}
        <Menu
          label={t('perf.status_menu', locale, { status: performanceStatusLabel(perf!.status, locale) })}
          triggerClass="fact-word"
          triggerAttrs={{ 'data-family': performanceStatusFamily(perf!.status), 'data-testid': 'perf-status' }}
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
        <span
          ><button type="button" class="fact-act" aria-label={t('record.edit_when', locale)} onclick={openEdit}
            >{dayLabel(perf!.performed_at, 'short')}</button
          ></span
        >
        {#if startTime}<span class="perf__time">{startTime}</span>{/if}
        {#if placeLine}
          <span
            ><button type="button" class="fact-act" aria-label={t('record.edit_where', locale)} onclick={openEdit}
              >{placeLine}</button
            ></span
          >
        {/if}
        {#if boloReadable && currentBolo && perf!.project}
          <span class="perf__bolo-fact">
            {#if showBoloSelect}
              <Menu label={t('record.bolo_menu', locale, { bolo: boloOf(currentBolo, locale) })} triggerClass="fact-act">
                {#snippet trigger()}{boloOf(currentBolo, locale)}<span class="status-caret" aria-hidden="true">▾</span>{/snippet}
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
              <a class="lenshead__frag" href={booksHref(perf!.project.id, { boloId: currentBolo.id })}>{boloOf(currentBolo, locale)}</a>
            {:else}
              {boloOf(currentBolo, locale)}
            {/if}
            <ConceptHint concept="bolo" />
          </span>
        {/if}
      {/snippet}
      {#snippet band()}
        <MissingBand items={missingItems} {locale} />
      {/snippet}
    </RecordHead>

    <!-- ADR-103: «quién va», con el reparto al lado. Sube: es lo que se
         decide (ADR-139 p2); `#who-goes` es donde cae la línea de choques
         del Día (uso #12) y el «apuntar» de «Falta». -->
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

    <!-- ADR-090 P3: the same running order as the Planner's day, in place
         of the fixed five. One way to write an hour in the whole app. -->
    <RunningOrder
      target="performance"
      id={perf.id}
      dayIso={perf.performed_at.slice(0, 10)}
      tz={perf.venue?.timezone ?? workspaceTz ?? viewerTz}
      {viewerTz}
      {locale}
    />

    <!-- ADR-106: el tablón del bolo. Sin bolo dice que no hay; sin dinero
         siempre (la puerta es la función, no Cuentas). -->
    <BoloBoard
      performanceId={perf.id}
      {workspaceSlug}
      tz={perf.venue?.timezone ?? workspaceTz ?? viewerTz}
      {locale}
    />

    <section class="perf__section" aria-label={t('perf.notes', locale)}>
      <BlockHead title={t('perf.notes', locale)} />
      <YNotes
        targetTable="performance"
        targetId={perf.id}
        placeholder={t('perf.notes_placeholder', locale)}
        {locale}
      />
    </section>

    <!-- Lo de consulta, plegado (ADR-139 p2): la lista entera de la
         preparación (lo que falta ya sube a «Falta»), la sala por dentro,
         las fechas, el programador y los materiales. -->
    <Fold word={t('record.details', locale)} keeps={detailsKeeps} bind:open={detailsOpen} id="details" testid="record-details">
      <!-- ADR-084 §3 — the answer to "is it sorted?", which the month card's
           foot reads. -->
      <section class="perf__section" aria-label={t('perf.readiness', locale)}>
        <BlockHead title={t('perf.readiness', locale)} level={3} />
        <ul class="perf__ready" role="list">
          {#each READINESS_KEYS as key (key)}
            {@const on = isReady(perf.readiness, key)}
            <li>
              <Checkbox
                label={t(readinessLabelKey(key), locale)}
                checked={on}
                disabled={$patchMutation.isPending}
                onchange={() => toggleReady(key)}
              />
            </li>
          {/each}
        </ul>
      </section>

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
        {saveJson}
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

      {#if perf.conversation?.person || perf.conversation?.organization}
        <section class="perf__section" aria-label={t('perf.programmer', locale)}>
          <BlockHead title={t('perf.programmer', locale)} level={3} />
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
          <BlockHead title={t('perf.assets', locale)} level={3} />
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
    </Fold>
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
  <div class="perf__form-grid" oninput={formErrors.onedit}>
    <Input id="f-day" label={t('perf.date', locale)} type="date" bind:value={fDay} required error={formErrors.of('f-day')} />
    <Input label={t('create.venue', locale)} bind:value={fVenue} placeholder={t('perf.venue_placeholder', locale)} />
    <Input label={t('create.city', locale)} bind:value={fCity} />
    <Input label={t('perf.country', locale)} bind:value={fCountry} placeholder="ES" />
    {#if showHoldNotice}
      <!-- ADR-080 §2 — discreet, hold-only. Empty = default 30 (the
           placeholder says it), 0 = no notice. -->
      <Field
        id="f-hold-notice"
        label={t('perf.hold_notice', locale)}
        helper={fHoldNotice === 0 ? t('perf.hold_notice_none', locale) : undefined}
        error={formErrors.of('f-hold-notice')}
      >
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
        {#snippet suffix()}{t('perf.hold_notice_suffix', locale)}{/snippet}
      </Field>
    {/if}
  </div>
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
  {#snippet lead()}
    <Button variant="quiet" tone="warn" onclick={() => (confirmDeleteOpen = true)}>
      {t('perf.delete', locale)}
    </Button>
  {/snippet}
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (dialogOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={saveEdit} loading={$patchMutation.isPending || $promoteVenue.isPending}>{t('edit.save', locale)}</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={venueEditOpen} title={t('venue.edit_title', locale)} size="m">
  <p class="perf__dialog-hint">{t('venue.edit_hint', locale)}</p>
  <div class="perf__form-grid" oninput={formErrors.onedit}>
    <Input id="v-name" label={t('venue.name', locale)} bind:value={vName} required error={formErrors.of('v-name')} />
    <Input label={t('create.city', locale)} bind:value={vCity} />
    <Input label={t('perf.country', locale)} bind:value={vCountry} placeholder="ES" />
    <Input label={t('venue.capacity', locale)} type="number" bind:value={vCapacity} />
  </div>
  <div class="perf__form-grid">
    <Input label={t('venue.address', locale)} bind:value={vAddress} placeholder={t('venue.address_placeholder', locale)} />
    <Input
      id="v-timezone"
      label={t('venue.timezone', locale)}
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
    <Button variant="secondary" size="xs" onclick={addContactRow}>{t('venue.add_contact', locale)}</Button>
  </div>
  <div class="perf__venue-notes">
    <Textarea id="v-notes" label={t('perf.notes', locale)} rows={3} bind:value={vNotes} />
  </div>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (venueEditOpen = false)}>{t('create.cancel', locale)}</Button>
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
    .perf__time {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
    }
    .perf__bolo-fact {
      display: inline-flex;
      align-items: baseline;
    }

    .perf__roadsheet-link {
      display: inline-flex;
      align-items: center;
      font-size: var(--text-s);
    }

    .perf__dialog-hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    /* The dialog's fields are rows, one under the other (ADR-139 p4). */
    .perf__form-grid {
      display: flex;
      flex-direction: column;
      margin-block-start: var(--space-s);
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

    /* The button keeps its one line; the hint is what wraps (it broke
       «Delete performance…» in two at every width). */
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
      --field-label-width: 100%;
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
