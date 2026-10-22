<script lang="ts">
  /**
   * App shell — Scope v2. Scope is PINS in a store, built from the left
   * rail (Everything + saved scopes + recents) and the ⌘K scope builder —
   * the manual pin UI (card chips, breadcrumb pin, ScopeStrip) died
   * 2026-07-17. Applying a scope from a non-lens surface lands on /h/desk.
   * The top bar is the ⌘K search · the sections (LensSwitcher, ADR-140,
   * against the right edge since the 20-10 amendment). The account menu and
   * the presence live at the foot of the rail; on a phone the bar is the
   * rail's door · the search · the account, and the sections go to a bar
   * at the foot. The rail's clock is the way home: the Desk
   * (ADR-137, /h redirects).
   *
   * Settings stays a "mode" of the shell: when inside /settings a slim
   * <SettingsNav> aside returns, so the settings surface is unaffected.
   *
   * Creation lives here too (ADR-056): the three dialogs (line template
   * picker, project, space) are mounted once and opened via the creation
   * context from home cards, ⌘K actions and empty states.
   *
   * Preserved from the previous shell: auth gate, lens provider, realtime
   * + network presence, theme + DND account menu, master-view restore.
   * The selection store died with the sidebar (pins are the scope model).
   */

  import { page } from '$app/state';
  import { afterNavigate, goto, replaceState } from '$app/navigation';
  import { env } from '$env/dynamic/public';
  import type { Snippet } from 'svelte';
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { toStore } from 'svelte/store';
  import SettingsNav from '$lib/components/SettingsNav.svelte';
  import PresenceBadge from '$lib/components/PresenceBadge.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import AccountMenu from '$lib/components/shell/AccountMenu.svelte';
  import ScopeBar from '$lib/components/shell/ScopeBar.svelte';
  import ScopeRail from '$lib/components/shell/ScopeRail.svelte';
  import { isReservedWorkspaceSlug } from '$lib/reserved-slugs';
  import { detectLocale, setTrade, t, tradeOf } from '$lib/i18n';
  import { provideLens, type Lens } from '$lib/stores/lens.svelte';
  import { lensesOnFor, lensOn, routedLensOf, setLensesOn } from '$lib/lenses.svelte';
  import LensOff from '$lib/components/LensOff.svelte';
  import LensSwitcher from '$lib/components/LensSwitcher.svelte';
  import PeekHost from '$lib/components/peek/PeekHost.svelte';
  import { provideCalm } from '$lib/stores/calm.svelte';
  import { providePins, parsePin, type PinKind } from '$lib/stores/pins.svelte';
  import { scopeUrlToWrite } from '$lib/scope-url';
  import { provideScopes, sameSet as scopesSameSet, type Scope } from '$lib/stores/scopes.svelte';
  import { provideCreation } from '$lib/stores/creation.svelte';
  import CreateWorkspaceDialog from '$lib/components/create/CreateWorkspaceDialog.svelte';
  import CreateProjectDialog from '$lib/components/create/CreateProjectDialog.svelte';
  import CreateLineDialog from '$lib/components/create/CreateLineDialog.svelte';
  import CreateEventDialog from '$lib/components/create/CreateEventDialog.svelte';
  import CreateTaskDialog from '$lib/components/create/CreateTaskDialog.svelte';
  import CreateConversationDialog from '$lib/components/create/CreateConversationDialog.svelte';
  import { createEventType, scopeCreatePresets, scopeTaskTarget, type PaletteCreate } from '$lib/palette-create';
  import type { CreatedPerformance } from '$lib/plan-create';
  import {
    buildLineIndex,
    buildProjectIndex,
    resolveScope,
    workspacesOnScreen,
    type NavWorkspace,
    type RawLine,
  } from '$lib/nav';
  import { activeProjectsQueryOptions, allLinesQueryOptions, teamQueryOptions } from '$lib/nav-queries';
  import { accentVarFor } from '$lib/utils/accent';
  import { spaceName } from '$lib/utils/identity';
  import { homeWorkspace, spaceWriteWorkspaces, taskWorkspaces } from '$lib/workspace-role';
  import { saveMasterViewPath } from '$lib/master-view';
  import {
    provideNetworkPresence,
    provideRealtime,
    type NetworkPresenceStore,
    type RealtimeHandle,
  } from '$lib/realtime';
  import { fetchJSON } from '$lib/api';
  import { ensureSession, getAccessToken, session } from '$lib/session.svelte';
  import { createQuery } from '@tanstack/svelte-query';

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();

  const locale = detectLocale(navigator.language);

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let hasWorkspace = $derived(workspaceSlug.length > 0);
  let blocked = $derived(hasWorkspace && isReservedWorkspaceSlug(workspaceSlug));

  $effect(() => {
    if (blocked) goto('/', { replaceState: true });
  });

  let authChecked = $state(false);
  onMount(async () => {
    // Session lives in httpOnly cookies (Phase 0.9) — only the server can
    // answer "am I signed in". ensureSession() also transparently refreshes
    // an expired access token, so a returning tab lands signed-in.
    if (!(await ensureSession())) {
      goto('/login', { replaceState: true });
      return;
    }
    authChecked = true;
  });

  const lens = provideLens('desk');
  const pins = providePins();
  const scopes = provideScopes();
  const creation = provideCreation();
  // Calm lives in the shell (the toggle sits by the clock); the Desk consumes it.
  const calm = provideCalm();
  let calmRestored = $state(false);
  let calmSeen: boolean | null = null;
  let calmAnnounce = $state('');
  $effect(() => {
    const on = calm.on;
    if (!calmRestored) return;
    if (calmSeen !== null && calmSeen !== on) calmAnnounce = t(on ? 'calm.announce_on' : 'calm.announce_off', locale);
    calmSeen = on;
  });

  onMount(() => {
    lens.restoreFromLocalStorage();
    pins.restoreFromLocalStorage();
    scopes.restoreFromLocalStorage();
    calm.restoreFromLocalStorage();
    // Keyboard `c` toggles calm globally (spec) — never while typing.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'c' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable))
        return;
      calm.toggle();
    };
    // Announce the switch only once restored: a reload is not a change.
    calmRestored = true;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  $effect(() => {
    saveMasterViewPath(page.url.pathname);
  });

  let rt = $state<RealtimeHandle | null>(null);
  let networkPresence = $state<NetworkPresenceStore | null>(null);

  type WorkspaceLite = { id: string; slug: string; name: string; accent?: string | null };
  const workspacesQuery = createQuery({
    queryKey: ['workspaces'],
    queryFn: ({ signal }) => fetchJSON<{ items: WorkspaceLite[] }>('/api/workspaces', signal),
  });

  let defaultWorkspaceSlug = $derived($workspacesQuery.data?.items[0]?.slug ?? '');
  // Settings without a space in the URL: the person's own space, never one
  // they are a guest of (a bolo invitation), where there is nothing of theirs.
  let menuWorkspaceSlug = $derived(
    workspaceSlug || homeWorkspace(($workspacesQuery.data?.items ?? []) as NavWorkspace[])?.slug || '',
  );

  // ── Scope model (pins → resolved scope) for the scope bar + sidebar ──
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());
  let wsItems = $derived(($workspacesQuery.data?.items ?? []) as unknown as NavWorkspace[]);
  let projectIndex = $derived(buildProjectIndex(wsItems, $projectsQuery.data?.items ?? []));
  let lineIndex = $derived(
    buildLineIndex(wsItems, ($linesQuery.data?.items as RawLine[]) ?? []),
  );

  // ADR-128: the screen speaks the trade of the workspaces it shows. Set
  // here, once, for every lens and dialog; `t()` reads it.
  // ADR-132: and the lenses they use. Both read the same workspaces.
  let onScreen = $derived(workspacesOnScreen(workspaceSlug, pins.pins, wsItems, lineIndex, projectIndex));
  $effect(() => {
    setTrade(tradeOf(onScreen));
    setLensesOn(lensesOnFor(onScreen));
  });

  // A person pin is the one token whose label lives outside the nav caches —
  // it is a roster row, not a container — so the team feed is fetched ONLY
  // when a person is actually pinned. Same query key the planner and the
  // blackout dialog use, so on the planner this costs no request at all: the
  // cache is already warm. Without a name a chip would print a raw uuid.
  let hasPersonPin = $derived(pins.personIds().length > 0);
  const teamStore = toStore(() =>
    teamQueryOptions(
      wsItems.map((w) => w.id),
      { enabled: hasPersonPin },
    ),
  );
  const teamQuery = createQuery(teamStore);
  let personNameById = $derived(
    new Map(($teamQuery.data?.items ?? []).map((p) => [p.person_id, p.full_name])),
  );

  function tokenLabel(tok: string): string {
    const { kind, key } = parsePin(tok);
    // The one chokepoint for a space name in the shell: the scope pill, its ×
    // aria-label and the auto-name of a saved scope all read from here.
    if (kind === 'space') return spaceName(wsItems.find((w) => w.slug === key)?.name ?? key);
    if (kind === 'project') return projectIndex.find((p) => p.id === key)?.name ?? t('picker.kind_project', locale);
    // Still loading, or a person who left the team: say the word, never the id.
    if (kind === 'person') return personNameById.get(key) ?? t('planner.board_person_one', locale);
    return lineIndex.find((l) => l.id === key)?.name ?? t('picker.kind_line', locale);
  }
  function tokenAccent(tok: string): string {
    const { kind, key } = parsePin(tok);
    if (kind === 'space') {
      const w = wsItems.find((x) => x.slug === key);
      return w ? accentVarFor(w) : 'var(--text-faint)';
    }
    if (kind === 'project')
      return projectIndex.find((p) => p.id === key)?.accent ?? 'var(--text-faint)';
    // A person has no accent of their own: hue is project identity (the glyph
    // ignores this value for `person`, and this keeps the pill honest too).
    if (kind === 'person') return 'var(--text-faint)';
    return lineIndex.find((l) => l.id === key)?.accent ?? 'var(--text-faint)';
  }
  function tokenKind(tok: string): PinKind {
    return parsePin(tok).kind;
  }
  function tokenLineKind(tok: string): string {
    const { kind, key } = parsePin(tok);
    if (kind !== 'line') return '';
    return lineIndex.find((l) => l.id === key)?.kind ?? '';
  }

  // Save ⇄ Update ⇄ Delete state. `editingBaseTokens` = the saved scope the
  // current pins derive from (set on applying a saved scope, kept while you
  // tweak it, cleared when the scope empties). exactSaved = pins land on a
  // saved scope verbatim → Delete. modified = there is a base but you changed
  // it → offer Update (the base) + Save new (the variant).
  let editingBaseTokens = $state<string[] | null>(null);
  $effect(() => {
    if (pins.pins.length === 0) editingBaseTokens = null;
  });
  let exactSaved = $derived(
    scopes.saved.find((s) => scopesSameSet(s.tokens, pins.pins)) ?? null,
  );
  let baseScope = $derived(
    editingBaseTokens
      ? (scopes.saved.find((s) => scopesSameSet(s.tokens, editingBaseTokens!)) ?? null)
      : null,
  );
  let isModified = $derived(!!baseScope && !exactSaved);

  function scopeAutoName(tokens: string[]): string {
    return (
      tokens.map(tokenLabel).slice(0, 2).join(' + ') +
      (tokens.length > 2 ? ` +${tokens.length - 2}` : '')
    );
  }

  // Register-on-abandon: the combo you actually worked in enters Recent
  // when you LEAVE it — applying another scope, Clear, logout, tab close.
  // Never on intermediate chip edits (each × would flood Recent with
  // half-built states and evict the good ones). remember() self-guards
  // the empty combo and verbatim saved scopes.
  function rememberWorkingScope(incoming?: string[]) {
    const current = pins.pins;
    if (current.length === 0) return;
    if (incoming && scopesSameSet(current, incoming)) return;
    scopes.remember(scopeAutoName(current), current);
  }

  /** Off a lens route, a scope change goes to the lens you were working in
   *  (or Desk, the home). On a lens route it stays put: the lens refilters
   *  in place. */
  function landOnScopedLens() {
    if (!routedLens) void goto(`/h/${lensOn(lens.current) ? lens.current : 'desk'}`);
  }

  function applyScope(s: Scope) {
    rememberWorkingScope(s.tokens);
    pins.set(s.tokens);
    // A scope click must SHOW the scoped view: from a lens, the lens just
    // refilters in place; from anywhere else it lands on a lens.
    landOnScopedLens();
    // If it's a saved scope, it becomes the base being edited; else no base.
    editingBaseTokens = scopes.saved.some((x) => scopesSameSet(x.tokens, s.tokens))
      ? [...s.tokens]
      : null;
    if (s.tokens.length) scopes.remember(s.name, s.tokens);
  }

  function saveCurrentScope() {
    if (pins.pins.length === 0) return;
    scopes.save(scopeAutoName(pins.pins), pins.pins);
    editingBaseTokens = [...pins.pins];
  }
  function updateScope() {
    if (!editingBaseTokens || pins.pins.length === 0) return;
    scopes.update(editingBaseTokens, pins.pins);
    editingBaseTokens = [...pins.pins];
  }

  // THE SECTIONS LIVE IN THE FRAME (ADR-140, amending 2026-07-18, when they
  // went beside each lens's title): the LensSwitcher is mounted once, in the
  // top bar, the same on every page of /h, so it cannot move under the
  // cursor and is never gone. Off a lens it marks the lens you came from.

  // Realtime is cross-origin (wss to supabase.co) and can't ride the
  // httpOnly cookie — it authenticates via async suppliers backed by
  // /api/auth/token (fresh token per (re)auth) and the session store
  // (presence key). Construction stays synchronous: setContext only works
  // in the sync part of onMount.
  onMount(() => {
    if (!env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_ANON_KEY) return;
    try {
      rt = provideRealtime(
        {
          PUBLIC_SUPABASE_URL: env.PUBLIC_SUPABASE_URL,
          PUBLIC_SUPABASE_ANON_KEY: env.PUBLIC_SUPABASE_ANON_KEY,
        },
        {
          getToken: getAccessToken,
          getUserId: () => session.user?.sub ?? null,
        },
      );
      networkPresence = provideNetworkPresence();
    } catch (e) {
      console.warn('[realtime] init failed, continuing without presence:', e);
    }
  });

  $effect(() => {
    const slugs = $workspacesQuery.data?.items.map((h) => h.slug) ?? [];
    if (networkPresence && slugs.length > 0) {
      networkPresence.setWorkspaces(slugs);
    }
  });

  onDestroy(() => {
    networkPresence?.dispose();
    rt?.dispose();
  });

  let inSettings = $derived(/^\/h\/[^/]+\/settings(\b|\/|$)/.test(page.url.pathname));

  // Which routed lens (if any) the current URL is showing. ADR-067: lens
  // routes are space-less — the space segment appears only on entity URLs.
  let routedLens = $derived<Lens | null>(routedLensOf(page.url.pathname));
  // Surfaces that carry the scope in the URL: the four lenses, the Desk
  // (the home, ADR-137) among them.
  let scopeSurface = $derived(routedLens !== null);

  // The lens store holds the lens you are working in. A lens route sets it;
  // an entity page reached from a lens (a person or a conversation opened
  // from Conversations) KEEPS it, so a scope change there lands back on that
  // lens instead of on Desk (drop 11-10).
  $effect(() => {
    const current = untrack(() => lens.current);
    if (routedLens && current !== routedLens) lens.set(routedLens);
  });

  // ── Alias resolution, inbound only (ADR-067) ─────────────────────────
  // /h/<segment>/… may arrive with a workspace ALIAS; canonical is the slug
  // (machine short-id). If the segment matches no slug but matches an alias,
  // swap it and replace the URL — links keep working, address bar shows
  // canonical, and everything downstream (?ws= API filters) sees slugs only.
  $effect(() => {
    if (!hasWorkspace || wsItems.length === 0) return;
    const seg = workspaceSlug;
    if (wsItems.some((w) => w.slug === seg)) return;
    const byAlias = wsItems.find((w) => w.alias === seg);
    if (byAlias) {
      const target =
        page.url.pathname.replace(`/h/${seg}`, `/h/${byAlias.slug}`) + page.url.search;
      void goto(target, { replaceState: true });
    }
  });

  // ── Scope ⇄ URL query (ADR-067 + addendum) ───────────────────────────
  // On scope surfaces the URL carries ?scope= live: pins → query via
  // replaceState (no history spam), and an explicit ?scope= in the URL
  // (pasted link, back/forward) → pins. A URL with NO scope param leaves
  // pins alone — personal continuity (localStorage) wins over absence.
  //
  // The URL speaks QUALIFIED SLUGS (`p:muk-cia/mamemi`,
  // `l:muk-cia/mamemi/gira-26-27`) while the pins store keeps uuid
  // identity — so renames never rot localStorage, and the address bar
  // stays human-readable. This boundary translates both ways off the nav
  // caches. Legacy uuid tokens (old copied links) parse forever; a
  // qualified token that no longer resolves once the caches settle
  // (renamed/revoked target in a stale shared link) is dropped.
  function serializePins(p: string[]): string {
    return p.join(',');
  }
  let navCachesSettled = $derived(
    $workspacesQuery.isSuccess && $projectsQuery.isSuccess && $linesQuery.isSuccess,
  );
  /**
   * A person keeps the UUID form in the address, deliberately. The qualified
   * slug trick exists so renames cannot rot a link, and it needs a cache to
   * translate through — but the person cache is only fetched once somebody is
   * pinned, so on the way IN there would be nothing to resolve against.
   * A person's identity is portable across workspaces anyway, while the slug
   * belongs to one workspace's dossier: there is no single qualified path to
   * write. The token stays opaque and stable.
   */
  function pinToUrlToken(pin: string): string {
    const { kind, key } = parsePin(pin);
    if (kind === 'space' || kind === 'person') return pin;
    if (kind === 'project') {
      const p = projectIndex.find((x) => x.id === key);
      return p ? `p:${p.workspaceSlug}/${p.slug}` : pin;
    }
    const l = lineIndex.find((x) => x.id === key);
    return l ? `l:${l.workspaceSlug}/${l.projectSlug}/${l.slug}` : pin;
  }
  /**
   * The token grammar of the address bar. It is a GROUP, not a character
   * class: `[spl]` matched the `p` of `pe:` and then demanded a colon, so a
   * person token failed the test — and failing this test is not inert. The
   * inbound effect rewrites the pins from whatever survives the filter, so a
   * dropped token does not merely fail to apply: it DELETES the pin that
   * wrote it, one navigation after you set it.
   */
  const URL_TOKEN = /^(?:pe|[spl]):.+/;
  function urlTokenToPin(tok: string): string | null {
    const { kind, key } = parsePin(tok);
    if (kind === 'space' || kind === 'person' || !key.includes('/')) return tok; // uuid form
    if (kind === 'project') {
      const [ws, slug] = key.split('/');
      const p = projectIndex.find((x) => x.workspaceSlug === ws && x.slug === slug);
      return p ? `p:${p.id}` : null;
    }
    const [ws, pslug, lslug] = key.split('/');
    const l = lineIndex.find(
      (x) => x.workspaceSlug === ws && x.projectSlug === pslug && x.slug === lslug,
    );
    return l ? `l:${l.id}` : null;
  }
  // BOTH effects read the address from `location`, not `page.url`:
  // replaceState (shallow routing) updates the real address bar but NOT the
  // reactive page.url — comparing against page.url left `existing`
  // permanently stale after our own writes (clearing pins then found
  // ''===null and never cleaned the bar; a stale read could even resurrect
  // a cleared scope). `page.url` is still read as the navigation trigger.
  $effect(() => {
    if (!scopeSurface) return;
    void page.url; // dependency: re-run on real navigations
    const raw = new URL(location.href).searchParams.get('scope');
    if (raw === null) return;
    const toks = raw.split(',').filter((t) => URL_TOKEN.test(t));
    const mapped = toks.map(urlTokenToPin);
    // Qualified tokens can't resolve before the caches land — this effect
    // re-runs as they fill. Only once settled do unresolvable ones drop.
    if (mapped.some((t) => t === null) && !navCachesSettled) return;
    const next = mapped.filter((t): t is string => t !== null);
    if (serializePins(next) !== serializePins(untrack(() => pins.pins))) {
      pins.set(next);
    }
  });
  // The first afterNavigate fires once SvelteKit's root exists (on a client
  // load, after the first mount returns): from then on shallow routing works.
  let routerReady = $state(false);
  afterNavigate(() => {
    routerReady = true;
  });
  $effect(() => {
    if (!scopeSurface) return;
    void page.url; // dependency: lens→lens navigation must re-run this
    const url = new URL(location.href);
    const existing = url.searchParams.get('scope');
    // Hold while an inbound scope is still waiting for the caches — writing
    // now would clobber a pasted link before it ever applied.
    if (existing && !navCachesSettled) {
      const toks = existing.split(',').filter((t) => URL_TOKEN.test(t));
      if (toks.some((t) => urlTokenToPin(t) === null)) return;
    }
    const ser = pins.pins.map(pinToUrlToken).join(',');
    // Never before the router has its root: see `scopeUrlToWrite`.
    const next = scopeUrlToWrite(url.href, ser, routerReady);
    if (next) replaceState(next, {});
  });

  // ⌘K scope builder — Apply sets the pins and remembers the scope.
  let paletteOpen = $state(false);
  // What the palette's BUILDING bar starts with. Opening from the scope bar
  // (+ add / + narrow) seeds it with the current filters (you're adding to the
  // scope); opening from the command bar (⌘K, top search, browse & combine)
  // starts EMPTY — a fresh scope from zero. Reset on close so ⌘K is always
  // fresh regardless of the previous open.
  let paletteSeed = $state<string[]>([]);
  $effect(() => {
    if (!paletteOpen) paletteSeed = [];
  });
  function openPaletteFresh() {
    paletteSeed = [];
    paletteOpen = true;
  }
  function openPaletteAdd() {
    paletteSeed = [...pins.pins];
    paletteOpen = true;
  }
  function onApplyScope(tokens: string[]) {
    rememberWorkingScope(tokens);
    pins.set(tokens);
    landOnScopedLens();
    // Applied a verbatim saved scope → that's the base; otherwise keep the
    // current base (you may be modifying it) — the effect nulls it when empty.
    if (scopes.saved.some((s) => scopesSameSet(s.tokens, tokens))) {
      editingBaseTokens = [...tokens];
    }
    if (tokens.length) scopes.remember(scopeAutoName(tokens), tokens);
  }
  function onPickAction(action: 'new-line' | 'new-project' | 'new-space') {
    if (action === 'new-line') creation.openLine();
    else if (action === 'new-project') creation.openProject();
    else creation.openWorkspace();
  }

  // ── What goes into the containers (ADR-139 «después»): ⌘K opens the
  //    shell's one quick add, task and conversation dialogs; whatever the
  //    door does not say comes from the pinned scope. ──
  let createScope = $derived(resolveScope(pins.pins, wsItems, lineIndex, projectIndex));
  let createPresets = $derived(scopeCreatePresets(createScope, wsItems.map((w) => w.id)));
  let taskTarget = $derived(scopeTaskTarget(createScope, taskWorkspaces(onScreen)));
  // What the spaces take from the person (`$lib/workspace-role`): a guest of a
  // bolo makes no task, project or line in the company's space.
  let canTask = $derived(taskWorkspaces(onScreen).length > 0);
  let canProject = $derived(spaceWriteWorkspaces(wsItems).length > 0);
  let canLine = $derived(projectIndex.length > 0);
  function onCreate(c: PaletteCreate) {
    if (c.kind === 'task') creation.openTask({ title: c.title });
    else if (c.kind === 'conversation') creation.openConversation({ who: c.title });
    else creation.openEvent({ type: createEventType(c.kind), title: c.title });
  }
  /** Adding stays where you are (ADR-139 p3); the notice's «Abrir» goes to
      the new performance's page, only when asked. */
  async function openCreatedPerformance(perf: CreatedPerformance) {
    const ws = wsItems.find((w) => w.id === perf.workspace_id)?.slug ?? defaultWorkspaceSlug;
    if (perf.slug) await goto(`/h/${ws}/performance/${perf.slug}`);
  }

  // ── The rail on a phone (base.css § Drawer) ──────────────────────────
  // Below 48rem the rail cannot sit beside the page — it alone is 248px of
  // a 390px screen — so it leaves the flow and the top bar's empty left
  // cell gets the one button that brings it out. Same rail, same contents,
  // same order: the clock that goes home, calm, the pulse, the scopes. On a
  // desktop the button is not drawn and `railOpen` is never true.

  // ── The shell's clock ───────────────────────────────────────────────
  // ONE timer for the whole shell: the rail draws it with the date and feeds
  // the pulse from it; on a phone the top bar draws the same face as the
  // rail's door. Re-renders exactly on the minute (it shows HH:MM), which
  // also rolls the date over at midnight.
  let clockNow = $state(new Date());
  $effect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(() => {
        clockNow = new Date();
        next();
      }, 60_000 - (Date.now() % 60_000));
    };
    next();
    return () => clearTimeout(timer);
  });
  let clockTime = $derived(
    new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(clockNow),
  );

  let railOpen = $state(false);
  let menuButtonEl = $state<HTMLButtonElement | null>(null);
  function openRail() {
    railOpen = true;
    // Into the drawer, so the keyboard and a screen reader land where the
    // eye does: the clock, its first control.
    void tick().then(() =>
      document.getElementById('shell-rail')?.querySelector<HTMLElement>('a, button')?.focus(),
    );
  }
  function closeRail({ returnFocus = false } = {}) {
    if (!railOpen) return;
    railOpen = false;
    if (returnFocus) menuButtonEl?.focus();
  }
  // Anything that goes somewhere closes it: a scope, the clock, ⌘K.
  afterNavigate(() => closeRail());
  function applyScopeFromRail(s: Scope) {
    closeRail();
    applyScope(s);
  }
  function openPaletteFromRail() {
    closeRail();
    openPaletteFresh();
  }

  /** Clear from the scope bar = abandoning the working combo too. */
  function clearScope() {
    rememberWorkingScope();
    pins.set([]);
  }
