<script lang="ts">
  /**
   * Conversations lens — Phase 0.3 item 1, v1 (ADR-044). The difusión work
   * surface inside the shell: conversation list filtered by the sidebar
   * selection (ADR-038 union; empty = everything RLS allows), free-text
   * search over person name/organization, relation filter, and the ADR-040
   * inline editors via the shared ConversationTable.
   *
   * "Add conversation" (ADR-051) captures a person + conversation in one step:
   * POST /api/conversations with inline person fields — the RPC
   * find-or-creates the person on email, so re-typing a known email links
   * the existing file instead of duplicating it.
   *
   * Selection mode (envío en bloque, plan § 10): checkboxes over the filtered
   * list and a bar «Escribir a N», which creates the draft (POST /api/mailout)
   * and opens the mailout screen. A mailout belongs to one project, so the
   * bar asks for conversations of a single project.
   *
   * A row of chips in the lens header (ADR-138 § 1 y 2, fase 2; it replaces
   * the two views of ADR-134): Todas · the active tags of the scope in their
   * order (sales in its trade word, Difusión / Contratación) · Equipo, what
   * the team says among itself (ThreadFeed, `thread_feed`, ADR-116). One at a
   * time, in the URL (`?etiqueta=sales|press|…|team`; none is Todas).
   * `?view=team` and `?view=threads` redirect to `?etiqueta=team`. Without
   * Converses there is only Equipo. The tag never decides who sees what.
   *
   * The panel follows the chip (plan § 3): Difusión is the whole dashboard of
   * ADR-117 over the `sales` conversations; Todas, Prensa, Coproducción and
   * the space's own, the common one (te toca); Equipo, the threads. Todas
   * still lists conversations and threads as two blocks, one under the other
   * (mixing them in one order is phase 3). Selection and «Escribir a N» only
   * under Difusión (ADR-138 § 7).
   *
   * Difusión opens on its dashboard (ADR-117, propuesta A): the
   * ConversationOverview blocks above the list. Each block is a filter of the
   * list, carried in the URL (`?turno=`, `?temp=`, `?temporada=actual`) and
   * shown as a removable chip; «Escribir a estas» preloads the selection.
   */

  import { docTitle } from '$lib/doc-title';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { fetchJSON, mutateJSON, ApiError } from '$lib/api';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import Button from '$lib/components/Button.svelte';
  import LensHeader from '$lib/components/LensHeader.svelte';
  import LensTitle from '$lib/components/LensTitle.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import ConversationTable from '$lib/components/ConversationTable.svelte';
  import ConversationOverview from '$lib/components/ConversationOverview.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import { tick, untrack } from 'svelte';
  import { toStore } from 'svelte/store';
  import { NO_LINE, parseListFilter } from '$lib/conversation-overview';
  import ThreadFeed from '$lib/components/ThreadFeed.svelte';
  import FirstVisitCard from '$lib/components/FirstVisitCard.svelte';
  import ConceptHint from '$lib/components/ConceptHint.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import Fold from '$lib/components/Fold.svelte';
  import { localeDayMonth } from '$lib/datetime';
  import { addToast } from '$lib/components/Toast.svelte';
  import { toastCreated } from '$lib/created';
  import { conversationWhoBody, type ConversationItem } from '$lib/conversation';
  import { RELATIONS, relationLabel, type Relation } from '$lib/conversation-relation';
  import { appLocale, t } from '$lib/i18n';
  import { organizationNames, organizationsQueryOptions } from '$lib/organizations';
  import { conversationAccessQueryOptions } from '$lib/conversation-access';
  import {
    ALL,
    SALES,
    addTagKey,
    canBulkSend,
    chipHref,
    lensChip,
    lensChips,
    panelHref,
    panelOf,
    scopeTags,
    tagIdIn,
    tagLabel,
  } from '$lib/conversation-tags';
  import { conversationTagsQueryOptions } from '$lib/conversation-tags-query';
  import { usePins } from '$lib/stores/pins.svelte';
  import { useCalm } from '$lib/stores/calm.svelte';
  import { shows } from '$lib/calm';
  import CalmLine from '$lib/components/CalmLine.svelte';
  import { spaceName } from '$lib/utils/identity';
  import {
    buildLineIndex,
    buildProjectIndex,
    resolveScope,
    inScope,
    projectsInScope,
    type NavWorkspace,
    type RawLine,
    type RawProject,
  } from '$lib/nav';
  import {
    workspacesQueryOptions,
    activeProjectsQueryOptions,
    allLinesQueryOptions,
  } from '$lib/nav-queries';

  const pins = usePins();
  // Calm (ADR-139 § 5): «Te toca» and «Añadir conversación»; the rest of the
  // overview, the list and the threads fold into one line that leaves calm.
  // The Equipo view is the threads themselves and does not change.
  const calm = useCalm();
  const locale = appLocale();

  const workspacesQuery = createQuery(workspacesQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  // ADR-124: without `read` in any project the lens says so; without `edit`
  // it offers no add, select or import, and never asks for the directory (the
  // autocomplete of «Añadir», which RLS no longer gives without Converses).
  // Only an explicit «no» hides: while pending or on failure it shows.
  const accessQuery = createQuery(conversationAccessQueryOptions());
  let noAccess = $derived($accessQuery.data?.read === false);
  let canEdit = $derived($accessQuery.data?.edit !== false);
  // The directory, though, waits for an explicit yes.
  const organizationsQuery = createQuery(
    toStore(() => organizationsQueryOptions($accessQuery.data?.edit === true)),
  );

  /** The chip travels in the URL, so a link says which one it shows. Without
   *  Converses there is no conversation to show: the lens is Equipo (ADR-134 § 4). */
  let chip = $derived(lensChip(page.url.searchParams, !noAccess));
  let panel = $derived(panelOf(chip));
  // The vocabulary is names, not data; it is asked only by who reads conversations.
  const tagsQuery = createQuery(toStore(() => conversationTagsQueryOptions($accessQuery.data?.read !== false)));

  let workspaces = $derived<NavWorkspace[]>($workspacesQuery.data?.items ?? []);
  let workspaceSlugById = $derived(new Map(workspaces.map((w) => [w.id, w.slug])));
  let projectNameById = $derived(
    new Map(($projectsQuery.data?.items ?? []).map((p) => [p.id, p.name ?? p.slug])),
  );

  function personHref(item: ConversationItem): string | null {
    const workspaceSlug = workspaceSlugById.get(item.workspace_id);
    return workspaceSlug && item.person?.slug
      ? `/h/${workspaceSlug}/person/${item.person.slug}`
      : null;
  }

  /** ADR-102: the file of a conversation, also one without a person. */
  function conversationHref(item: ConversationItem): string | null {
    const workspaceSlug = workspaceSlugById.get(item.workspace_id);
    return workspaceSlug ? `/h/${workspaceSlug}/conversation/${item.id}` : null;
  }

  // ── Pins → scope (Adaptive Digest) ────────────────────────────────────
  let projectIndex = $derived(buildProjectIndex(workspaces, $projectsQuery.data?.items ?? []));
  let lineIndex = $derived(buildLineIndex(workspaces, ($linesQuery.data?.items as RawLine[]) ?? []));
  let scope = $derived(resolveScope(pins.pins, workspaces, lineIndex, projectIndex));
  // The chips speak for the spaces on screen: the pinned ones, or all (as `workspacesOnScreen`).
  let scopeWorkspaceIds = $derived(
    scope.isEmpty
      ? workspaces.map((w) => w.id)
      : [...new Set([...scope.workspaceIds, ...scope.projects.map((p) => p.workspaceId), ...scope.lines.map((l) => l.workspaceId)])],
  );
  let tagNames = $derived($tagsQuery.data ? scopeTags($tagsQuery.data, scopeWorkspaceIds) : []);
  let chips = $derived(lensChips(!noAccess, tagNames, locale));
  // Project pins scope directly; a line pin scopes conversations through its
  // project. The endpoint filters by project_ids ∪ workspace_ids.
  let filterIds = $derived({
    projectIds: scope.projectIds,
    workspaceIds: scope.workspaceIds,
  });
  // Hold the feed while project/line pins exist but their caches haven't
  // resolved them yet (avoids flashing the unscoped everything-view).
  let scopeUnresolved = $derived(
    (pins.lineIds().length > 0 && scope.lines.length !== pins.lineIds().length) ||
      (pins.projectIds().length > 0 && scope.projects.length !== pins.projectIds().length),
  );

  // Debounced search — the raw input updates instantly, the query key
  // only after the pause.
  let qRaw = $state('');
  let q = $state('');
  $effect(() => {
    const next = qRaw;
    const timer = setTimeout(() => {
      q = next.trim();
    }, 300);
    return () => clearTimeout(timer);
  });

  // The relation travels in the URL (`?relacion=`, ADR-138; it was the status,
  // `?estado=`, ADR-126 § 4): a block's link carries only its own filter, so
  // following one clears the relation and the list counts what the block
  // counts; a season segment carries both. Derived, like the blocks.
  let listFilter = $derived(parseListFilter(page.url.searchParams));
  let relationFilter = $derived<string>(listFilter.relacion ?? 'any');

  function setRelation(next: string) {
    const params = new URLSearchParams(page.url.searchParams);
    if (next === 'any') params.delete('relacion');
    else params.set('relacion', next);
    const qs = params.toString();
    void goto(`${page.url.pathname}${qs ? `?${qs}` : ''}`, { noScroll: true, keepFocus: true, replaceState: true });
  }

  // ── Dashboard filters (ADR-117): in the URL, so a block's link is the filter ──
  let lineIds = $derived(scope.lines.map((l) => l.id));
  // How many season bars the overview will likely draw while it loads (ADR-135):
  // the pinned lines, or every line the scope reaches.
  let lineHint = $derived(
    scope.lines.length > 0
      ? scope.lines.length
      : lineIndex.filter((l) => inScope(scope, { workspaceId: l.workspaceId, projectId: l.projectId })).length,
  );
  function lineLabel(linea: string): string {
    if (linea === NO_LINE) return t('overview.no_line', locale);
    return lineIndex.find((l) => l.id === linea)?.name ?? t('overview.unnamed_line', locale);
  }
  const TEMP_CHIP: Record<string, string> = {
    caliente: 'overview.hot',
    fria: 'overview.cold',
    ronda: 'overview.cold_round_chip',
    parada: 'overview.cold_stalled_chip',
    'sin-fecha': 'overview.undated_chip',
  };
  /** The chip names the block filter the list wears; a season segment, with its relation. */
  function chipLabel(f: typeof listFilter): string | null {
    if (f.temporada && (f.relacion || f.linea)) {
      return [
        f.relacion ? relationLabel(f.relacion, locale) : null,
        f.linea ? lineLabel(f.linea) : null,
        t('overview.this_season', locale).toLowerCase(),
      ]
        .filter(Boolean)
        .join(' · ');
    }
    if (f.turno === 'nuestro') return t('overview.due', locale);
    if (f.turno === 'suyo') return t('overview.turn_theirs_cap', locale);
    if (f.temp) return t(TEMP_CHIP[f.temp], locale);
    if (f.envio && f.r) return t(f.r === 'respuestas' ? 'overview.mailout_replies_chip' : 'overview.mailout_bounced_chip', locale);
    return f.temporada ? t('overview.this_season', locale) : null;
  }
  let filterChip = $derived(chipLabel(listFilter));

  function clearListFilter() {
    const params = new URLSearchParams(page.url.searchParams);
    // A season segment is relation + season: its chip names both, and goes as one.
    if (listFilter.temporada) params.delete('relacion');
    for (const k of ['turno', 'temp', 'temporada', 'linea', 'envio', 'r']) params.delete(k);
    const qs = params.toString();
    // The chip goes away with the focus on it: the focus goes to the list.
    void goto(`${page.url.pathname}${qs ? `?${qs}` : ''}`, { noScroll: true, keepFocus: true }).then(() =>
      listHeading?.focus({ preventScroll: true }),
    );
  }

  // After a filter the focus lands on the list's title, not on `body`: the
  // next Tab goes into the list, not back to the top (móvil #3).
  let listHeading = $state<HTMLElement>();
  async function showList() {
    await tick();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('lista')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    listHeading?.focus({ preventScroll: true });
  }
  // A block's link (`?turno=nuestro#lista`) is a plain link: the browser
  // scrolls, the focus follows here.
  afterNavigate(({ to }) => {
    if (to?.url.hash === '#lista') listHeading?.focus({ preventScroll: true });
  });

  /** A season segment: that relation, in the season (and the pinned lines, or its own line). */
  async function filterSeasonRelation(relation: Relation, linea?: string) {
    await goto(panelHref(chip, `temporada=actual&relacion=${relation}${linea ? `&linea=${linea}` : ''}`), { noScroll: true, keepFocus: true });
    await showList();
  }
  /** A line's name in the season: that line, every relation (ADR-135). */
  async function filterSeasonLine(linea: string) {
    await goto(panelHref(chip, `temporada=actual&linea=${linea}`), { noScroll: true, keepFocus: true });
    await showList();
  }

  /** «Escribir a estas»: the cooling list, already picked, ready for «Escribir a N». */
  async function writeTo(picks: { id: string; project_id: string }[]) {
    picking = true;
    picked = picks;
    await goto(panelHref(chip, 'temp=ronda'), { noScroll: true, keepFocus: true });
    await showList();
  }
  let relationOptions = [
    { value: 'any', label: t('conversations.all_relations', locale) },
    ...RELATIONS.map((s) => ({ value: s, label: relationLabel(s, locale) })),
  ];

  // aria-busy: until the indexes answer, the pins cannot resolve and the
  // table would fetch the wrong slice. The table says its own busy below.
  let busy = $derived($workspacesQuery.isPending || $projectsQuery.isPending || $linesQuery.isPending);

  let filters = $derived({
    projectIds: filterIds.projectIds,
    workspaceIds: filterIds.workspaceIds,
    q: q || undefined,
    ...listFilter,
    etiqueta: chip === ALL ? undefined : chip,
    lineIds,
    enabled: !scopeUnresolved,
  });

  // ── Add conversation (ADR-051) ────────────────────────────────────────
  const queryClient = useQueryClient();

  let addOpen = $state(false);
  // A contact can live in several spaces at once (person is global, deduped
  // on email; belonging to a space = an conversation in one of its projects).
  // So the target is a SET of projects, grouped by space in the picker.
  let aProjectIds = $state<string[]>([]);
  // Optional line per targeted project (ADR-056) — the target is a set of
  // projects, so one global select can't work; each checked project gets its
  // own. Unset key = "No line".
  let aLineByProject = $state<Record<string, string>>({});
  let aName = $state('');
  let aEmail = $state('');
  let aPhone = $state('');
  let aOrg = $state('');
  let aNextAt = $state('');
  let aNextNote = $state('');
  // ADR-138 fase 2: the tag it is born with; the chip's, or Difusión.
  let aTag = $state(SALES);
  let tagOptions = $derived(
    (tagNames.length > 0 ? tagNames : [{ key: SALES, label: null, labels: {} }]).map((x) => ({ value: x.key, label: tagLabel(x, locale) })),
  );
  // «Más»: phone, tag and next step, folded; the lid says the tag and the day.
  let aMoreOpen = $state(false);
  let addMoreKeeps = $derived(
    [tagOptions.find((o) => o.value === aTag)?.label, aNextAt ? localeDayMonth(aNextAt, locale) : null]
      .filter(Boolean)
      .join(' · '),
  );

  // The picker offers only the projects of the current scope (drop 11-10):
  // a space offers its projects, a project or line that project, Everything
  // all of them.
  let scopedProjects = $derived<RawProject[]>(
    projectsInScope(scope, $projectsQuery.data?.items ?? []),
  );
  // Projects grouped under the space (workspace) they belong to — the picker
  // reads as "which spaces (and which project inside them)".
  let projectGroups = $derived.by(() => {
    const wsName = new Map(workspaces.map((w) => [w.id, w.name]));
    const byWs = new Map<string, { wsId: string; wsName: string; projects: { id: string; name: string }[] }>();
    for (const p of scopedProjects) {
      let g = byWs.get(p.workspace_id);
      if (!g) {
        // Chokepoint: the only place this group's space label is built.
        g = { wsId: p.workspace_id, wsName: spaceName(wsName.get(p.workspace_id) ?? t('workspace.fallback', locale)), projects: [] };
        byWs.set(p.workspace_id, g);
      }
      g.projects.push({ id: p.id, name: p.name ?? p.slug });
    }
    return [...byWs.values()];
  });
  // Line options per project, from the same lines cache the scope resolver
  // reads (lineIndex) — only projects that actually have lines get a select.
  let linesByProject = $derived.by(() => {
    const byProject = new Map<string, { value: string; label: string }[]>();
    for (const l of lineIndex) {
      const opts = byProject.get(l.projectId);
      if (opts) opts.push({ value: l.id, label: l.name });
      else byProject.set(l.projectId, [{ value: l.id, label: l.name }]);
    }
    return byProject;
  });

  function toggleProject(id: string) {
    if (aProjectIds.includes(id)) {
      aProjectIds = aProjectIds.filter((x) => x !== id);
      return;
    }
    // The line Select binds `aLineByProject[id]`: binding `undefined` to a
    // prop with a fallback throws (svelte props_invalid_value), so a checked
    // project always has a key; '' is «No line».
    aLineByProject = { ...aLineByProject, [id]: aLineByProject[id] ?? '' };
    aProjectIds = [...aProjectIds, id];
  }

  // ADR-102: the organization completes from those of the chosen spaces (all
  // of yours while none is chosen).
  let orgSuggestions = $derived.by(() => {
    const chosen = new Set(aProjectIds);
    const wsIds = ($projectsQuery.data?.items ?? []).filter((p) => chosen.has(p.id)).map((p) => p.workspace_id);
    return organizationNames($organizationsQuery.data?.items ?? [], wsIds);
  });

  /** The 409 of a person whose organization already has a conversation in that
      project: offered as «Añadir como contacto» instead of «ya existía». */
  type Join = { conversationId: string; projectName: string };
  let aJoin = $state<Join[]>([]);
  let aJoinPersonId = $state<string | null>(null);

  function openAdd() {
    aJoin = [];
    aJoinPersonId = null;
    // Open fresh every time — leftover text from a cancelled attempt must
    // never ride into a new contact.
    aName = '';
    aEmail = '';
    aPhone = '';
    aOrg = '';
    aNextAt = '';
    aNextNote = '';
    aMoreOpen = false;
    aTag = addTagKey(chip);
    // Pre-select when the scope collapses to
    // a single project — otherwise start empty and let the user pick spaces.
    // A single pinned line also preselects that line for its project.
    aProjectIds =
      scope.lines.length === 1
        ? [scope.lines[0].projectId]
        : scopedProjects.length === 1
          ? [scopedProjects[0].id]
          : [];
    aLineByProject =
      scope.lines.length === 1
        ? { [scope.lines[0].projectId]: scope.lines[0].id }
        : Object.fromEntries(aProjectIds.map((id) => [id, '']));
    addOpen = true;
  }

  type AddResult = {
    created: number;
    existed: number;
    failed: string[];
    joinable: Join[];
    personId: string | null;
    untagged: number;
    /** What «Deshacer» deletes. */
    ids: string[];
  };

  const addMutation = createMutation({
    // One contact, N spaces → N conversations. Sequential, not parallel: the
    // first insert find-or-creates the person (by email) and returns its id;
    // every later insert links that same person_id. This keeps a no-email
    // contact from spawning a duplicate person per space, and avoids a race
    // on the citext-unique email.
    mutationFn: async (): Promise<AddResult> => {
      const targets = [...aProjectIds];
      const lineFor = { ...aLineByProject };
      // ADR-102: the person is optional; the organization alone is enough.
      const who = conversationWhoBody({ name: aName, email: aEmail, phone: aPhone, organization: aOrg }) ?? {};
      const base = {
        next_action_at: aNextAt || null,
        next_action_note: aNextNote.trim() || null,
      };
      let personId: string | null = null;
      const out: AddResult = { created: 0, existed: 0, failed: [], joinable: [], personId: null, untagged: 0, ids: [] };
      const vocab = $tagsQuery.data;
      const workspaceOf = (id: string) => ($projectsQuery.data?.items ?? []).find((p) => p.id === id)?.workspace_id;
      /** The chosen tag in that project's space; Difusión if the space does not use it. */
      const tagIdsFor = (projectId: string): string[] | undefined => {
        const ws = workspaceOf(projectId);
        const id = vocab && ws ? (tagIdIn(vocab, ws, aTag) ?? tagIdIn(vocab, ws, SALES)) : null;
        return id ? [id] : undefined;
      };
      const projectName = (id: string) =>
        ($projectsQuery.data?.items ?? []).find((p) => p.id === id)?.name ?? t('conversations.conversation', locale);

      for (const projectId of targets) {
        const line_id = lineFor[projectId] || null;
        const tag_ids = tagIdsFor(projectId);
        const body: Record<string, unknown> = personId
          ? { project_id: projectId, person_id: personId, line_id, tag_ids, ...base }
          : { project_id: projectId, ...who, line_id, tag_ids, ...base };
        try {
          const data = await mutateJSON<{
            conversation?: { id?: string };
            primary_person_id?: string | null;
            tagged?: boolean;
          }>('POST', '/api/conversations', body);
          out.created += 1;
          if (data?.conversation?.id) out.ids.push(data.conversation.id);
          if (data?.tagged === false || !tag_ids) out.untagged += 1;
          if (!personId && data?.primary_person_id) personId = data.primary_person_id;
        } catch (e) {
          const clash = e instanceof ApiError && e.status === 409 ? e.body?.conversation_id : null;
          if (typeof clash === 'string' && ('person' in who || Boolean(personId))) {
            // Its organization already talks with this project: offer the
            // person as a contact of that conversation (ADR-102).
            out.joinable.push({ conversationId: clash, projectName: projectName(projectId) });
          } else if (e instanceof ApiError && e.status === 409) {
            // Already has a conversation in this project — not an error.
            out.existed += 1;
          } else {
            out.failed.push(e instanceof Error ? e.message : t('perf.unexpected', locale));
          }
        }
      }
      // Nothing landed and something broke → surface it as an error.
      out.personId = personId;
      if (out.created === 0 && out.existed === 0 && out.joinable.length === 0 && out.failed.length > 0) {
        throw new Error(out.failed[0]);
      }
      return out;
    },
    onSuccess: (r) => {
      if (r.joinable.length > 0) {
        // The dialog stays open with the offer; what was created is already in.
        aJoin = r.joinable;
        aJoinPersonId = r.personId;
        if (r.created) void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['organizations'] });
        return;
      }
      addOpen = false;
      aName = '';
      aEmail = '';
      aPhone = '';
      aOrg = '';
      aNextAt = '';
      aNextNote = '';
      aProjectIds = [];
      aLineByProject = {};
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      const parts: string[] = [];
      if (r.created)
        parts.push(
          t(r.created === 1 ? 'conversations.added_one' : 'conversations.added_other', locale, {
            n: r.created,
          }),
        );
      if (r.existed) parts.push(t('conversations.already_in', locale, { n: r.existed }));
      if (r.failed.length) parts.push(t('conversations.failed_n', locale, { n: r.failed.length }));
      if (r.untagged) parts.push(t('conversations.tag_not_set', locale));
      const message = `${parts.join(' · ')}.`;
      if (r.failed.length || r.untagged) {
        addToast({ tone: 'warning', message });
        return;
      }
      // ADR-139 p7: an add ends with one notice, and «Deshacer» deletes it.
      const ids = r.ids;
      toastCreated({
        locale,
        message,
        undo: ids.length
          ? async () => {
              await Promise.all(ids.map((id) => mutateJSON('DELETE', `/api/conversations/${id}`)));
              await queryClient.invalidateQueries({ queryKey: ['conversations'] });
            }
          : undefined,
      });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('conversations.not_added', locale),
        message: `${err instanceof Error ? err.message : t('perf.unexpected', locale)}`,
      });
    },
  });

  const joinMutation = createMutation({
    mutationFn: async () => {
      const body = aJoinPersonId
        ? { person_id: aJoinPersonId }
        : { person: { full_name: aName.trim(), email: aEmail.trim() || null, phone: aPhone.trim() || null } };
      for (const j of aJoin) {
        await mutateJSON('POST', `/api/conversations/${j.conversationId}/contacts`, body);
      }
    },
    onSuccess: () => {
      addToast({ tone: 'success', message: t('conversations.contact_added', locale, { name: aName.trim() }) });
      addOpen = false;
      aJoin = [];
      aJoinPersonId = null;
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('conversations.not_added', locale),
        message: `${err instanceof Error ? err.message : t('perf.unexpected', locale)}`,
      });
    },
  });

  // ── Selection → mailout (plan § 10) ───────────────────────────────────
  let picking = $state(false);
  let table = $state<ReturnType<typeof ConversationTable>>();
  let picked = $state<Pick<ConversationItem, 'id' | 'project_id'>[]>([]);
  let pickedProjects = $derived([...new Set(picked.map((c) => c.project_id))]);

  function togglePicking() {
    picking = !picking;
    picked = [];
  }
  // Selection is Difusión's: leaving the chip leaves it.
  $effect(() => {
    if (!canBulkSend(chip)) untrack(() => {
      picking = false;
      picked = [];
    });
  });

  const writeMutation = createMutation({
    mutationFn: () =>
      mutateJSON<{ id: string; workspace_slug: string }>('POST', '/api/mailout', {
        project_id: pickedProjects[0],
        conversation_ids: picked.map((c) => c.id),
      }),
    onSuccess: (r) => {
      if (r) void goto(`/h/${r.workspace_slug}/mailout/${r.id}`);
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('mailout.not_created', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });

  /** What is missing, said under its field (ADR-139 p7), never as a toast. */
  let errSpaces = $state<string | undefined>();
  let errWho = $state<string | undefined>();
  $effect(() => {
    void aProjectIds.length;
    errSpaces = undefined;
  });
  $effect(() => {
    void aName;
    void aOrg;
    errWho = undefined;
  });
  let addFormEl: HTMLFormElement | undefined = $state();

  /** Runs from the form's submit: Enter in any field, ⌘↵ or the button. */
  function submitAdd() {
    if (aProjectIds.length === 0) errSpaces = t('conversations.pick_space', locale);
    if (!aName.trim() && !aOrg.trim()) errWho = t('conversations.needs_name', locale);
    if (errSpaces || errWho) {
      // «Who» comes first, so its field takes the focus first.
      if (errWho) document.getElementById('conversations-add-org')?.focus();
      return;
    }
    $addMutation.mutate();
  }
</script>

<svelte:head>
  <title>{docTitle(t('lens.conversations', locale))}</title>
</svelte:head>

<section class="conversations" class:conversations--calm={calm.on && panel !== 'team'} aria-busy={busy}>
  <LensHeader help={panel === 'team' ? 'team' : 'conversations'}>
    {#snippet title()}<LensTitle text={t('lens.conversations', locale)} />{/snippet}
    {#snippet sub()}
      <!-- The chips (ADR-138 § 2): one at a time, each a link that says where you are. -->
      {#each chips as c (c.chip)}
        <a
          class="lenshead__frag"
          href={chipHref(c.chip, page.url.searchParams)}
          aria-current={chip === c.chip ? 'page' : undefined}
          data-chip={c.chip}>{c.label}</a
        >
      {/each}
      {#if panel !== 'team' && shows('conversations', 'list', calm.on)}
        <!-- On a phone the list starts a screen and a half down: a way straight to it (móvil #11). -->
        <a class="lenshead__frag conversations__skip" href="#lista">{t('overview.go_to_list', locale)}</a>
      {/if}
    {/snippet}
  </LensHeader>

  {#if panel === 'team'}
    <FirstVisitCard section="team" />
  {:else if panel === 'sales'}
    <FirstVisitCard section="conversations" steps={['conv-due', 'conv-season', 'conv-list']} />
  {:else}
    <FirstVisitCard section="conversations" steps={['conv-due', 'conv-list']} />
  {/if}

  {#snippet threads()}
    <ThreadFeed
      filters={{ projectIds: filterIds.projectIds, workspaceIds: filterIds.workspaceIds, enabled: !scopeUnresolved }}
      {workspaceSlugById}
      {projectNameById}
      {locale}
    />
  {/snippet}

  {#if panel === 'team'}
    {@render threads()}
  {:else}
    <ConversationOverview
      filters={{ projectIds: filterIds.projectIds, workspaceIds: filterIds.workspaceIds, lineIds, enabled: !scopeUnresolved }}
      {workspaceSlugById}
      {projectNameById}
      {locale}
      {lineHint}
      {chip}
      panel={panel === 'sales' && shows('conversations', 'sales', calm.on) ? 'sales' : 'common'}
      onrelation={filterSeasonRelation}
      online={filterSeasonLine}
      onwrite={canEdit && canBulkSend(chip) ? writeTo : undefined}
    />

    {#if !shows('conversations', 'list', calm.on)}
      <div class="conversations__calm">
        <CalmLine text={t('conversations.calm_rest', locale)} action={t('calm.see_all', locale)} onclick={() => calm.set(false)} />
        {#if canEdit && shows('conversations', 'add', calm.on)}
          <Button size="s" onclick={openAdd}>{t('conversations.add', locale)}</Button>
        {/if}
      </div>
    {:else}
    <div class="conversations__list-head" id="lista" data-help-step="conv-list">
      <BlockHead title={t('overview.list', locale)} focusable bind:el={listHeading} />
    </div>
    <div class="conversations__controls">
      <div class="conversations__search">
        <Input
          toolbar
          label={t('conversations.search', locale)}
          type="search"
          placeholder={t('conversations.search_ph', locale)}
          bind:value={qRaw}
        />
      </div>
      <span class="conversations__relation">
        <Select toolbar label={t('conversations.relation', locale)} options={relationOptions} bind:value={() => relationFilter, setRelation} />
        <ConceptHint concept="relation" />
      </span>
      {#if filterChip}
        <Chip selected onRemove={clearListFilter} removeLabel={t('overview.clear_filter', locale)}>{filterChip}</Chip>
      {/if}
      {#if canEdit}
        <Button size="s" onclick={openAdd}>{t('conversations.add', locale)}</Button>
        {#if canBulkSend(chip)}
          <Button size="s" variant="secondary" onclick={togglePicking}>
            {picking ? t('mailout.pick_done', locale) : t('mailout.pick', locale)}
          </Button>
        {/if}
      {/if}
    </div>

    <ConversationTable
      bind:this={table}
      {filters}
      {personHref}
      {conversationHref}
      groupable
      turnColumn
      importEmptyState={canEdit}
      editable={canEdit}
      selectable={picking}
      bind:selected={picked}
      {tagNames}
      hideTag={chip}
    />

    {#if chip === ALL}
      <!-- Todas, phase 2: the threads as their own block under the conversations (one order is phase 3). -->
      <div class="conversations__list-head" data-testid="all-threads">
        <BlockHead title={t('conversations.view_team', locale)} />
      </div>
      {@render threads()}
    {/if}
    {/if}

    {#if picking}
      <div class="action-bar" role="region" aria-label={t('mailout.pick_bar', locale)}>
        <!-- Picking and unpicking is announced (móvil #2). -->
        <p class="action-bar__note" aria-live="polite">
          {#if pickedProjects.length > 1}
            {t('mailout.one_project', locale)}
            <!-- The way out in one click (uso #6): keep one project's picks. -->
            {#each pickedProjects as pid (pid)}
              <button type="button" class="action-bar__keep" onclick={() => (picked = picked.filter((c) => c.project_id === pid))}
                >{t('mailout.keep_project', locale, {
                  project: projectNameById.get(pid) ?? '',
                  n: picked.filter((c) => c.project_id === pid).length,
                })}</button
              >
            {/each}
          {:else}
            {t(picked.length === 1 ? 'mailout.picked_one' : 'mailout.picked_other', locale, { n: picked.length })}
          {/if}
        </p>
        <!-- On a phone the bar is where the thumb is: the page's «all» and the way out live here too. -->
        <span class="action-bar__more">
          <Button size="s" variant="secondary" onclick={() => table?.togglePage()}>{t('mailout.pick_page_short', locale)}</Button>
          <Button size="s" variant="secondary" onclick={togglePicking}>{t('mailout.pick_done', locale)}</Button>
        </span>
        <Button
          size="s"
          disabled={picked.length === 0 || pickedProjects.length !== 1}
          loading={$writeMutation.isPending}
          onclick={() => $writeMutation.mutate()}
        >
          {t('mailout.write_to', locale, { n: picked.length })}
        </Button>
      </div>
    {/if}
  {/if}
</section>

<Dialog bind:open={addOpen} title={t('conversations.add', locale)} size="m">
  <!-- A form, so Enter in any field adds (ADR-139 p7); the errors are its own. -->
  <form
    class="conversations__add"
    bind:this={addFormEl}
    onsubmit={(e) => {
      e.preventDefault();
      submitAdd();
    }}
  >
  <!-- The order is what one has in mind: who, for which production, then the
       rest folded (ADR-139 p3: deduce before asking; the scope preselects the
       project). -->
  <div class="conversations__form-grid">
    <Input
      id="conversations-add-org"
      label={t('conversations.col_organization', locale)}
      bind:value={aOrg}
      error={errWho}
      placeholder={t('conversations.org_ph', locale)}
      list="conversations-org-list"
      autocomplete="off"
    />
    <datalist id="conversations-org-list">
      {#each orgSuggestions as name (name)}<option value={name}></option>{/each}
    </datalist>
    <Input label={t('conversations.full_name', locale)} bind:value={aName} />
    <Input label={t('conversations.email', locale)} type="email" bind:value={aEmail} />
  </div>
  {#if aJoin.length > 0}
    <div class="conversations__join" role="status">
      <p>
        {t('conversations.org_has_conversation', locale, {
          org: aOrg.trim() || t('conversations.col_organization', locale),
          projects: aJoin.map((j) => j.projectName).join(', '),
        })}
      </p>
      <Button size="s" onclick={() => $joinMutation.mutate()} loading={$joinMutation.isPending}>
        {t('conversations.add_as_contact', locale)}
      </Button>
    </div>
  {/if}
  <fieldset class="conversations__spaces">
    <legend class="eyebrow eyebrow--sub">
      {t('picker.projects', locale)} <span class="conversations__field-hint">{t('conversations.spaces_hint', locale)}</span>
    </legend>
    {#if projectGroups.length === 0}
      <p class="conversations__field-hint">{t('conversations.no_projects', locale)}</p>
    {:else}
      <div class="conversations__space-groups">
        {#each projectGroups as g (g.wsId)}
          <div class="conversations__space-group">
            <!-- The space only names a group when there is more than one. -->
            {#if projectGroups.length > 1}<p class="conversations__space-name">{g.wsName}</p>{/if}
            {#each g.projects as p (p.id)}
              <Checkbox
                label={p.name}
                checked={aProjectIds.includes(p.id)}
                onchange={() => toggleProject(p.id)}
              />
              {#if aProjectIds.includes(p.id) && (linesByProject.get(p.id)?.length ?? 0) > 0}
                <div class="conversations__line">
                  <Select
                    label={t('create.line', locale)}
                    options={[{ value: '', label: t('create.line_none', locale) }, ...(linesByProject.get(p.id) ?? [])]}
                    bind:value={aLineByProject[p.id]}
                  />
                </div>
              {/if}
            {/each}
          </div>
        {/each}
      </div>
    {/if}
    {#if errSpaces}<p class="form-error" role="alert">{errSpaces}</p>{/if}
  </fieldset>
  <!-- Closed, the lid still says what it keeps: the tag, and the next step's
       day once there is one. -->
  <div class="conversations__more">
    <Fold word={t('conversations.add_more', locale)} keeps={addMoreKeeps} bind:open={aMoreOpen}>
      <div class="conversations__form-grid">
        <Input label={t('conversations.phone', locale)} type="tel" bind:value={aPhone} />
        <Select label={t('conversations.tag', locale)} options={tagOptions} bind:value={aTag} />
        <Input label={t('conversations.col_next_action', locale)} type="date" bind:value={aNextAt} />
        <Input
          label={t('conversations.next_note', locale)}
          bind:value={aNextNote}
          placeholder={t('conversations.next_note_ph', locale)}
        />
      </div>
    </Fold>
  </div>
  <!-- Hidden submit lets Enter inside an input trigger submit. -->
  <button type="submit" hidden aria-hidden="true"></button>
  </form>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (addOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={() => addFormEl?.requestSubmit()} loading={$addMutation.isPending}
      >{t('conversations.add', locale)}</Button
    >
  {/snippet}
</Dialog>

<style>
  @layer components {
    .conversations {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }
    /* Calm: one column at the reading measure, from the same left edge; the
       head keeps the page's width, so the lens switcher does not move. */
    .conversations--calm > :global(:not(.lenshead)) {
      max-inline-size: var(--calm-measure);
    }
    .conversations__calm {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-s) var(--space-m);
    }

    /* Header is now the shared LensHeader (global .lenshead* classes). */
    .conversations__controls {
      display: flex;
      gap: var(--space-m);
      align-items: end;
      flex-wrap: wrap;
    }

    /* The relation filter and its «i»: the «i» level with the control, not the label. */
    .conversations__relation {
      display: inline-flex;
      align-items: flex-end;
    }
    .conversations__relation > :global(.hint) {
      margin-block-end: calc((var(--control-size-m) - 1.4em) / 2);
    }
    /* One height for the search, the status and the two buttons (diseño M9):
       the fields take it from `toolbar`, the buttons from here. */
    .conversations__controls > :global(button) {
      block-size: var(--control-size-m);
    }

    .conversations__list-head {
      scroll-margin-block-start: var(--space-l);
      margin-block-start: var(--space-m);
    }
    .action-bar__more {
      display: flex;
      gap: var(--space-xs);
    }
    .action-bar__keep {
      margin-inline-start: var(--space-s);
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-decoration: underline;
      text-underline-offset: 0.2em;
      cursor: pointer;
    }
    @media (pointer: coarse) {
      .action-bar__keep {
        min-block-size: var(--touch-target);
      }
    }

    .conversations__search {
      flex: 1;
      min-inline-size: 16rem;
      max-inline-size: 28rem;
    }

    .conversations__join {
      display: flex;
      gap: var(--space-s);
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      margin-block-start: var(--space-m);
      padding: var(--space-s) var(--space-m);
      border: var(--border);
      border-radius: var(--radius-s);
      font-size: var(--text-s);
    }

    .conversations__add {
      display: contents;
    }

    .conversations__more {
      margin-block-start: var(--space-m);
    }

    /* Multi-space picker — projects grouped under their space. */
    .conversations__spaces {
      border: 0;
      padding: 0;
      margin-block-start: var(--space-m);
    }
    .conversations__spaces > legend {
      padding: 0;
    }
    .conversations__field-hint {
      color: var(--text-faint);
      text-transform: none;
      letter-spacing: normal;
      font-family: var(--font-sans);
    }
    .conversations__space-groups {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: var(--space-s) var(--space-m);
      margin-block-start: var(--space-s);
    }
    .conversations__space-group {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }
    /* Per-project line select — indented under its project checkbox. */
    .conversations__line {
      margin-inline-start: calc(var(--check-size) + var(--space-s));
    }

    .conversations__space-name {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-m);
      /* No uppercase: this label is only ever a space name. */
      color: var(--text-faint);
      margin-block-end: var(--space-2xs);
    }

    /* Rows, one under the other (ADR-139 p4); the groups only keep the
       order and a breath between them. */
    .conversations__form-grid {
      display: flex;
      flex-direction: column;
      margin-block-start: var(--space-s);
    }

    .conversations__skip {
      display: none;
    }
    @media (max-width: 47.999rem) {
      .conversations__skip {
        display: inline-flex;
      }
    }
    /* Touch: the two views and the skip link at the finger's size (móvil #8). */
    @media (pointer: coarse) {
      .conversations :global(.lenshead__frag) {
        display: inline-flex;
        align-items: center;
        min-block-size: var(--touch-target);
      }
    }
  }
</style>
