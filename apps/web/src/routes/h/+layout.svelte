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
  import { onDestroy, onMount, untrack } from 'svelte';
  import SettingsNav from '$lib/components/SettingsNav.svelte';
  import PresenceBadge from '$lib/components/PresenceBadge.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import AccountMenu from '$lib/components/shell/AccountMenu.svelte';
  import ScopeBar from '$lib/components/shell/ScopeBar.svelte';
  import ScopeRail from '$lib/components/shell/ScopeRail.svelte';
  import ShellBreadcrumb from '$lib/components/shell/ShellBreadcrumb.svelte';
  import { isReservedWorkspaceSlug } from '$lib/reserved-slugs';
  import { provideLens, type Lens } from '$lib/stores/lens.svelte';
  import { provideCalm } from '$lib/stores/calm.svelte';
  import { providePins, parsePin } from '$lib/stores/pins.svelte';
  import { provideScopes, sameSet as scopesSameSet, type Scope } from '$lib/stores/scopes.svelte';
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
  import { ensureSession, getAccessToken, session } from '$lib/session.svelte';
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
  provideBreadcrumb();
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

        <AccountMenu {workspaceSlug} {menuWorkspaceSlug} {inSettings} {rememberWorkingScope} />
      </div>
    </header>

    <ScopeRail {atHome} {applyScope} {openPaletteFresh} />

    {#if inSettings}
      <aside class="shell__settings-nav">
        <SettingsNav />
      </aside>
    {/if}

    <main class="shell__main">
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

      <ShellBreadcrumb />

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