</script>

<!-- Tab close / hard navigation away: the working combo registers before
     the page dies (remember() persists synchronously to localStorage). -->
<svelte:window
  onpagehide={() => rememberWorkingScope()}
  onkeydown={(e) => {
    if (e.key === 'Escape' && railOpen) closeRail({ returnFocus: true });
  }}
/>

{#if authChecked && !blocked}
  <div class="shell" class:shell--settings={inSettings}>
    <!-- THE FIRST STOP SKIPS THE CHROME (móvil #8, WCAG 2.4.1): twenty stops of
         search, account, rail and scope stood before the first day. Unseen
         until focused. -->
    <a class="shell__skip" href="#main">{t('shell.skip_to_main', locale)}</a>
    <header class="shell__top" data-peek-through>
      <!-- THE WORDMARK IS GONE FROM THE BAR (Marco, 2026-07-31). A product
           tells you its name on the way in — the login and the invitation
           still carry it — and after that it is the one thing on screen that
           can never change and can never be acted on. The door it was is not
           lost: the CLOCK is the way home now, which is the object at the top
           of the rail that already says «here, now». -->
      <div class="shell__left">
        <!-- Only a phone draws it (see .shell__menu): there the rail is a
             drawer, and its door is the rail's own clock (Marco, 2026-10-10).
             Inside the drawer the clock still goes home, as on a desktop. -->
        <button
          type="button"
          class="shell__menu"
          bind:this={menuButtonEl}
          aria-label={t(railOpen ? 'shell.menu_close' : 'shell.menu_open', locale)}
          aria-controls="shell-rail"
          aria-expanded={railOpen}
          onclick={() => (railOpen ? closeRail() : openRail())}
        >
          <time class="clock-face" datetime={clockTime}>{clockTime}</time>
          <!-- The clock is the door, and nothing said so (móvil #11): the
               caret the app already uses for «this opens» (the status menu,
               the decisions toggle), after the time so the time stays where
               the drawer draws it. -->
          <span class="shell__menu-caret" aria-hidden="true">{railOpen ? '▴' : '▾'}</span>
        </button>
      </div>

      <button
        type="button"
        class="shell__search"
        onclick={openPaletteFresh}
        aria-label={t('shell.search_aria', locale)}
      >
        <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
          <circle cx="6.2" cy="6.2" r="4.2" />
          <path d="M9.4 9.4 12 12" />
        </svg>
        <span class="shell__search-label">{t('shell.search_label', locale)}</span>
        <kbd class="kbd">⌘K</kbd>
      </button>

      <!-- The sections (ADR-140), against the right edge of the page since
           the 20-10 amendment. On a phone the same nav leaves the bar and is
           fixed at the foot of the screen. -->
      <div class="shell__lenses">
        <LensSwitcher />
      </div>

      <!-- You, in the top bar only on a phone: beside the rail you live at
           its foot (the `me` snippet below). Never both on screen. -->
      <div class="shell__right">
        <PresenceBadge count={networkPresence?.count ?? null} />

        <AccountMenu {workspaceSlug} {menuWorkspaceSlug} {inSettings} {rememberWorkingScope} />
      </div>
    </header>

    <ScopeRail
      applyScope={applyScopeFromRail}
      openPaletteFresh={openPaletteFromRail}
      open={railOpen}
      onclose={() => closeRail({ returnFocus: true })}
      {clockNow}
      {clockTime}
      {inSettings}
    >
      {#snippet me()}
        <AccountMenu
          {workspaceSlug}
          {menuWorkspaceSlug}
          {inSettings}
          {rememberWorkingScope}
          direction="up"
          align="start"
        />
        <PresenceBadge count={networkPresence?.count ?? null} variant="dots" />
      {/snippet}
    </ScopeRail>

    {#if inSettings}
      <aside class="shell__settings-nav">
        <SettingsNav />
      </aside>
    {/if}

    <main class="shell__main" id="main" tabindex="-1">
      {#if routedLens}
        <ScopeBar
          {tokenLabel}
          {tokenAccent}
          {tokenKind}
          {tokenLineKind}
          {exactSaved}
          {isModified}
          {saveCurrentScope}
          {updateScope}
          {clearScope}
          {openPaletteAdd}
        />
      {/if}

      <!-- CALM IS A COMPOSITION, NOT A GREY (ADR-139 § 5): each lens folds
           its own blocks ($lib/calm); the content keeps its contrast, and
           no control ever looks disabled. A screen reader hears the switch. -->
      <p class="visually-hidden" aria-live="polite">{calmAnnounce}</p>
      <div class="shell__content">
        {#if routedLens && routedLens !== 'desk' && !lensOn(routedLens)}
          <!-- ADR-132: a lens off in every space on screen, reached by URL. -->
          <LensOff lens={routedLens} workspaces={onScreen} />
        {:else if children}{@render children()}{/if}
        <!-- ADR-139 p1: the vistazo, over whatever is routed. Inside the
             content so it wears the same voice (calm included). -->
        <PeekHost />
      </div>
    </main>
  </div>

  <CommandPalette
    bind:open={paletteOpen}
    initialTokens={paletteSeed}
    {onApplyScope}
    {onPickAction}
    {onCreate}
    {canTask}
    {canProject}
    {canLine}
  />

  <CreateWorkspaceDialog bind:open={creation.workspaceOpen} />
  <CreateProjectDialog bind:open={creation.projectOpen} workspaceId={creation.projectWorkspaceId} />
  <CreateLineDialog
    bind:open={creation.lineOpen}
    workspaceId={creation.lineWorkspaceId}
    projectId={creation.lineProjectId}
  />
  <CreateEventDialog
    bind:open={creation.eventOpen}
    presetProjectId={creation.event.projectId ?? createPresets.projectId}
    presetLineId={creation.event.projectId && creation.event.projectId !== createPresets.projectId
      ? null
      : createPresets.lineId}
    presetDate={creation.event.date ?? null}
    presetType={creation.event.type ?? null}
    presetTitle={creation.event.title ?? null}
    presetWorkspaceId={createPresets.workspaceId}
    canUnavailable={creation.eventHost?.canUnavailable ?? true}
    onOpenPerformance={openCreatedPerformance}
  />
  <CreateTaskDialog bind:open={creation.taskOpen} target={taskTarget} title={creation.taskTitle} />
  <CreateConversationDialog
    bind:open={creation.conversationOpen}
    who={creation.conversationWho}
    tag={creation.conversationTag}
  />
{/if}

<style>
  .shell__skip {
    position: absolute;
    inset-block-start: var(--space-xs);
    inset-inline-start: var(--space-xs);
    z-index: calc(var(--z-sticky) + 10);
    padding: var(--space-2xs) var(--space-s);
    background: var(--bg);
    color: var(--text-color);
    border: var(--line-hairline) solid var(--text-color);
    border-radius: var(--radius);
    transform: translateY(-200%);
  }
  .shell__skip:focus-visible {
    transform: none;
  }
  .shell__main:focus {
    outline: none;
  }
  .shell {
    /* Real top-bar height, true by construction (min-block-size below).
       Sticky offsets and anchor scroll-margins consume this instead of
       hardcoding approximations. */
    --header-height: 3.6rem;
    /* The page's side gutter, ONE value for every band that has to land on
       the same left edge: the top bar, the scope bar, the address bar and
       the content. A phone redeclares it (below); nobody else does. */
    --shell-gutter: var(--space-l);

    /* The rail owns the full block axis (top to bottom, wordmark first);
       the top bar covers only the remaining columns. The header is a
       sibling of the aside (not nested in <main>), so grid can place both
       freely. */
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto 1fr;
    min-block-size: 100vh;
    background: var(--bg);
  }
  /* Settings mode slots its own rail between the scopes rail and main, from
     1024 up. Under it the rail and that nav left the page a narrow column
     (208px at 768): the sections become a dropdown at the top of the page
     instead (SettingsSectionSelect), and the shell keeps its two columns. */
  @media (min-width: 64rem) {
    .shell--settings {
      grid-template-columns: auto auto 1fr;
    }
  }
  @media (max-width: 63.999rem) {
    .shell__settings-nav {
      display: none;
    }
  }

  .shell__settings-nav {
    inline-size: var(--sidebar-width);
    border-inline-end: var(--line-hairline) solid var(--border-color-dark);
    position: sticky;
    inset-block-start: var(--header-height);
    block-size: calc(100vh - var(--header-height));
    align-self: start;
    overflow-y: auto;
    padding-block: var(--space-s);
  }

  .shell__main {
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
  }

  .shell__top {
    /* Everything right of the rail — also under settings mode, where the
       settings nav takes the middle column. */
    grid-column: 2 / -1;
    position: sticky;
    inset-block-start: 0;
    z-index: var(--z-sticky);
    min-block-size: var(--header-height);
    display: grid;
    /* Search · sections (ADR-140, enmienda del 20-10). The search opens the
       bar on the page's left edge and gives way first; the sections keep
       their whole width against the right edge, so their box is the same on
       every page. You live at the foot of the rail. */
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'search lenses';
    align-items: center;
    gap: var(--space-m);
    padding-block: var(--space-s);
    padding-inline: var(--shell-gutter);
    border-block-end: var(--line-hairline) solid var(--border-color-light);
  }
  /* Beside the rail the bar's height is --header-height alone, the controls
     centred in it: the sections with 44px targets (a coarse pointer) still
     fit inside it, so every sticky offset that reads it stays true. */
  @media (min-width: 48rem) {
    .shell__top {
      padding-block: 0;
    }
  }
  /* The bar's frosted paper lives on a layer of its own: a backdrop-filter
     on the bar itself would make it the box that `position: fixed` measures
     from, and on a phone the sections inside it are fixed to the SCREEN's
     foot, not the bar's. */
  .shell__top::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    background: color-mix(in oklch, var(--bg) 88%, transparent);
    backdrop-filter: blur(8px); /* material */
  }

  /* The door and you: a phone's only (see the media query below). */
  .shell__left {
    grid-area: door;
    justify-self: start;
    display: none;
    align-items: center;
    min-inline-size: 0;
  }
  .shell__right {
    grid-area: me;
    justify-self: end;
    display: none;
    align-items: center;
    gap: var(--space-s);
    min-inline-size: 0;
  }
  .shell__lenses {
    grid-area: lenses;
    justify-self: end;
    display: flex;
    min-inline-size: 0;
  }


  .shell__search {
    grid-area: search;
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-s);
    inline-size: min(24rem, 100%);
    min-inline-size: 0;
    /* It measures itself: it says what it is while there is room, and
       keeps the lens alone at the end (container queries below). */
    container: shellsearch / inline-size;
    padding-block: var(--space-xs);
    padding-inline: var(--space-m) var(--space-s);
    border: var(--line-hairline) solid var(--border-color-dark);
    border-radius: var(--radius-circle);
    background: var(--bg-ultra-light);
    color: var(--text-faint);
    cursor: text;
    font-family: inherit;
    transition: border-color var(--transition);
  }
  .shell__search:hover {
    border-color: var(--text-muted);
  }
  .shell__search-label {
    flex: 1;
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: start;
    font-size: var(--text-s);
    color: var(--text-faint);
  }
  @container shellsearch (max-width: 14rem) {
    .shell__search .kbd {
      display: none;
    }
  }
  @container shellsearch (max-width: 7rem) {
    .shell__search-label {
      display: none;
    }
    .shell__search svg {
      margin-inline: auto;
    }
  }
  /* A tablet with the rail beside it (48–64rem): the sections take most of
     the bar, so the search keeps what is left, never less than its lens. */
  @media (min-width: 48rem) and (max-width: 63.999rem) {
    .shell__top {
      gap: var(--space-s);
    }
    .shell__search {
      min-inline-size: var(--field-size);
    }
  }

  .shell__content {
    flex: 1;
    color: var(--text-color);
    /* One shared header→content distance for every route — pages used to
       borrow the (now neutralized) global <section> padding unevenly. */
    /* At the foot, what the frame takes there too (the phone's bar of
       sections, ADR-140), so the last line is never under it. */
    padding-block: var(--space-l) calc(var(--space-xxl) + var(--shell-foot));
    padding-inline: var(--shell-gutter);
    /* One measure for every route. Lives here so no page re-declares it.
       border-box puts the padding inside the cap, so the body itself lands
       on --page-width. */
    inline-size: 100%;
    max-inline-size: calc(var(--page-width) + var(--shell-gutter) * 2);
    margin-inline: auto;
  }

  /* Print: the cap is a screen-reading concern. Documents meant for paper
     (roadsheet) take the full sheet. */
  @media print {
    .shell__content {
      max-inline-size: none;
    }
  }

  /* The rail's door on a phone: the clock, bare, as the rail draws it — no
     frame it does not have on a desktop. What says it can be pressed is the
     target, not a border: the button spans the whole bar (the negative margin
     cancels the bar's own padding) and is never narrower than 44px, and the
     face sits where the drawer's clock sits — same inset, same top — so
     opening the drawer leaves the time exactly where it was. Focus uses the
     global ring. */
  .shell__menu {
    display: none;
    align-items: flex-start;
    align-self: stretch;
    min-inline-size: 2.75rem;
    min-block-size: 2.75rem;
    margin-block: calc(-1 * var(--space-s));
    padding-block: calc((var(--header-height) - var(--text-xl)) / 2) 0;
    padding-inline: var(--space-xs);
    border: 0;
    background: none;
    cursor: pointer;
  }

  @media (max-width: 47.999rem) {
    /* One column: the rail is a drawer now (ScopeRail + base.css § Drawer),
       out of the flow, so the bar and the page take the whole width. */
    .shell {
      grid-template-columns: minmax(0, 1fr);
      --shell-gutter: var(--space-m);
    }
    /* Door · search · you. The search takes what is left instead of
       floating as a lone icon, and says what it is until it runs out of
       room. ⌘K is a keyboard's promise; a phone has none. */
    .shell__top {
      grid-column: 1 / -1;
      grid-template-columns: auto minmax(0, 1fr) auto;
      grid-template-areas: 'door search me';
      gap: var(--space-s);
    }
    /* The door's cell takes the bar's whole height, so the face can be
       placed from the top of the screen exactly as the drawer places it. */
    .shell__left {
      display: inline-flex;
      align-self: stretch;
    }
    .shell__right {
      display: inline-flex;
    }
    /* The sections are fixed to the foot of the screen (LensSwitcher): no
       cell of their own in the bar. */
    .shell__lenses {
      display: contents;
    }
    .shell__menu {
      display: flex;
    }
    .shell__menu-caret {
      align-self: center;
      margin-inline-start: var(--space-xs);
      font-size: var(--text-2xs);
      color: var(--text-faint);
    }
    .shell__search {
      justify-self: stretch;
      inline-size: auto;
      min-inline-size: 0;
    }
    .shell__search-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .shell__search .kbd {
      display: none;
    }
  }
</style>
