<script lang="ts">
  /**
   * App shell — Scope v2. Scope is PINS in a store, built from the left
   * rail (Everything + saved scopes + recents) and the ⌘K scope builder —
   * the manual pin UI (card chips, breadcrumb pin, ScopeStrip) died
   * 2026-07-17. Applying a scope from a non-lens surface lands on /h/desk.
   * The top bar is brand (logo = /h, the hall) · centered ⌘K search ·
   * account menu.
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
  import { goto, replaceState } from '$app/navigation';
  import { env } from '$env/dynamic/public';
  import type { Snippet } from 'svelte';
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import SettingsNav from '$lib/components/SettingsNav.svelte';
  import PresenceBadge from '$lib/components/PresenceBadge.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import ScopeGlyph from '$lib/components/ScopeGlyph.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { copyText } from '$lib/clipboard';
  import { useTheme } from '$lib/theme.svelte';
  import { isReservedWorkspaceSlug } from '$lib/reserved-slugs';
  import { provideLens, type Lens } from '$lib/stores/lens.svelte';
  import { provideCalm } from '$lib/stores/calm.svelte';
  import { providePins, parsePin } from '$lib/stores/pins.svelte';
  import { provideScopes, sameSet as scopesSameSet, type Scope } from '$lib/stores/scopes.svelte';
  import { detectLocale, t } from '$lib/i18n';
  import { provideBreadcrumb } from '$lib/stores/breadcrumb.svelte';
  import { provideCreation } from '$lib/stores/creation.svelte';
  import CreateWorkspaceDialog from '$lib/components/create/CreateWorkspaceDialog.svelte';
  import CreateProjectDialog from '$lib/components/create/CreateProjectDialog.svelte';
  import CreateLineDialog from '$lib/components/create/CreateLineDialog.svelte';
  import {
    buildLineIndex,
    buildProjectIndex,
    type NavWorkspace,
    type RawLine,
  } from '$lib/nav';
  import { activeProjectsQueryOptions, allLinesQueryOptions } from '$lib/nav-queries';
  import { accentVarFor } from '$lib/utils/accent';
  import { saveMasterViewPath } from '$lib/master-view';
  import {
    provideNetworkPresence,
    provideRealtime,
    type NetworkPresenceStore,
    type RealtimeHandle,
  } from '$lib/realtime';
  import { fetchJSON } from '$lib/api';
  import { clearSession, ensureSession, getAccessToken, session } from '$lib/session.svelte';
  import { createQuery } from '@tanstack/svelte-query';

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();

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
  const breadcrumb = provideBreadcrumb();
  const creation = provideCreation();
  // Calm lives in the shell (the toggle sits by the clock); the Desk consumes it.
  const calm = provideCalm();

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
  let menuWorkspaceSlug = $derived(workspaceSlug || defaultWorkspaceSlug);

  // ── Scope model (pins → resolved scope) for the scope bar + sidebar ──
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());
  let wsItems = $derived(($workspacesQuery.data?.items ?? []) as unknown as NavWorkspace[]);
  let projectIndex = $derived(buildProjectIndex(wsItems, $projectsQuery.data?.items ?? []));
  let lineIndex = $derived(
    buildLineIndex(wsItems, ($linesQuery.data?.items as RawLine[]) ?? []),
  );

  function tokenLabel(tok: string): string {
    const { kind, key } = parsePin(tok);
    if (kind === 'space') return wsItems.find((w) => w.slug === key)?.name ?? key;
    if (kind === 'project') return projectIndex.find((p) => p.id === key)?.name ?? 'project';
    return lineIndex.find((l) => l.id === key)?.name ?? 'line';
  }
  function tokenAccent(tok: string): string {
    const { kind, key } = parsePin(tok);
    if (kind === 'space') {
      const w = wsItems.find((x) => x.slug === key);
      return w ? accentVarFor(w) : 'var(--text-faint)';
    }
    if (kind === 'project')
      return projectIndex.find((p) => p.id === key)?.accent ?? 'var(--text-faint)';
    return lineIndex.find((l) => l.id === key)?.accent ?? 'var(--text-faint)';
  }
  function tokenKind(tok: string): 'space' | 'project' | 'line' {
    return parsePin(tok).kind;
  }
  function tokenLineKind(tok: string): string {
    const { kind, key } = parsePin(tok);
    if (kind !== 'line') return '';
    return lineIndex.find((l) => l.id === key)?.kind ?? '';
  }

  // Sidebar scope list: Everything + user-saved bundles only (no auto
  // per-space rows — spaces are reached from ⌘K; the sidebar is curated).
  const everything: Scope = { name: 'Everything', tokens: [] };

  // Session locale — feeds both Intl (rail clock) and the dictionary (lens
  // labels). /h is client-only (ssr = false), so navigator is safe at init.
  const locale = detectLocale(navigator.language);

  // ── Rail clock ─────────────────────────────────────────────────────
  // The shell is long-lived, so unlike the hall's mount-computed date this
  // ticks: re-render exactly on the minute (the clock shows HH:MM), which
  // also rolls the date line over at midnight.
  let clockNow = $state(new Date());
  $effect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(() => {
        clockNow = new Date();
        tick();
      }, 60_000 - (Date.now() % 60_000));
    };
    tick();
    return () => clearTimeout(timer);
  });
  let clockTime = $derived(
    new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(clockNow),
  );
  // "dilluns · 13 jul" — CSS mono-caps does the shouting; strip the
  // abbreviation dot some locales append to the short month.
  let clockDate = $derived(
    `${new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(clockNow)} · ${clockNow.getDate()} ${new Intl.DateTimeFormat(locale, { month: 'short' }).format(clockNow).replace(/\.$/, '')}`,
  );
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

  function applyScope(s: Scope) {
    rememberWorkingScope(s.tokens);
    pins.set(s.tokens);
    // A scope click must SHOW the scoped view: from a lens, the lens just
    // refilters in place; from anywhere else (hall, portada, entity pages)
    // it lands on Desk — the catch-up surface.
    if (!routedLens) void goto('/h/desk');
    // If it's a saved scope, it becomes the base being edited; else no base.
    editingBaseTokens = scopes.saved.some((x) => scopesSameSet(x.tokens, s.tokens))
      ? [...s.tokens]
      : null;
    if (s.tokens.length) scopes.remember(s.name, s.tokens);
  }

  // Inline rename of a saved scope (double-click its name).
  const scopeKey = (s: Scope) => s.tokens.join(',');
  let editingScopeKey = $state<string | null>(null);
  let editingScopeName = $state('');
  let renameInputEl = $state<HTMLInputElement | null>(null);
  function startRename(s: Scope) {
    editingScopeKey = scopeKey(s);
    editingScopeName = s.name;
    tick().then(() => renameInputEl?.select());
  }
  function commitRename(s: Scope) {
    scopes.rename(s.tokens, editingScopeName);
    editingScopeKey = null;
  }
  function cancelRename() {
    editingScopeKey = null;
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

  // VIEW AS — the Desk · Calendar · Conversations · Money segmented control
  // now lives in each lens's own header (LensSwitcher), beside its title, not
  // in the shell chrome (2026-07-18). The chrome keeps only the scope bar.

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

  const theme = useTheme();

  // Identity from the session store (display name → email local-part).
  // The JWT is httpOnly now — the server decoded it in /api/auth/session.
  let userEmail = $derived(session.user?.email ?? '');
  let userDisplayName = $derived(
    session.user?.name ?? session.user?.email?.split('@')[0] ?? '',
  );

  // Theme style picker — accordion inside the account menu.
  type ThemeStyle = { id: string; name: string };
  const themeStyles: ThemeStyle[] = [
    { id: 'editorial-sobrio', name: 'Editorial Sober' },
    { id: 'brutalist-mono', name: 'Brutalist Mono' },
    { id: 'neon-noctambulo', name: 'Neon Nightshade' },
    { id: 'serif-quiet', name: 'Serif Quiet' },
    { id: 'archival-cream', name: 'Archival Cream' },
  ];
  let activeThemeStyleId = $derived(theme.theme);
  let themeStyleExpanded = $state(false);
  let activeThemeStyle = $derived(
    themeStyles.find((t) => t.id === activeThemeStyleId) ?? themeStyles[0],
  );

  // The logo IS the home: /h, the cross-space Desk digest (ADR-065/066) —
  // not any one workspace's page. Calendar/Contacts/Money live at /h/<lens>.
  const homeHref = '/h';

  let inSettings = $derived(/^\/h\/[^/]+\/settings(\b|\/|$)/.test(page.url.pathname));

  // Which routed lens (if any) the current URL is showing. ADR-067: lens
  // routes are space-less — the space segment appears only on entity URLs.
  let routedLens = $derived.by<Lens | null>(() => {
    const m = page.url.pathname.match(/^\/h\/(desk|planner|conversations|money)\/?$/);
    return (m?.[1] as Lens | undefined) ?? null;
  });
  let atHome = $derived(/^\/h\/?$/.test(page.url.pathname));
  // Surfaces that carry the scope in the URL: the home + the four lenses.
  // The scope CHROME (scopebar + view-as) renders only on lens routes —
  // the hall lands clean, and the revealed digest brings its own
  // <ScopeStrip>.
  let scopeSurface = $derived(routedLens !== null || atHome);

  // Keep the pill state honest when navigation happens outside the pills.
  $effect(() => {
    const current = untrack(() => lens.current);
    if (routedLens) {
      if (current !== routedLens) lens.set(routedLens);
    } else if (current !== 'desk') {
      lens.set('desk');
    }
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
  function pinToUrlToken(pin: string): string {
    const { kind, key } = parsePin(pin);
    if (kind === 'space') return pin;
    if (kind === 'project') {
      const p = projectIndex.find((x) => x.id === key);
      return p ? `p:${p.workspaceSlug}/${p.slug}` : pin;
    }
    const l = lineIndex.find((x) => x.id === key);
    return l ? `l:${l.workspaceSlug}/${l.projectSlug}/${l.slug}` : pin;
  }
  function urlTokenToPin(tok: string): string | null {
    const { kind, key } = parsePin(tok);
    if (kind === 'space' || !key.includes('/')) return tok; // legacy uuid form
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
    const toks = raw.split(',').filter((t) => /^[spl]:.+/.test(t));
    const mapped = toks.map(urlTokenToPin);
    // Qualified tokens can't resolve before the caches land — this effect
    // re-runs as they fill. Only once settled do unresolvable ones drop.
    if (mapped.some((t) => t === null) && !navCachesSettled) return;
    const next = mapped.filter((t): t is string => t !== null);
    if (serializePins(next) !== serializePins(untrack(() => pins.pins))) {
      pins.set(next);
    }
  });
  $effect(() => {
    if (!scopeSurface) return;
    void page.url; // dependency: lens→lens navigation must re-run this
    const url = new URL(location.href);
    const existing = url.searchParams.get('scope');
    // Hold while an inbound scope is still waiting for the caches — writing
    // now would clobber a pasted link before it ever applied.
    if (existing && !navCachesSettled) {
      const toks = existing.split(',').filter((t) => /^[spl]:.+/.test(t));
      if (toks.some((t) => urlTokenToPin(t) === null)) return;
    }
    const ser = pins.pins.map(pinToUrlToken).join(',');
    if (ser === (existing ?? '')) return;
    if (ser) url.searchParams.set('scope', ser);
    else url.searchParams.delete('scope');
    // URLSearchParams serializes as form-urlencoded, escaping ':' ',' '/'
    // (%3A/%2C/%2F) — all legal bare in a query per RFC 3986, and the
    // parser reads either form identically. Un-escape so the address bar
    // shows the tokens as designed: ?scope=s:muk-cia,p:muk-cia/mamemi.
    const qs = url.searchParams
      .toString()
      .replace(/%3A/gi, ':')
      .replace(/%2C/gi, ',')
      .replace(/%2F/gi, '/');
    url.search = qs ? `?${qs}` : '';
    replaceState(url, {});
  });

  // Copy link — the ADR-022 level-3 gesture: the URL already carries the
  // scope, canonical id-form by construction (pins hold slugs, never aliases).
  async function copyScopeLink() {
    if (await copyText(location.href)) {
      addToast({ tone: 'success', message: 'Link copied — scope included.' });
    } else {
      addToast({ tone: 'danger', message: 'Could not copy the link.' });
    }
  }

  // Do Not Disturb — quick toggle in the account menu.
  const DND_KEY = 'hour_dnd';
  let dnd = $state(false);
  onMount(() => {
    try {
      dnd = localStorage.getItem(DND_KEY) === '1';
    } catch {
      /* storage disabled */
    }
  });
  function toggleDnd() {
    dnd = !dnd;
    try {
      localStorage.setItem(DND_KEY, dnd ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

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
    if (!routedLens) void goto('/h/desk');
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

  /** Clear from the scope bar = abandoning the working combo too. */
  function clearScope() {
    rememberWorkingScope();
    pins.set([]);
  }

  async function logout() {
    rememberWorkingScope();
    // Server-side: clears the httpOnly cookies + revokes the refresh
    // token at Supabase. Await so the gates can't race a live cookie.
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* offline logout still clears local state */
    }
    clearSession();
    goto('/login', { replaceState: true });
  }
</script>

<!-- Tab close / hard navigation away: the working combo registers before
     the page dies (remember() persists synchronously to localStorage). -->
<svelte:window onpagehide={() => rememberWorkingScope()} />

{#if authChecked && !blocked}
  <div class="shell" class:shell--settings={inSettings}>
    <header class="shell__top">
      <div class="shell__left">
        <a class="shell__brand" href={homeHref} aria-label="Hour — home">
          <BrandMark size="m" />
        </a>
      </div>

      <button
        type="button"
        class="shell__search"
        onclick={openPaletteFresh}
        aria-label="Search or jump to a project or line"
      >
        <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
          <circle cx="6.2" cy="6.2" r="4.2" />
          <path d="M9.4 9.4 12 12" />
        </svg>
        <span class="shell__search-label">Search or jump to a project or line…</span>
        <kbd class="kbd">⌘K</kbd>
      </button>

      <div class="shell__right">
        <PresenceBadge count={networkPresence?.count ?? null} />

        <Menu
          direction="down"
          align="end"
          label="Open account menu"
          triggerClass="account-row__kebab"
          onclose={() => (themeStyleExpanded = false)}
        >
          {#snippet trigger()}
            <Avatar size="xs" name={userDisplayName || userEmail || workspaceSlug} />
          {/snippet}
          {#snippet children({ close })}
            <li role="presentation" class="menu-header">
              <div class="menu-header__identity">
                <Avatar size="s" name={userDisplayName || userEmail || workspaceSlug} />
                <div class="menu-header__id">
                  <span class="menu-header__name">{userDisplayName || userEmail}</span>
                  {#if userDisplayName && userEmail && userDisplayName !== userEmail}
                    <span class="menu-header__email">{userEmail}</span>
                  {/if}
                </div>
              </div>
              <button
                type="button"
                class="menu-header__logout"
                aria-label="Sign out"
                title="Sign out"
                onclick={() => {
                  close(false);
                  logout();
                }}
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M9 2 H4 a1 1 0 0 0 -1 1 V13 a1 1 0 0 0 1 1 H9" />
                  <path d="M7 8 H14" />
                  <path d="M11 5 L14 8 L11 11" />
                </svg>
              </button>
            </li>
            <li role="none">
              <a
                role="menuitem"
                href={inSettings ? `/h/${menuWorkspaceSlug}/` : `/h/${menuWorkspaceSlug}/settings`}
                class="menu__item"
                tabindex="0"
                onclick={() => close(false)}
              >
                {inSettings ? 'Dashboard' : 'All settings'}
              </a>
            </li>
            <li role="none" class="settings-row">
              <a
                role="menuitem"
                href={`/h/${menuWorkspaceSlug}/settings?section=notifications`}
                class="menu__item settings-row__link"
                tabindex="0"
                onclick={() => close(false)}
              >
                Notifications
              </a>
              <button
                type="button"
                class="settings-row__action settings-row__action--toggle"
                class:is-muted={dnd}
                aria-label={dnd ? 'Notifications muted — click to unmute' : 'Notifications on — click to mute'}
                aria-pressed={dnd}
                title={dnd ? 'Muted' : 'On — click to mute'}
                onclick={toggleDnd}
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M4 11 C 4 9.8 4.5 9.3 4.5 8 C 4.5 5.8 6 4 8 4 C 10 4 11.5 5.8 11.5 8 C 11.5 9.3 12 9.8 12 11 Z" />
                  <path d="M3.5 11 H 12.5" />
                  <path d="M7 13 C 7.2 13.6 7.5 14 8 14 C 8.5 14 8.8 13.6 9 13" />
                  <path d="M8 2.5 V 4" />
                  {#if dnd}
                    <path d="M2.5 2.5 L 13.5 13.5" />
                  {/if}
                </svg>
              </button>
            </li>
            <li role="none" class="theme-accordion">
              <div class="theme-accordion__header">
                <button
                  type="button"
                  class="theme-accordion__expand"
                  aria-expanded={themeStyleExpanded}
                  onclick={() => (themeStyleExpanded = !themeStyleExpanded)}
                >
                  <span class="theme-accordion__label">Theme style</span>
                  <span class="theme-accordion__current">
                    <span class="theme-accordion__current-name">{activeThemeStyle.name}</span>
                    <span class="theme-accordion__chevron" data-expanded={themeStyleExpanded || undefined} aria-hidden="true">›</span>
                  </span>
                </button>
                <ThemeToggle variant="plain" />
              </div>
              {#if themeStyleExpanded}
                <ul class="theme-accordion__list" role="list">
                  {#each themeStyles as t (t.id)}
                    <li class="theme-accordion__item">
                      <button
                        type="button"
                        class="theme-accordion__select"
                        aria-pressed={t.id === activeThemeStyleId}
                        data-active={t.id === activeThemeStyleId || undefined}
                        onclick={() => theme.setTheme(t.id)}
                      >
                        {t.name}
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/snippet}
        </Menu>
      </div>
    </header>

    <aside class="shell__side" aria-label="Scopes">
      <div class="side-clock">
        <div class="side-clock__now">
          <time class="side-clock__time" datetime={clockTime}>{clockTime}</time>
          <p class="side-clock__date">{clockDate}</p>
        </div>
        <button
          type="button"
          class="side-calm"
          class:is-on={calm.on}
          aria-pressed={calm.on}
          title={t('desk.calm', locale)}
          onclick={() => calm.toggle()}
        >
          <span>{t('desk.calm', locale)}</span><span class="side-calm__k">C</span>
        </button>
      </div>
      <div class="side-sec">
        <div class="side-sec__h">Scopes</div>
        <!-- The hall greets outside any scope: no row lights up there, not
             even Everything — highlighting starts once you're on a surface
             the scope actually filters. -->
        <button
          type="button"
          class="srow srow--every"
          class:is-on={!atHome && scopesSameSet([], pins.pins)}
          onclick={() => applyScope(everything)}
        >
          <span class="sglyph sglyph--every" aria-hidden="true">∑</span>
          <span class="srow__name">Everything</span>
        </button>
        {#each scopes.saved as s (s.tokens.join(','))}
          {#if editingScopeKey === scopeKey(s)}
            <div class="srow srow--editing">
              <input
                class="srow__rename"
                bind:this={renameInputEl}
                bind:value={editingScopeName}
                onblur={() => commitRename(s)}
                onkeydown={(e) => {
                  if (e.key === 'Enter') commitRename(s);
                  else if (e.key === 'Escape') cancelRename();
                }}
              />
            </div>
          {:else}
            <button
              type="button"
              class="srow"
              class:is-on={!atHome && scopesSameSet(s.tokens, pins.pins)}
              onclick={() => applyScope(s)}
              ondblclick={() => startRename(s)}
              title="Double-click to rename"
            >
              <span class="srow__name">{s.name}</span>
            </button>
          {/if}
        {/each}
      </div>

      {#if scopes.recent.length > 0}
        <div class="side-sec">
          <div class="side-sec__h">Recent</div>
          {#each scopes.recent as r (r.name + r.tokens.join(','))}
            <button
              type="button"
              class="srow"
              class:is-on={!atHome && scopesSameSet(r.tokens, pins.pins)}
              onclick={() => applyScope(r)}
            >
              <span class="srow__name">{r.name}</span>
            </button>
          {/each}
        </div>
      {/if}

      <div class="side-foot">
        <button type="button" class="side-browse" onclick={openPaletteFresh}>
          ⌘K · browse &amp; combine
        </button>
      </div>
    </aside>

    {#if inSettings}
      <aside class="shell__settings-nav">
        <SettingsNav />
      </aside>
    {/if}

    <main class="shell__main">
      {#if routedLens}
        <div class="shell__lenschrome">
          <div class="scopebar">
            <span class="scopebar__lead">Scope</span>
            {#if pins.pins.length === 0}
              <span class="scopebar__all">Everything · all spaces &amp; projects</span>
              <button type="button" class="scopebar__add" onclick={openPaletteAdd}>
                + narrow
              </button>
              <span class="scopebar__right">
                <button type="button" class="scopebar__save" onclick={copyScopeLink}
                  >⧉ Copy link</button
                >
              </span>
            {:else}
              {#each pins.pins as tok (tok)}
                <span class="tok tok--{tokenKind(tok)}">
                  <ScopeGlyph kind={tokenKind(tok)} accent={tokenAccent(tok)} lineKind={tokenLineKind(tok)} />
                  <span class="tok__kind">{tokenKind(tok)}</span>
                  <span class="tok__name">{tokenLabel(tok)}</span>
                  <button
                    type="button"
                    class="tok__x"
                    onclick={() => pins.remove(tok)}
                    aria-label={`Remove ${tokenLabel(tok)}`}>×</button
                  >
                </span>
              {/each}
              <button type="button" class="scopebar__add" onclick={openPaletteAdd}>
                + add
              </button>
              <span class="scopebar__right">
                {#if exactSaved}
                  <button
                    type="button"
                    class="scopebar__save"
                    onclick={() => scopes.remove(pins.pins)}>× Delete scope</button
                  >
                {:else if isModified}
                  <button type="button" class="scopebar__save" onclick={updateScope}
                    >↺ Update scope</button
                  >
                  <button type="button" class="scopebar__save" onclick={saveCurrentScope}
                    >☆ Save new scope</button
                  >
                {:else}
                  <button type="button" class="scopebar__save" onclick={saveCurrentScope}
                    >☆ Save scope</button
                  >
                {/if}
                <button type="button" class="scopebar__save" onclick={copyScopeLink}
                  >⧉ Copy link</button
                >
                <button type="button" class="scopebar__clear" onclick={clearScope}
                  >Clear</button
                >
              </span>
            {/if}
          </div>
        </div>
      {/if}

      {#if breadcrumb.crumbs.length > 0}
        <div class="shell__address">
          <div class="shell__address-inner">
            <nav class="shell__crumbs" aria-label="Breadcrumb">
              {#each breadcrumb.crumbs as c, i (i)}
                {#if i > 0}<span class="shell__crumb-sep" aria-hidden="true">›</span>{/if}
                {#if c.href}
                  <a
                    class="shell__crumb"
                    class:shell__crumb--space={c.kind === 'space'}
                    href={c.href}
                    style={c.accent ? `--c: ${c.accent}` : undefined}
                  >
                    {#if c.kind === 'space'}<span class="shell__crumb-dot" aria-hidden="true"></span>{/if}{c.label}
                  </a>
                {:else}
                  <span class="shell__crumb shell__crumb--here">{c.label}</span>
                {/if}
              {/each}
            </nav>
          </div>
        </div>
      {/if}

      <div class="shell__content" class:shell__content--calm={calm.on}>
        {#if children}{@render children()}{/if}
      </div>
    </main>
  </div>

  <CommandPalette bind:open={paletteOpen} initialTokens={paletteSeed} {onApplyScope} {onPickAction} />

  <CreateWorkspaceDialog bind:open={creation.workspaceOpen} />
  <CreateProjectDialog bind:open={creation.projectOpen} workspaceId={creation.projectWorkspaceId} />
  <CreateLineDialog
    bind:open={creation.lineOpen}
    workspaceId={creation.lineWorkspaceId}
    projectId={creation.lineProjectId}
  />
{/if}

<style>
  .shell {
    /* Real top-bar height, true by construction (min-block-size below).
       Sticky offsets and anchor scroll-margins consume this instead of
       hardcoding approximations. */
    --header-height: 3.6rem;

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
  /* Settings mode slots its own rail between the scopes rail and main. */
  .shell--settings {
    grid-template-columns: auto auto 1fr;
  }

  /* ── scopes sidebar (Scope v2) — saved scopes + recents, NOT the tree.
     The space→project→line hierarchy is browsed from ⌘K; this rail holds
     one-click named scopes (Everything, each space, saved bundles) + the
     recents. Replaces the ADR-057 space rail. */
  .shell__side {
    grid-column: 1;
    grid-row: 1 / -1;
    position: sticky;
    inset-block-start: 0;
    align-self: start;
    z-index: var(--z-sticky);
    inline-size: 15.5rem;
    min-block-size: 100vh;
    display: flex;
    flex-direction: column;
    gap: var(--space-l);
    /* No top padding: the clock block owns the top offset so it can match
       the header's wordmark exactly (see .side-clock). */
    padding-block: 0 var(--space-l);
    padding-inline: var(--space-m);
    border-inline-end: 1px solid var(--border-color-light);
    background: var(--bg-light);
  }
  .side-clock {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-s);
    padding-inline: var(--space-xs);
    /* Same top offset as the header's wordmark, by construction: the
       BrandMark (size m = --text-xl, line-height 1) centers inside the
       --header-height band, so its top sits at (band − type)/2. */
    padding-block-start: calc((var(--header-height) - var(--text-xl)) / 2);
  }
  .side-clock__now {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }
  /* Calm toggle — the mode control lives by the clock (spec § Desk · Calm).
     outline = available / solid = active, so it reads as a control. */
  .side-calm {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    padding-block: var(--space-2xs);
    padding-inline: var(--space-m);
    border: 1px solid var(--border-color-dark);
    border-radius: var(--radius-circle);
    background: var(--bg-ultra-light);
    /* Desk lens button shape (sans, --space-2xs/--space-m, radius-circle, ultra-light
       fill) but a smaller uppercase micro-label. Mono C key hint. */
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    cursor: pointer;
    white-space: nowrap;
    transition:
      color var(--transition),
      background var(--transition),
      border-color var(--transition);
  }
  .side-calm:hover {
    color: var(--text-color);
    border-color: var(--text-muted);
  }
  .side-calm.is-on {
    background: var(--text-color);
    border-color: var(--text-color);
    color: var(--bg);
  }
  .side-calm__k {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: 1.35em;
    block-size: 1.35em;
    border: 1px solid currentColor;
    border-radius: var(--radius-s);
    /* The key stays mono even though the label is now sans. */
    font-family: var(--font-mono);
    font-size: 0.85em;
    opacity: 0.6;
    text-transform: none;
  }
  .side-clock__time {
    font-family: var(--font-mono);
    font-size: var(--text-xl);
    font-weight: 400;
    line-height: 1;
    letter-spacing: 0.02em;
    color: var(--heading-color);
  }
  .side-clock__date {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .side-sec {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .side-sec__h {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--text-faint);
    padding-inline: var(--space-xs);
    margin-block-end: var(--space-xs);
  }
  .srow {
    display: flex;
    align-items: center;
    gap: var(--space-s);
    inline-size: 100%;
    text-align: start;
    background: transparent;
    border: 0;
    cursor: pointer;
    padding: var(--space-xs);
    border-radius: var(--radius-m);
    font-family: var(--font-sans);
    font-size: var(--text-s);
    color: var(--text-muted);
    transition: background var(--transition), color var(--transition);
  }
  .srow:hover {
    background: color-mix(in oklch, var(--text-color) 5%, transparent);
  }
  .srow.is-on {
    background: var(--bg-ultra-light);
    color: var(--text-color);
    box-shadow: 0 0 0 1px var(--border-color-dark);
  }
  .sglyph {
    inline-size: 1.4rem;
    block-size: 1.4rem;
    flex: none;
    border-radius: var(--radius-s);
    display: grid;
    place-items: center;
    font-family: var(--font-display);
    font-size: var(--text-xs);
    color: #fff;
  }
  .sglyph--every {
    background: var(--text-color);
    color: var(--bg);
    font-family: var(--font-mono);
  }
  .srow__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* inline rename (double-click a saved scope) */
  .srow--editing {
    padding: 0;
  }
  .srow__rename {
    inline-size: 100%;
    padding-block: var(--space-xs);
    padding-inline: var(--space-xs);
    border: 1px solid var(--primary);
    border-radius: var(--radius-m);
    background: var(--bg-ultra-light);
    font-family: var(--font-sans);
    font-size: var(--text-s);
    color: var(--text-color);
    outline: none;
  }
  .side-foot {
    margin-block-start: auto;
  }
  .side-browse {
    inline-size: 100%;
    background: transparent;
    border: 1px dashed var(--border-color-dark);
    cursor: pointer;
    padding: var(--space-s);
    border-radius: var(--radius-m);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing);
    color: var(--text-faint);
    transition: color var(--transition), border-color var(--transition);
  }
  .side-browse:hover {
    color: var(--text-color);
    border-color: var(--text-muted);
  }

  /* ── lens chrome: scope bar + VIEW AS (Scope v2) ── */
  .shell__lenschrome {
    display: flex;
    flex-direction: column;
    gap: var(--space-m);
    padding-block: var(--space-m) 0;
    padding-inline: var(--space-l);
    /* Sibling of .shell__content, so it needs the same cap to stay aligned
       with the body underneath it. */
    inline-size: 100%;
    max-inline-size: calc(var(--page-width) + var(--space-l) * 2);
    margin-inline: auto;
  }
  .scopebar {
    display: flex;
    align-items: center;
    gap: var(--space-s);
    flex-wrap: wrap;
    padding-block: var(--space-s);
    padding-inline: var(--space-m);
    background: var(--bg-ultra-light);
    border: 1px solid var(--border-color-dark);
    border-radius: var(--radius-l);
    min-block-size: 3rem;
  }
  .scopebar__lead {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .scopebar__all {
    font-family: var(--font-display);
    font-style: italic;
    font-size: var(--text-s);
    color: var(--text-muted);
  }
  .tok {
    --glyph: 11px; /* compact glyph inside the scope-bar pills */
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    border-radius: var(--radius-circle);
    padding-block: var(--space-2xs);
    padding-inline: var(--space-xs) var(--space-xs);
    font-size: var(--text-s);
    line-height: 1;
    border: 1px solid var(--border-color-dark);
    background: var(--bg-light);
  }
  .tok__kind {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1;
    letter-spacing: var(--mono-letter-spacing);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .tok__name {
    line-height: 1;
  }
  .tok__x {
    display: grid;
    place-items: center;
    inline-size: 1rem;
    block-size: 1rem;
    border: 0;
    border-radius: var(--radius-circle);
    background: transparent;
    color: var(--text-faint);
    cursor: pointer;
    font-size: var(--text-m);
    line-height: 1;
  }
  .tok__x:hover {
    background: color-mix(in oklch, var(--text-color) 10%, transparent);
    color: var(--text-color);
  }
  .scopebar__add {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-faint);
    border: 1px dashed var(--border-color-dark);
    border-radius: var(--radius-circle);
    padding-block: var(--space-2xs);
    padding-inline: var(--space-s);
    cursor: pointer;
    background: transparent;
  }
  .scopebar__add:hover {
    color: var(--text-color);
    border-color: var(--text-muted);
  }
  .scopebar__right {
    margin-inline-start: auto;
    display: inline-flex;
    align-items: center;
    gap: var(--space-m);
  }
  .scopebar__save,
  .scopebar__clear {
    background: transparent;
    border: 0;
    cursor: pointer;
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
  .scopebar__save:hover,
  .scopebar__clear:hover {
    color: var(--text-color);
  }
  .scopebar__clear {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .shell__settings-nav {
    inline-size: var(--sidebar-width);
    border-inline-end: 1px solid var(--border-color-dark);
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
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: var(--space-m);
    padding-block: var(--space-s);
    padding-inline: var(--space-l);
    background: color-mix(in oklch, var(--bg) 88%, transparent);
    backdrop-filter: blur(8px);
    border-block-end: 1px solid var(--border-color-light);
  }

  .shell__left {
    grid-column: 1;
    justify-self: start;
    display: inline-flex;
    align-items: center;
    min-inline-size: 0;
  }
  .shell__right {
    grid-column: 3;
    justify-self: end;
    display: inline-flex;
    align-items: center;
    gap: var(--space-s);
    min-inline-size: 0;
  }

  .shell__brand {
    display: inline-flex;
    flex: none;
    text-decoration: none;
  }

  .shell__search {
    grid-column: 2;
    justify-self: center;
    display: inline-flex;
    align-items: center;
    gap: var(--space-s);
    inline-size: min(30rem, 100%);
    min-inline-size: 14rem;
    padding-block: var(--space-xs);
    padding-inline: var(--space-m) var(--space-s);
    border: 1px solid var(--border-color-dark);
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
    text-align: start;
    font-size: var(--text-s);
    color: var(--text-faint);
  }

  .shell__content {
    flex: 1;
    /* Re-anchor text color here so Calm's remap (below) cascades to EVERY
       route's inherited text, not only elements that name var(--text-color).
       In normal mode this resolves to the same token the body uses. */
    color: var(--text-color);
    /* One shared header→content distance for every route — pages used to
       borrow the (now neutralized) global <section> padding unevenly. */
    padding-block: var(--space-l) var(--space-xxl);
    padding-inline: var(--space-l);
    /* One measure for every route. Lives here so no page re-declares it.
       border-box puts the padding inside the cap, so the body itself lands
       on --page-width. */
    inline-size: 100%;
    max-inline-size: calc(var(--page-width) + var(--space-l) * 2);
    margin-inline: auto;
  }

  /* Calm mode (Desk · Calm) quiets every lens one contrast step — body text
     to muted, dark borders softened. One class for the whole routed surface;
     headings, links and overdue red keep their own tokens. */
  .shell__content--calm {
    --text-color: var(--text-muted);
    --border-color-dark: color-mix(in oklch, var(--neutral) 12%, transparent);
  }

  /* Print: the cap is a screen-reading concern. Documents meant for paper
     (roadsheet) take the full sheet. */
  @media print {
    .shell__content {
      max-inline-size: none;
    }
  }

  /* ── address bar (breadcrumb) ─────────────────────────────────────
     Entity pages fill it via the breadcrumb store; sticks right below
     the top bar so "where am I" is always on screen. The inner column
     centers at the wide page width with the same gutter as the content,
     so the crumbs land on the same left edge as the page masthead (the
     --space-l gutters cancel out — see breadcrumb store). */
  .shell__address {
    position: sticky;
    inset-block-start: var(--header-height);
    z-index: calc(var(--z-sticky) - 1);
    background: color-mix(in oklch, var(--bg-light) 92%, transparent);
    backdrop-filter: blur(8px);
    border-block-end: 1px solid var(--border-color-light);
  }
  .shell__address-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-m);
    max-inline-size: calc(var(--page-width) + var(--space-l) * 2);
    margin-inline: auto;
    padding-block: var(--space-xs);
    padding-inline: var(--space-l);
    min-block-size: 2.75rem;
  }
  .shell__crumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-s);
    min-inline-size: 0;
  }
  .shell__crumb {
    font-size: var(--text-s);
    color: var(--text-muted);
    text-decoration: none;
    transition: color var(--transition);
  }
  .shell__crumb:hover {
    color: var(--text-color);
  }
  .shell__crumb--space {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
  }
  .shell__crumb-dot {
    inline-size: 0.5rem;
    block-size: 0.5rem;
    flex: none;
    border-radius: var(--radius-circle);
    background: var(--c, var(--text-faint));
  }
  .shell__crumb--here {
    font-weight: 600;
    color: var(--heading-color);
  }
  .shell__crumb-sep {
    color: var(--border-color-dark);
  }
  /* ── account menu chrome (unchanged from the previous shell) ── */

  :global(.account-row__kebab) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    inline-size: var(--control-size-s);
    block-size: var(--control-size-s);
    background: transparent;
    border: 0;
    border-radius: var(--radius-circle);
    color: var(--text-faint);
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  :global(.account-row__kebab:hover),
  :global(.account-row__kebab[aria-expanded='true']) {
    background: var(--bg-light);
    color: var(--text-color);
  }
  :global(.account-row__kebab:focus-visible) {
    outline: var(--focus-width) solid var(--focus-color);
    outline-offset: -1px;
  }

  :global(.menu-header) {
    display: flex;
    align-items: center;
    gap: var(--space-s);
    padding-block: var(--space-s);
    padding-inline-start: var(--space-s);
    padding-inline-end: 0;
    border-block-end: 1px solid var(--border-color-light);
    margin-block-end: var(--space-xs);
  }
  :global(.menu-header__identity) {
    display: flex;
    align-items: center;
    gap: var(--space-s);
    flex: 1;
    min-inline-size: 0;
  }
  :global(.menu-header__id) {
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
  }
  :global(.menu-header__name) {
    font-size: var(--text-s);
    color: var(--text-color);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.menu-header__email) {
    font-size: var(--text-xs);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.menu-header__logout) {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    inline-size: var(--control-size-s);
    block-size: var(--control-size-s);
    background: transparent;
    border: 0;
    border-radius: var(--radius-s);
    color: var(--text-faint);
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  :global(.menu-header__logout:hover) {
    background: var(--danger-ultra-light);
    color: var(--danger);
  }
  :global(.menu-header__logout:focus-visible) {
    outline: var(--focus-width) solid var(--focus-color);
    outline-offset: -1px;
  }

  :global(.theme-accordion) {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  :global(.settings-row) {
    display: flex;
    align-items: flex-start;
    gap: 1px;
  }
  :global(.settings-row__link) {
    flex: 1;
  }
  :global(.settings-row__action) {
    --action-color: var(--text-faint);
    --action-color-hover: var(--text-color);
    --action-bg-hover: var(--bg-light);

    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: var(--control-size-s);
    block-size: var(--control-size-s);
    background: transparent;
    border: 0;
    border-radius: var(--radius-s);
    color: var(--action-color);
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  :global(.settings-row__action:hover) {
    background: var(--action-bg-hover);
    color: var(--action-color-hover);
  }
  :global(.settings-row__action:focus-visible) {
    outline: var(--focus-width) solid var(--focus-color);
    outline-offset: -1px;
  }
  :global(.settings-row__action--toggle) {
    --action-color: var(--text-color);
  }
  :global(.settings-row__action--toggle.is-muted) {
    --action-color: var(--text-faint);
  }

  :global(.theme-accordion__header) {
    display: flex;
    align-items: flex-start;
    gap: 1px;
  }
  :global(.theme-accordion__expand) {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    padding-block: var(--space-xs);
    padding-inline: var(--space-s);
    background: transparent;
    border: 0;
    border-radius: var(--radius-s);
    font-family: inherit;
    color: var(--text-color);
    text-align: start;
    cursor: pointer;
    transition: background var(--transition);
    min-inline-size: 0;
  }
  :global(.theme-accordion__expand:hover),
  :global(.theme-accordion__expand[aria-expanded='true']) {
    background: var(--bg-light);
  }
  :global(.theme-accordion__expand:focus-visible) {
    outline: var(--focus-width) solid var(--focus-color);
    outline-offset: -1px;
  }
  :global(.theme-accordion__label) {
    font-size: var(--text-s);
    color: var(--text-color);
    line-height: 1.3;
  }
  :global(.theme-accordion__current) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    max-inline-size: 100%;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: 1.3;
    min-inline-size: 0;
  }
  :global(.theme-accordion__current-name) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-inline-size: 0;
  }
  :global(.theme-accordion__chevron) {
    color: var(--text-faint);
    line-height: 1;
    transition: transform var(--transition);
    flex-shrink: 0;
  }
  :global(.theme-accordion__chevron[data-expanded]) {
    transform: rotate(90deg);
  }
  :global(.theme-accordion__list) {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-inline-start: var(--space-s);
  }
  :global(.theme-accordion__item) {
    display: flex;
  }
  :global(.theme-accordion__select) {
    flex: 1;
    padding-block: var(--space-xs);
    padding-inline: var(--space-s);
    background: transparent;
    border: 0;
    border-radius: var(--radius-s);
    font-family: inherit;
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-align: start;
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  :global(.theme-accordion__select):hover {
    background: var(--bg-light);
    color: var(--heading-color);
  }
  :global(.theme-accordion__select[data-active]) {
    background: var(--bg-light);
    color: var(--heading-color);
    font-weight: 500;
  }

  @media (max-width: 47.999rem) {
    .shell__search {
      min-inline-size: 0;
    }
    .shell__search-label {
      display: none;
    }
    .shell__content {
      padding-inline: var(--space-m);
    }
    .shell__settings-nav {
      display: none;
    }
  }
</style>
