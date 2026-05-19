<script lang="ts">
  /**
   * Settings — full-page editorial layout (design v0.5, "Hour Settings.html").
   *
   * Uses `+page@.svelte` so it skips the workspace shell (`/h/[workspace]/
   * +layout.svelte`) and renders directly under the root layout — keeps the
   * QueryClient + base.css but ditches the topbar lenses / Plaza sidebar.
   *
   * Sections (matching the design 1:1):
   *  Profile · Workspaces & roles · Visibility & privacy · Languages ·
   *  Connections · Notifications · Billing · Danger zone
   *
   * Phase 0 reality: most fields are mocked/hardcoded (the user-facing copy
   * matches the design's prototype "Marco Rubiol"). The real bits wired:
   *  - workspaces list comes from /api/houses
   *  - email comes from JWT
   *  - Master View toggle (D-PRE-05) integrated under Notifications
   */

  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { accentVar } from '$lib/utils/accent';
  import { decodeJwtClaim } from '$lib/realtime';
  import {
    isMasterViewEnabled,
    getMasterViewPath,
    setMasterViewEnabled,
    clearMasterViewPath,
  } from '$lib/master-view';

  type SectionId =
    | 'profile'
    | 'workspaces'
    | 'privacy'
    | 'languages'
    | 'connections'
    | 'notifications'
    | 'billing'
    | 'danger';

  type Section = {
    id: SectionId;
    label: string;
    glyph: string;
    danger?: boolean;
  };

  const SECTIONS: Section[] = [
    { id: 'profile', label: 'Profile', glyph: '◯' },
    { id: 'workspaces', label: 'Workspaces & roles', glyph: '▸' },
    { id: 'privacy', label: 'Visibility & privacy', glyph: '◌' },
    { id: 'languages', label: 'Languages', glyph: '¶' },
    { id: 'connections', label: 'Connections', glyph: '◇' },
    { id: 'notifications', label: 'Notifications', glyph: '◉' },
    { id: 'billing', label: 'Billing', glyph: '€' },
    { id: 'danger', label: 'Danger zone', glyph: '⚠', danger: true },
  ];

  let active = $state<SectionId>('profile');
  let workspaceSlug = $derived(page.params.workspace ?? '');

  // ─── identity from JWT ────────────────────────────────────────────────
  let userEmail = $state('');
  let userName = $state('Marco Rubiol');
  let displayName = $state('Marco');

  onMount(() => {
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) return;
    const email = decodeJwtClaim(jwt, 'email');
    if (email) userEmail = email;
    const full =
      decodeJwtClaim(jwt, 'user_metadata.full_name') ||
      decodeJwtClaim(jwt, 'user_metadata.name');
    if (full) {
      userName = full;
      displayName = full.split(/\s+/)[0] ?? full;
    }
  });

  let initials = $derived(
    userName
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || 'MR',
  );

  // ─── workspaces query ─────────────────────────────────────────────────
  type House = {
    id: string;
    slug: string;
    name: string;
    kind: 'personal' | 'team';
  };
  type Room = {
    id: string;
    slug: string;
    name: string;
    workspace_id: string;
    status: 'draft' | 'active' | 'archived';
  };

  async function fetchJSON<T>(url: string, signal: AbortSignal): Promise<T> {
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) throw new Error('Missing JWT');
    const res = await fetch(url, {
      signal,
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return (await res.json()) as T;
  }

  const housesQuery = createQuery({
    queryKey: ['houses'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: House[] }>('/api/houses', signal),
  });

  const roomsQuery = createQuery({
    queryKey: ['rooms', { status: 'active' }],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: Room[] }>('/api/rooms?status=active', signal),
  });

  let houses = $derived($housesQuery.data?.items ?? []);
  let rooms = $derived($roomsQuery.data?.items ?? []);

  // ─── profile state ────────────────────────────────────────────────────
  let profilePronouns = $state('he/him');
  let profileLocation = $state('Barcelona, ES');
  let profileTimezone = $state('Europe/Madrid · CET');
  let weekStarts = $state<'mon' | 'sun'>('mon');

  // ─── privacy state ────────────────────────────────────────────────────
  let privTasksDefault = $state<'shared' | 'private'>('shared');
  let privMoneyVis = $state<'me-only' | 'project' | 'all'>('me-only');
  let privNotesPrivate = $state(true);
  let privDistribution = $state<'me-only' | 'distributors' | 'all'>('me-only');

  // ─── languages state ──────────────────────────────────────────────────
  type LangLevel = 'native' | 'fluent' | 'conversational' | 'basic';
  const WORKING_LANGUAGES = [
    { code: 'CA', name: 'Català', level: 'native' as LangLevel },
    { code: 'ES', name: 'Castellano', level: 'native' as LangLevel },
    { code: 'EN', name: 'English', level: 'fluent' as LangLevel },
    { code: 'FR', name: 'Français', level: 'conversational' as LangLevel },
  ];
  let appLanguage = $state<'ca' | 'es' | 'en' | 'fr'>('en');

  // ─── connections (Phase 0 demo data) ──────────────────────────────────
  type ConnStatus = 'connected' | 'linked' | 'disconnected';
  const CONNECTIONS: {
    id: string;
    name: string;
    provider: string;
    status: ConnStatus;
    detail: string;
    icon: string;
  }[] = [
    { id: 'calendar', name: 'Calendar', provider: 'Fastmail', status: 'connected', detail: 'Two-way sync · last 2 min ago', icon: '▤' },
    { id: 'email', name: 'Email', provider: 'Fastmail IMAP', status: 'connected', detail: 'Parses warm replies & receipts', icon: '✉' },
    { id: 'accounting', name: 'Accounting', provider: 'Holded', status: 'connected', detail: 'Issues invoices · ES IVA', icon: '€' },
    { id: 'spotify', name: 'Spotify for Artists', provider: 'Spotify', status: 'linked', detail: 'Pulls listener stats nightly', icon: '♪' },
    { id: 'bandcamp', name: 'Bandcamp', provider: '—', status: 'disconnected', detail: 'Sales reports & merch orders', icon: '♫' },
    { id: 'drive', name: 'File storage', provider: '—', status: 'disconnected', detail: 'For press kits, riders, master files', icon: '▣' },
    { id: 'bank', name: 'Bank', provider: '—', status: 'disconnected', detail: 'EU bank, for reconciliation only', icon: '◇' },
  ];
  let activeConnections = $derived(
    CONNECTIONS.filter((c) => c.status !== 'disconnected').length,
  );

  // ─── notifications state ──────────────────────────────────────────────
  let notifDigest = $state<'off' | 'weekday' | 'daily'>('weekday');
  let notifWeeklyReview = $state(true);
  let notifWarmReply = $state(true);
  let notifMoneyIn = $state(true);
  let notifMoneyOverdue = $state(true);
  let notifDayOfShow = $state(true);
  let notifEmail = $state(true);
  let notifPush = $state(true);
  let quietStart = $state('22:00');
  let quietEnd = $state('08:00');

  // ─── Master View (D-PRE-05) — real wire ───────────────────────────────
  let masterViewEnabled = $state(false);
  let masterViewPath = $state<string | null>(null);

  function refreshMasterView() {
    masterViewEnabled = isMasterViewEnabled();
    masterViewPath = getMasterViewPath();
  }

  onMount(refreshMasterView);

  function toggleMasterView(next: boolean) {
    masterViewEnabled = next;
    setMasterViewEnabled(next);
    refreshMasterView();
  }

  function clearMasterView() {
    clearMasterViewPath();
    refreshMasterView();
  }

  // Hardcoded role set for Phase 0 — Marco's hats.
  const ALL_ROLES = [
    'author',
    'performer',
    'musician',
    'lighting',
    'sound',
    'production',
    'distribution',
    'technician',
  ];
  let activeRoles = $state(
    new Set<string>([
      'musician',
      'lighting',
      'distribution',
      'production',
      'author',
      'performer',
    ]),
  );

  function toggleRole(role: string) {
    if (activeRoles.has(role)) activeRoles.delete(role);
    else activeRoles.add(role);
    activeRoles = new Set(activeRoles);
  }
</script>

<svelte:head>
  <title>Settings — Hour</title>
</svelte:head>

<div class="set">
  <aside class="set-plaza">
    <div class="set-plaza__top">
      <a class="set-brand" href={`/h/${workspaceSlug}/`}>
        <span class="set-brand__mark" aria-hidden="true"></span>
        <span>hour</span>
      </a>

      <a class="set-back" href={`/h/${workspaceSlug}/`}>
        <span class="set-back__arrow" aria-hidden="true">‹</span>
        <span>back to dashboard</span>
      </a>

      <div class="set-plaza__label">Settings</div>

      <nav class="set-nav">
        {#each SECTIONS as s (s.id)}
          <button
            type="button"
            class={[
              'set-nav__item',
              active === s.id && 'is-active',
              s.danger && 'is-danger',
            ]
              .filter(Boolean)
              .join(' ')}
            onclick={() => (active = s.id)}
          >
            <span class="set-nav__glyph" aria-hidden="true">{s.glyph}</span>
            <span class="set-nav__label">{s.label}</span>
          </button>
        {/each}
      </nav>
    </div>

    <div class="set-plaza__foot">
      <div class="set-me-av" style={`background: ${accentVar(workspaceSlug)}`}>
        {initials}
      </div>
      <div class="set-plaza__foot-id">
        <div class="set-me-name">{userName}</div>
        <div class="set-me-email">{userEmail || '—'}</div>
      </div>
    </div>
  </aside>

  <main class="set-main">
    <article class="set-page">
      {#if active === 'profile'}
        <header class="set-mast">
          <p class="set-mast__kicker">Account</p>
          <h1 class="set-mast__title"><em>Profile</em></h1>
          <p class="set-mast__sub">
            The basics. Used across your projects and on press kits.
          </p>
        </header>

        <section class="set-group">
          <div class="set-group__body">
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Avatar</div>
                <div class="set-row__hint">
                  A monogram for now. Drop an image later.
                </div>
              </div>
              <div class="set-row__ctrl">
                <div class="set-avatar-pick">
                  <span
                    class="set-avatar-pick__big"
                    style={`background: ${accentVar(workspaceSlug)}`}
                  >
                    {initials}
                  </span>
                  <button type="button" class="set-connect-btn">
                    Upload image
                  </button>
                  <span class="set-row__hint">PNG, square, ≥ 256px</span>
                </div>
              </div>
            </div>

            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Full name</div>
                <div class="set-row__hint">Used on invoices and contracts.</div>
              </div>
              <div class="set-row__ctrl">
                <input class="set-input" type="text" bind:value={userName} />
              </div>
            </div>

            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Display name</div>
                <div class="set-row__hint">What collaborators see.</div>
              </div>
              <div class="set-row__ctrl">
                <input class="set-input" type="text" bind:value={displayName} />
              </div>
            </div>

            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Pronouns</div>
                <div class="set-row__hint">Optional. Shown on your profile.</div>
              </div>
              <div class="set-row__ctrl">
                <input
                  class="set-input set-input--short"
                  type="text"
                  bind:value={profilePronouns}
                />
              </div>
            </div>

            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Email</div>
                <div class="set-row__hint">Sign-in and project invitations.</div>
              </div>
              <div class="set-row__ctrl">
                <input
                  class="set-input"
                  type="email"
                  bind:value={userEmail}
                  readonly
                />
              </div>
            </div>
          </div>
        </section>

        <section class="set-group">
          <div class="set-group__head">
            <span class="set-group__kicker">Where &amp; when</span>
            <h2 class="set-group__title">Location &amp; timezone</h2>
          </div>
          <div class="set-group__body">
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Location</div>
              </div>
              <div class="set-row__ctrl">
                <input class="set-input" type="text" bind:value={profileLocation} />
              </div>
            </div>

            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Timezone</div>
                <div class="set-row__hint">
                  Used to format dates and the “today” line.
                </div>
              </div>
              <div class="set-row__ctrl">
                <input class="set-input" type="text" bind:value={profileTimezone} />
              </div>
            </div>

            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Week starts on</div>
              </div>
              <div class="set-row__ctrl">
                <div class="set-seg">
                  <button
                    type="button"
                    class={weekStarts === 'mon' ? 'is-on' : ''}
                    onclick={() => (weekStarts = 'mon')}
                  >Monday</button>
                  <button
                    type="button"
                    class={weekStarts === 'sun' ? 'is-on' : ''}
                    onclick={() => (weekStarts = 'sun')}
                  >Sunday</button>
                </div>
              </div>
            </div>
          </div>
        </section>
      {/if}

      {#if active === 'workspaces'}
        <header class="set-mast">
          <p class="set-mast__kicker">Roster</p>
          <h1 class="set-mast__title"><em>Workspaces &amp; roles</em></h1>
          <p class="set-mast__sub">
            Each project is its own workspace. Your role decides what you see —
            and what your collaborators see of you.
          </p>
        </header>

        <section class="set-group">
          <div class="set-group__head">
            <span class="set-group__kicker">{houses.length} active</span>
            <h2 class="set-group__title">My projects</h2>
          </div>
          <div class="set-group__body">
            <div class="set-ws-list">
              {#each houses as h (h.id)}
                {@const roomCount = rooms.filter((r) => r.workspace_id === h.id).length}
                {@const myRoles =
                  h.kind === 'personal'
                    ? ['author', 'performer']
                    : ['musician', 'lighting', 'distribution']}
                <div class="set-ws" style={`--c: ${accentVar(h.slug)}`}>
                  <div class="set-ws__rail"></div>
                  <div class="set-ws__name">
                    <h3>{h.name}</h3>
                    <div class="set-ws__sub">
                      {h.kind === 'personal' ? 'Personal workspace' : 'Team workspace'}
                    </div>
                  </div>
                  <div class="set-ws__roles">
                    {#each myRoles as role (role)}
                      <span class="set-role is-mine">{role}</span>
                    {/each}
                  </div>
                  <div class="set-ws__meta">
                    <span>— people</span>
                    <span class="sep">·</span>
                    <span>{roomCount} {roomCount === 1 ? 'project' : 'projects'}</span>
                  </div>
                  <div class="set-ws__actions">
                    <button type="button" class="set-ghost-btn">edit role</button>
                    <button type="button" class="set-ghost-btn is-warn">leave</button>
                  </div>
                </div>
              {/each}
            </div>
            <button type="button" class="set-add">
              + Create or join a workspace
            </button>
          </div>
        </section>

        <section class="set-group">
          <div class="set-group__head">
            <span class="set-group__kicker">By role</span>
            <h2 class="set-group__title">Roles I take on</h2>
          </div>
          <div class="set-group__body">
            <p class="set-prose">
              Hour groups your work by the role you play. Toggle which roles to
              surface in the side filter.
            </p>
            <div class="set-roles-grid">
              {#each ALL_ROLES as role (role)}
                <button
                  type="button"
                  class={['set-role-chip', activeRoles.has(role) && 'is-on']
                    .filter(Boolean)
                    .join(' ')}
                  onclick={() => toggleRole(role)}
                >
                  <span class="set-role-chip__dot" aria-hidden="true"></span>
                  <span>{role}</span>
                </button>
              {/each}
            </div>
          </div>
        </section>
      {/if}

      {#if active === 'privacy'}
        <header class="set-mast">
          <p class="set-mast__kicker">Boundaries</p>
          <h1 class="set-mast__title"><em>Visibility &amp; privacy</em></h1>
          <p class="set-mast__sub">
            Across your collectives, some things are shared and some are yours
            alone. Defaults here apply to every new project.
          </p>
        </header>

        <section class="set-group">
          <div class="set-group__head">
            <span class="set-group__kicker">Defaults</span>
          </div>
          <div class="set-group__body">
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">New tasks default to</div>
                <div class="set-row__hint">You can flip any individual task later.</div>
              </div>
              <div class="set-row__ctrl">
                <div class="set-seg">
                  <button
                    type="button"
                    class={privTasksDefault === 'shared' ? 'is-on' : ''}
                    onclick={() => (privTasksDefault = 'shared')}
                  >Shared</button>
                  <button
                    type="button"
                    class={privTasksDefault === 'private' ? 'is-on' : ''}
                    onclick={() => (privTasksDefault = 'private')}
                  >Private</button>
                </div>
              </div>
            </div>

            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Money visibility</div>
                <div class="set-row__hint">Who can see fees, invoices, chases.</div>
              </div>
              <div class="set-row__ctrl">
                <div class="set-seg">
                  <button
                    type="button"
                    class={privMoneyVis === 'me-only' ? 'is-on' : ''}
                    onclick={() => (privMoneyVis = 'me-only')}
                  >Only me</button>
                  <button
                    type="button"
                    class={privMoneyVis === 'project' ? 'is-on' : ''}
                    onclick={() => (privMoneyVis = 'project')}
                  >Per-project rule</button>
                  <button
                    type="button"
                    class={privMoneyVis === 'all' ? 'is-on' : ''}
                    onclick={() => (privMoneyVis = 'all')}
                  >All collaborators</button>
                </div>
              </div>
            </div>

            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Private notes</div>
                <div class="set-row__hint">Your tech notes, drafts, hot takes.</div>
              </div>
              <div class="set-row__ctrl">
                <button
                  type="button"
                  class={['set-toggle', privNotesPrivate && 'is-on']
                    .filter(Boolean)
                    .join(' ')}
                  aria-label="Private notes"
                  aria-pressed={privNotesPrivate}
                  onclick={() => (privNotesPrivate = !privNotesPrivate)}
                >
                  <span class="set-toggle__dot"></span>
                </button>
              </div>
            </div>

            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Distribution pipeline</div>
                <div class="set-row__hint">Letters out, warm replies, dead leads.</div>
              </div>
              <div class="set-row__ctrl">
                <div class="set-seg">
                  <button
                    type="button"
                    class={privDistribution === 'me-only' ? 'is-on' : ''}
                    onclick={() => (privDistribution = 'me-only')}
                  >Only me</button>
                  <button
                    type="button"
                    class={privDistribution === 'distributors' ? 'is-on' : ''}
                    onclick={() => (privDistribution = 'distributors')}
                  >Distributors only</button>
                  <button
                    type="button"
                    class={privDistribution === 'all' ? 'is-on' : ''}
                    onclick={() => (privDistribution = 'all')}
                  >Everyone</button>
                </div>
              </div>
            </div>
          </div>
        </section>
      {/if}

      {#if active === 'languages'}
        <header class="set-mast">
          <p class="set-mast__kicker">Materials</p>
          <h1 class="set-mast__title"><em>Languages</em></h1>
          <p class="set-mast__sub">
            Press kits, dossiers, riders — Hour produces each in the languages
            you work in.
          </p>
        </header>

        <section class="set-group">
          <div class="set-group__head">
            <span class="set-group__kicker">Working languages</span>
          </div>
          <div class="set-group__body">
            <div class="set-lang-list">
              {#each WORKING_LANGUAGES as l, i (l.code)}
                <div class="set-lang">
                  <span class="set-lang__code">{l.code}</span>
                  <span class="set-lang__name">{l.name}</span>
                  <div class="set-seg">
                    {#each ['native', 'fluent', 'conversational', 'basic'] as level (level)}
                      <button
                        type="button"
                        class={l.level === level ? 'is-on' : ''}
                      >{level}</button>
                    {/each}
                  </div>
                  {#if i === 0}
                    <span class="set-lang__primary">primary</span>
                  {:else}
                    <button type="button" class="set-ghost-btn">make primary</button>
                  {/if}
                  <button type="button" class="set-ghost-btn is-warn">remove</button>
                </div>
              {/each}
            </div>
            <button type="button" class="set-add">+ Add a language</button>
          </div>
        </section>

        <section class="set-group">
          <div class="set-group__head">
            <span class="set-group__kicker">Interface</span>
          </div>
          <div class="set-group__body">
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">App language</div>
                <div class="set-row__hint">The Hour interface itself.</div>
              </div>
              <div class="set-row__ctrl">
                <div class="set-seg">
                  <button
                    type="button"
                    class={appLanguage === 'ca' ? 'is-on' : ''}
                    onclick={() => (appLanguage = 'ca')}
                  >Català</button>
                  <button
                    type="button"
                    class={appLanguage === 'es' ? 'is-on' : ''}
                    onclick={() => (appLanguage = 'es')}
                  >Castellano</button>
                  <button
                    type="button"
                    class={appLanguage === 'en' ? 'is-on' : ''}
                    onclick={() => (appLanguage = 'en')}
                  >English</button>
                  <button
                    type="button"
                    class={appLanguage === 'fr' ? 'is-on' : ''}
                    onclick={() => (appLanguage = 'fr')}
                  >Français</button>
                </div>
              </div>
            </div>
          </div>
        </section>
      {/if}

      {#if active === 'connections'}
        <header class="set-mast">
          <p class="set-mast__kicker">Plumbing</p>
          <h1 class="set-mast__title"><em>Connections</em></h1>
          <p class="set-mast__sub">
            Hour talks to your calendar, your email, your accountant. Connect
            once, forget.
          </p>
        </header>

        <section class="set-group">
          <div class="set-group__head">
            <span class="set-group__kicker">{activeConnections} active</span>
          </div>
          <div class="set-group__body">
            <div class="set-conn-list">
              {#each CONNECTIONS as c (c.id)}
                <div class="set-conn" data-status={c.status}>
                  <span class="set-conn__icon">{c.icon}</span>
                  <div class="set-conn__name">
                    <strong>{c.name}</strong>
                    <span>{c.provider}</span>
                  </div>
                  <div class="set-conn__detail">{c.detail}</div>
                  {#if c.status === 'connected' || c.status === 'linked'}
                    <span class="set-connect is-on">
                      <span class="set-connect__dot"></span>
                      <span>{c.status === 'linked' ? 'linked' : 'connected'}</span>
                      <span class="set-connect__sep">·</span>
                      <span class="set-connect__manage">manage</span>
                    </span>
                  {:else}
                    <button type="button" class="set-connect-btn">Connect</button>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        </section>

        <section class="set-group">
          <div class="set-group__head">
            <span class="set-group__kicker">Webhooks &amp; API</span>
          </div>
          <div class="set-group__body">
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Personal API token</div>
                <div class="set-row__hint">For scripts that read your calendar.</div>
              </div>
              <div class="set-row__ctrl">
                <div class="set-token">
                  <code>hour_sk_•••••••••••••••••••••••••</code>
                  <button type="button" class="set-ghost-btn">reveal</button>
                  <button type="button" class="set-ghost-btn">rotate</button>
                </div>
              </div>
            </div>
          </div>
        </section>
      {/if}

      {#if active === 'notifications'}
        <header class="set-mast">
          <p class="set-mast__kicker">Quiet by default</p>
          <h1 class="set-mast__title"><em>Notifications</em></h1>
          <p class="set-mast__sub">
            Hour only nudges you when something genuinely changed. You decide
            where.
          </p>
        </header>

        <section class="set-group">
          <div class="set-group__head">
            <span class="set-group__kicker">Digest</span>
          </div>
          <div class="set-group__body">
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Daily digest</div>
                <div class="set-row__hint">A morning summary of your week.</div>
              </div>
              <div class="set-row__ctrl">
                <div class="set-seg">
                  <button
                    type="button"
                    class={notifDigest === 'off' ? 'is-on' : ''}
                    onclick={() => (notifDigest = 'off')}
                  >Off</button>
                  <button
                    type="button"
                    class={notifDigest === 'weekday' ? 'is-on' : ''}
                    onclick={() => (notifDigest = 'weekday')}
                  >Mon–Fri</button>
                  <button
                    type="button"
                    class={notifDigest === 'daily' ? 'is-on' : ''}
                    onclick={() => (notifDigest = 'daily')}
                  >Every day</button>
                </div>
              </div>
            </div>

            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Weekly review</div>
                <div class="set-row__hint">Sunday evening, ten minutes of looking back.</div>
              </div>
              <div class="set-row__ctrl">
                <button
                  type="button"
                  class={['set-toggle', notifWeeklyReview && 'is-on'].filter(Boolean).join(' ')}
                  aria-label="Weekly review"
                  aria-pressed={notifWeeklyReview}
                  onclick={() => (notifWeeklyReview = !notifWeeklyReview)}
                >
                  <span class="set-toggle__dot"></span>
                </button>
              </div>
            </div>
          </div>
        </section>

        <section class="set-group">
          <div class="set-group__head">
            <span class="set-group__kicker">Priority alerts</span>
          </div>
          <div class="set-group__body">
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Warm reply lands</div>
                <div class="set-row__hint">Someone you pitched said yes-ish.</div>
              </div>
              <div class="set-row__ctrl">
                <button
                  type="button"
                  class={['set-toggle', notifWarmReply && 'is-on'].filter(Boolean).join(' ')}
                  aria-label="Warm reply lands"
                  aria-pressed={notifWarmReply}
                  onclick={() => (notifWarmReply = !notifWarmReply)}
                >
                  <span class="set-toggle__dot"></span>
                </button>
              </div>
            </div>
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Money in</div>
                <div class="set-row__hint">A wire matches an invoice.</div>
              </div>
              <div class="set-row__ctrl">
                <button
                  type="button"
                  class={['set-toggle', notifMoneyIn && 'is-on'].filter(Boolean).join(' ')}
                  aria-label="Money in"
                  aria-pressed={notifMoneyIn}
                  onclick={() => (notifMoneyIn = !notifMoneyIn)}
                >
                  <span class="set-toggle__dot"></span>
                </button>
              </div>
            </div>
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Money overdue</div>
                <div class="set-row__hint">A fee past 60 days.</div>
              </div>
              <div class="set-row__ctrl">
                <button
                  type="button"
                  class={['set-toggle', notifMoneyOverdue && 'is-on'].filter(Boolean).join(' ')}
                  aria-label="Money overdue"
                  aria-pressed={notifMoneyOverdue}
                  onclick={() => (notifMoneyOverdue = !notifMoneyOverdue)}
                >
                  <span class="set-toggle__dot"></span>
                </button>
              </div>
            </div>
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Day-of-show</div>
                <div class="set-row__hint">Six hours before doors.</div>
              </div>
              <div class="set-row__ctrl">
                <button
                  type="button"
                  class={['set-toggle', notifDayOfShow && 'is-on'].filter(Boolean).join(' ')}
                  aria-label="Day-of-show"
                  aria-pressed={notifDayOfShow}
                  onclick={() => (notifDayOfShow = !notifDayOfShow)}
                >
                  <span class="set-toggle__dot"></span>
                </button>
              </div>
            </div>
          </div>
        </section>

        <section class="set-group">
          <div class="set-group__head">
            <span class="set-group__kicker">Channels</span>
          </div>
          <div class="set-group__body">
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Email</div>
                <div class="set-row__hint">{userEmail || '—'}</div>
              </div>
              <div class="set-row__ctrl">
                <button
                  type="button"
                  class={['set-toggle', notifEmail && 'is-on'].filter(Boolean).join(' ')}
                  aria-label="Email notifications"
                  aria-pressed={notifEmail}
                  onclick={() => (notifEmail = !notifEmail)}
                >
                  <span class="set-toggle__dot"></span>
                </button>
              </div>
            </div>
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Mobile push</div>
                <div class="set-row__hint">iOS app · Android app</div>
              </div>
              <div class="set-row__ctrl">
                <button
                  type="button"
                  class={['set-toggle', notifPush && 'is-on'].filter(Boolean).join(' ')}
                  aria-label="Mobile push notifications"
                  aria-pressed={notifPush}
                  onclick={() => (notifPush = !notifPush)}
                >
                  <span class="set-toggle__dot"></span>
                </button>
              </div>
            </div>
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Quiet hours</div>
                <div class="set-row__hint">No pings on the road.</div>
              </div>
              <div class="set-row__ctrl">
                <div class="set-hours">
                  <input class="set-input set-input--tight" type="text" bind:value={quietStart} />
                  <span class="sep">→</span>
                  <input class="set-input set-input--tight" type="text" bind:value={quietEnd} />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="set-group">
          <div class="set-group__head">
            <span class="set-group__kicker">Browser memory</span>
          </div>
          <div class="set-group__body">
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Master View</div>
                <div class="set-row__hint">
                  Remember the last page you visited inside a project and open
                  there next sign-in. Per-browser; not synced across devices.
                </div>
              </div>
              <div class="set-row__ctrl">
                <button
                  type="button"
                  class={['set-toggle', masterViewEnabled && 'is-on']
                    .filter(Boolean)
                    .join(' ')}
                  aria-label="Master View — remember last visited page"
                  aria-pressed={masterViewEnabled}
                  onclick={() => toggleMasterView(!masterViewEnabled)}
                >
                  <span class="set-toggle__dot"></span>
                </button>
              </div>
            </div>
            {#if masterViewEnabled && masterViewPath}
              <div class="set-row">
                <div class="set-row__lead">
                  <div class="set-row__label">Saved view</div>
                  <div class="set-row__hint">
                    Will open <code class="set-codeline">{masterViewPath}</code>
                    on next sign-in.
                  </div>
                </div>
                <div class="set-row__ctrl">
                  <button
                    type="button"
                    class="set-ghost-btn"
                    onclick={clearMasterView}
                  >Clear saved view</button>
                </div>
              </div>
            {/if}
          </div>
        </section>
      {/if}

      {#if active === 'billing'}
        <header class="set-mast">
          <p class="set-mast__kicker">House money</p>
          <h1 class="set-mast__title"><em>Billing</em></h1>
          <p class="set-mast__sub">
            Hour is a small Barcelona-based tool. Your money goes a long way here.
          </p>
        </header>

        <section class="set-group">
          <div class="set-group__body">
            <div class="set-plan">
              <div class="set-plan__head">
                <span class="set-plan__kicker">Current plan</span>
                <h2 class="set-plan__name">
                  Solo <em>·</em> <span>€9/mo</span>
                </h2>
                <p class="set-plan__sub">
                  All features, unlimited projects, one person. Next billing 1
                  May 2026.
                </p>
              </div>
              <div class="set-plan__actions">
                <button type="button" class="set-connect-btn">
                  Switch to yearly · save 20%
                </button>
                <button type="button" class="set-ghost-btn">
                  Upgrade to Collective (€19/mo, up to 6 people)
                </button>
                <button type="button" class="set-ghost-btn is-warn">Cancel plan</button>
              </div>
            </div>
          </div>
        </section>

        <section class="set-group">
          <div class="set-group__head">
            <span class="set-group__kicker">Payment</span>
          </div>
          <div class="set-group__body">
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Method</div>
              </div>
              <div class="set-row__ctrl">
                <div class="set-card">
                  <span class="set-card__brand">VISA</span>
                  <span>•••• 4242</span>
                  <span class="set-row__hint">exp 11/27</span>
                  <button type="button" class="set-ghost-btn">update</button>
                </div>
              </div>
            </div>
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Billing email</div>
                <div class="set-row__hint">Receipts and VAT documents.</div>
              </div>
              <div class="set-row__ctrl">
                <input class="set-input" type="email" value={userEmail} readonly />
              </div>
            </div>
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Tax ID</div>
                <div class="set-row__hint">ES NIF / EU VAT — for proper invoices.</div>
              </div>
              <div class="set-row__ctrl">
                <input class="set-input set-input--short" type="text" value="ES 41XXXXXXX-A" />
              </div>
            </div>
          </div>
        </section>

        <section class="set-group">
          <div class="set-group__head">
            <span class="set-group__kicker">History</span>
          </div>
          <div class="set-group__body">
            <div class="set-invoices">
              {#each ['2026-04-01', '2026-03-01', '2026-02-01', '2026-01-01'] as d (d)}
                <div class="set-invoice">
                  <span class="set-invoice__date">{d}</span>
                  <span class="set-invoice__plan">Solo · monthly</span>
                  <span class="set-invoice__amt">€9.00</span>
                  <span class="set-invoice__status">paid</span>
                  <button type="button" class="set-ghost-btn">PDF</button>
                </div>
              {/each}
            </div>
          </div>
        </section>
      {/if}

      {#if active === 'danger'}
        <header class="set-mast">
          <p class="set-mast__kicker">Last resort</p>
          <h1 class="set-mast__title"><em>Danger zone</em></h1>
          <p class="set-mast__sub">
            The buttons here can't be undone. Read twice.
          </p>
        </header>

        <section class="set-group">
          <div class="set-group__body">
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Export all data</div>
                <div class="set-row__hint">
                  A zip of every project, contact, show, invoice and note — in
                  open formats.
                </div>
              </div>
              <div class="set-row__ctrl">
                <button type="button" class="set-ghost-btn">Request export</button>
              </div>
            </div>
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Leave all workspaces</div>
                <div class="set-row__hint">
                  Your collaborators keep what they had access to. You keep the
                  rest.
                </div>
              </div>
              <div class="set-row__ctrl">
                <button type="button" class="set-ghost-btn is-warn">Leave all…</button>
              </div>
            </div>
            <div class="set-row is-danger">
              <div class="set-row__lead">
                <div class="set-row__label">Delete account</div>
                <div class="set-row__hint">
                  14-day grace period after which everything is purged.
                </div>
              </div>
              <div class="set-row__ctrl">
                <button type="button" class="set-danger-btn">
                  Delete my Hour…
                </button>
              </div>
            </div>
          </div>
        </section>
      {/if}
    </article>
  </main>
</div>

<style>
  .set {
    --sidebar-w: 264px;
    --set-pad: clamp(16px, 1.6vw, 24px);

    display: grid;
    grid-template-columns: var(--sidebar-w) 1fr;
    block-size: 100dvh;
    overflow: hidden;
    background: var(--bg);
    color: var(--text-color);
    font-family: var(--font-sans);
  }

  @media (max-width: 47.999rem) {
    .set {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
    }
    .set-plaza {
      border-inline-end: 0;
      border-block-end: 1px solid var(--border-color-light);
    }
    .set-plaza__top {
      max-block-size: 220px;
    }
  }

  .set-plaza {
    display: flex;
    flex-direction: column;
    border-inline-end: 1px solid var(--border-color-light);
    background: var(--bg-light);
    min-block-size: 0;
    overflow: hidden;
  }
  .set-plaza__top {
    padding: var(--set-pad);
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-block-size: 0;
    overflow-y: auto;
  }

  .set-brand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-s);
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-style: italic;
    font-weight: 400;
    letter-spacing: -0.02em;
    color: var(--text-color);
    text-decoration: none;
    margin-block-end: var(--space-xs);
  }
  .set-brand__mark {
    inline-size: 10px;
    block-size: 10px;
    border: 1px solid currentColor;
    border-radius: 2px;
  }

  .set-back {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    text-decoration: none;
    padding-block: var(--space-xs);
    margin-block-end: var(--set-pad);
    transition: color var(--transition);
  }
  .set-back:hover {
    color: var(--text-color);
  }
  .set-back__arrow {
    font-size: var(--text-s);
    line-height: 1;
  }

  .set-plaza__label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-faint);
    margin-block-end: var(--space-s);
    padding-inline-start: 2px;
  }

  .set-nav {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .set-nav__item {
    appearance: none;
    background: transparent;
    border: 0;
    text-align: start;
    display: grid;
    grid-template-columns: 18px 1fr;
    gap: var(--space-s);
    align-items: center;
    padding-block: var(--space-s);
    padding-inline: var(--space-s);
    border-radius: var(--radius-s);
    cursor: pointer;
    font: inherit;
    font-size: var(--text-s);
    color: var(--text-muted);
    transition: background var(--transition), color var(--transition);
  }
  .set-nav__item:hover {
    background: var(--bg-hover);
    color: var(--text-color);
  }
  .set-nav__item.is-active {
    background: var(--bg-active);
    color: var(--text-color);
    box-shadow: inset 2px 0 0 var(--text-color);
    font-weight: 500;
  }
  .set-nav__item.is-danger {
    color: var(--danger);
  }
  .set-nav__item.is-danger.is-active {
    background: oklch(96% 0.03 25);
    box-shadow: inset 2px 0 0 var(--danger);
  }
  .set-nav__glyph {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-faint);
    text-align: center;
  }
  .set-nav__item.is-active .set-nav__glyph {
    color: var(--text-color);
  }
  .set-nav__item.is-danger .set-nav__glyph {
    color: var(--danger);
  }

  .set-plaza__foot {
    display: flex;
    align-items: center;
    gap: var(--space-s);
    padding: var(--set-pad);
    border-block-start: 1px solid var(--border-color-light);
    flex: none;
  }
  .set-me-av {
    inline-size: 28px;
    block-size: 28px;
    border-radius: 50%;
    color: var(--bg);
    display: grid;
    place-items: center;
    font-size: var(--text-xs);
    font-weight: 600;
    flex: none;
    font-family: var(--font-mono);
  }
  .set-plaza__foot-id {
    min-inline-size: 0;
  }
  .set-me-name {
    font-size: var(--text-s);
    color: var(--text-color);
    font-weight: 500;
  }
  .set-me-email {
    font-size: var(--text-xs);
    color: var(--text-faint);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .set-main {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-inline-size: 0;
  }
  .set-page {
    flex: 1;
    overflow-y: auto;
    padding-block-start: var(--set-pad);
    padding-block-end: var(--section-space-xl);
    padding-inline: calc(var(--set-pad) * 1.5);
    max-inline-size: 920px;
    inline-size: 100%;
    margin-inline: auto;
  }

  .set-mast {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    margin-block-end: calc(var(--set-pad) * 1.2);
    padding-block-end: var(--space-m);
  }
  .set-mast__kicker {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .set-mast__title {
    font-family: var(--font-display);
    font-size: clamp(2rem, 3vw, 2.4rem);
    font-weight: 400;
    letter-spacing: -0.025em;
    line-height: 1.05;
    margin: 0;
  }
  .set-mast__title em {
    font-style: italic;
    color: var(--text-color);
  }
  .set-mast__sub {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-m);
    line-height: 1.55;
    max-inline-size: 56ch;
  }

  .set-group {
    margin-block-end: calc(var(--set-pad) * 2);
  }
  .set-group__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    margin-block-end: var(--space-s);
    padding-block-end: var(--space-xs);
    border-block-end: 1px solid var(--border-color-light);
  }
  .set-group__kicker {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .set-group__title {
    font-family: var(--font-display);
    font-size: 1.35rem;
    font-weight: 400;
    letter-spacing: -0.015em;
    margin: 0;
    color: var(--text-color);
  }
  .set-group__body {
    display: flex;
    flex-direction: column;
  }

  .set-row {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) minmax(280px, 1.6fr);
    gap: calc(var(--set-pad) * 1.4);
    align-items: start;
    padding-block: var(--set-pad);
    border-block-end: 1px solid var(--border-color-light);
  }
  .set-row:last-child {
    border-block-end: 0;
  }
  .set-row__lead {
    padding-block-start: var(--space-xs);
  }
  .set-row__label {
    font-size: var(--text-s);
    font-weight: 500;
    color: var(--text-color);
    line-height: 1.3;
  }
  .set-row__hint {
    font-size: var(--text-xs);
    color: var(--text-faint);
    line-height: 1.55;
    margin-block-start: var(--space-xs);
    max-inline-size: 36ch;
  }
  .set-row__ctrl {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-s);
  }
  .set-row.is-danger .set-row__label {
    color: var(--danger);
  }

  .set-prose {
    font-size: var(--text-s);
    color: var(--text-muted);
    line-height: 1.6;
    margin-block: 0 var(--space-s);
    max-inline-size: 56ch;
  }

  .set-input {
    appearance: none;
    border: 1px solid var(--border-color-dark);
    background: var(--bg-ultra-light);
    padding-block: var(--space-s);
    padding-inline: var(--space-s);
    font: inherit;
    font-size: var(--text-s);
    color: var(--text-color);
    border-radius: var(--radius);
    inline-size: 100%;
    max-inline-size: 360px;
    transition: border-color var(--transition), background var(--transition);
  }
  .set-input:focus {
    outline: none;
    border-color: var(--text-color);
    background: var(--bg);
  }
  .set-input--short {
    max-inline-size: 160px;
  }
  .set-input--tight {
    inline-size: 80px;
  }

  .set-seg {
    display: inline-flex;
    background: var(--bg-light);
    border: 1px solid var(--border-color-light);
    border-radius: var(--radius);
    padding: 2px;
  }
  .set-seg button {
    appearance: none;
    background: transparent;
    border: 0;
    font: inherit;
    font-size: var(--text-xs);
    color: var(--text-muted);
    padding-block: var(--space-xs);
    padding-inline: var(--space-s);
    border-radius: 4px;
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  .set-seg button:hover {
    color: var(--text-color);
  }
  .set-seg button.is-on {
    background: var(--bg-ultra-light);
    color: var(--text-color);
    font-weight: 500;
    box-shadow: 0 1px 2px oklch(0% 0 0 / 0.06);
  }

  .set-toggle {
    appearance: none;
    border: 0;
    background: var(--border-color-dark);
    inline-size: 36px;
    block-size: 20px;
    border-radius: 999px;
    padding: 2px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    transition: background 160ms;
  }
  .set-toggle__dot {
    inline-size: 16px;
    block-size: 16px;
    border-radius: 50%;
    background: var(--bg-ultra-light);
    box-shadow: 0 1px 3px oklch(0% 0 0 / 0.12);
    transition: transform 160ms;
  }
  .set-toggle.is-on {
    background: var(--text-color);
  }
  .set-toggle.is-on .set-toggle__dot {
    transform: translateX(16px);
  }

  .set-connect-btn,
  .set-ghost-btn,
  .set-danger-btn,
  .set-add {
    appearance: none;
    font: inherit;
    font-size: var(--text-xs);
    padding-block: var(--space-s);
    padding-inline: var(--space-m);
    border-radius: var(--radius-s);
    cursor: pointer;
    border: 1px solid var(--border-color-dark);
    background: var(--bg-ultra-light);
    color: var(--text-color);
    transition: background var(--transition), color var(--transition),
      border-color var(--transition), opacity var(--transition);
  }
  .set-connect-btn {
    background: var(--text-color);
    color: var(--bg);
    border-color: var(--text-color);
  }
  .set-connect-btn:hover {
    opacity: 0.85;
  }

  .set-ghost-btn {
    background: transparent;
    color: var(--text-muted);
  }
  .set-ghost-btn:hover {
    color: var(--text-color);
    background: var(--bg-hover);
  }
  .set-ghost-btn.is-warn {
    color: var(--danger);
    border-color: oklch(80% 0.07 25);
  }
  .set-ghost-btn.is-warn:hover {
    background: oklch(96% 0.03 25);
  }

  .set-danger-btn {
    background: var(--danger);
    color: var(--white);
    border-color: var(--danger);
    font-weight: 500;
  }
  .set-danger-btn:hover {
    opacity: 0.9;
  }

  .set-add {
    align-self: flex-start;
    background: transparent;
    border-style: dashed;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    margin-block-start: var(--space-s);
    padding-block: var(--space-s);
    padding-inline: var(--space-m);
  }
  .set-add:hover {
    color: var(--text-color);
    border-color: var(--text-muted);
  }

  .set-connect {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    color: var(--success);
  }
  .set-connect.is-on .set-connect__dot {
    background: var(--success);
    box-shadow: 0 0 0 3px oklch(95% 0.03 150);
  }
  .set-connect__dot {
    inline-size: 7px;
    block-size: 7px;
    border-radius: 50%;
  }
  .set-connect__sep {
    color: var(--text-faint);
  }
  .set-connect__manage {
    color: var(--text-muted);
    text-decoration: underline;
    text-decoration-color: var(--border-color-dark);
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .set-connect__manage:hover {
    color: var(--text-color);
  }

  .set-avatar-pick {
    display: inline-flex;
    align-items: center;
    gap: var(--space-m);
  }
  .set-avatar-pick__big {
    inline-size: 60px;
    block-size: 60px;
    border-radius: 50%;
    color: var(--bg);
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-size: var(--text-l);
    font-weight: 600;
  }

  .set-ws-list {
    display: flex;
    flex-direction: column;
  }
  .set-ws {
    display: grid;
    grid-template-columns: 4px minmax(140px, 1fr) auto auto auto;
    gap: var(--set-pad);
    align-items: center;
    padding-block: var(--space-m);
    border-block-end: 1px solid var(--border-color-light);
  }
  .set-ws:last-child {
    border-block-end: 0;
  }
  .set-ws__rail {
    inline-size: 4px;
    block-size: 38px;
    background: var(--c);
    border-radius: 2px;
  }
  .set-ws__name h3 {
    font-family: var(--font-display);
    font-size: var(--text-l);
    font-weight: 500;
    letter-spacing: -0.01em;
    margin: 0;
    color: var(--text-color);
  }
  .set-ws__sub {
    font-size: var(--text-xs);
    color: var(--text-faint);
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
    margin-block-start: 2px;
  }
  .set-ws__roles {
    display: flex;
    gap: var(--space-xs);
    flex-wrap: wrap;
    max-inline-size: 280px;
  }
  .set-role {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    padding-block: 2px;
    padding-inline: var(--space-s);
    border: 1px dashed var(--border-color-dark);
    border-radius: 3px;
    letter-spacing: 0.03em;
    white-space: nowrap;
  }
  .set-role.is-mine {
    border-style: solid;
    color: var(--text-color);
    background: var(--bg-light);
  }
  .set-ws__meta {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-faint);
    display: flex;
    gap: var(--space-xs);
    white-space: nowrap;
  }
  .set-ws__meta .sep {
    opacity: 0.5;
  }
  .set-ws__actions {
    display: flex;
    gap: var(--space-xs);
  }

  .set-roles-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
  }
  .set-role-chip {
    appearance: none;
    background: transparent;
    border: 1px solid var(--border-color-dark);
    font: inherit;
    font-size: var(--text-xs);
    color: var(--text-muted);
    padding-block: var(--space-xs);
    padding-inline: var(--space-s) var(--space-s);
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    cursor: pointer;
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
  }
  .set-role-chip__dot {
    inline-size: 7px;
    block-size: 7px;
    border: 1px solid currentColor;
    border-radius: 50%;
    display: inline-block;
  }
  .set-role-chip:hover {
    color: var(--text-color);
  }
  .set-role-chip.is-on {
    background: var(--text-color);
    border-color: var(--text-color);
    color: var(--bg);
  }
  .set-role-chip.is-on .set-role-chip__dot {
    background: currentColor;
  }

  .set-lang-list {
    display: flex;
    flex-direction: column;
  }
  .set-lang {
    display: grid;
    grid-template-columns: 36px minmax(120px, 1fr) auto auto auto;
    gap: var(--space-s);
    align-items: center;
    padding-block: var(--space-s);
    border-block-end: 1px solid var(--border-color-light);
  }
  .set-lang:last-child {
    border-block-end: 0;
  }
  .set-lang__code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-color);
    text-align: center;
    background: var(--bg-light);
    border: 1px solid var(--border-color-dark);
    padding-block: var(--space-xs);
    padding-inline: var(--space-xs);
    border-radius: 3px;
    letter-spacing: 0.04em;
  }
  .set-lang__name {
    font-size: var(--text-m);
    color: var(--text-color);
    font-family: var(--font-display);
    letter-spacing: -0.005em;
  }
  .set-lang__primary {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--success);
    border: 1px solid currentColor;
    padding-block: 2px;
    padding-inline: var(--space-s);
    border-radius: 3px;
  }

  .set-conn-list {
    display: flex;
    flex-direction: column;
  }
  .set-conn {
    display: grid;
    grid-template-columns: 32px minmax(160px, 1fr) minmax(0, 1.6fr) auto;
    gap: var(--space-m);
    align-items: center;
    padding-block: var(--space-m);
    border-block-end: 1px solid var(--border-color-light);
  }
  .set-conn:last-child {
    border-block-end: 0;
  }
  .set-conn[data-status='disconnected'] {
    opacity: 0.7;
  }
  .set-conn__icon {
    inline-size: 32px;
    block-size: 32px;
    border-radius: var(--radius-s);
    background: var(--bg-light);
    border: 1px solid var(--border-color-light);
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-size: var(--text-m);
    color: var(--text-muted);
  }
  .set-conn[data-status='connected'] .set-conn__icon,
  .set-conn[data-status='linked'] .set-conn__icon {
    color: var(--text-color);
    background: var(--bg);
  }
  .set-conn__name {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-inline-size: 0;
  }
  .set-conn__name strong {
    font-weight: 500;
    color: var(--text-color);
    font-size: var(--text-s);
  }
  .set-conn__name span {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-faint);
    letter-spacing: 0.04em;
  }
  .set-conn__detail {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .set-token {
    display: inline-flex;
    align-items: center;
    gap: var(--space-s);
  }
  .set-token code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    background: var(--bg-light);
    border: 1px solid var(--border-color-light);
    padding-block: var(--space-xs);
    padding-inline: var(--space-s);
    border-radius: 3px;
    color: var(--text-muted);
    letter-spacing: 0.04em;
  }

  .set-hours {
    display: inline-flex;
    align-items: center;
    gap: var(--space-s);
  }
  .set-hours .sep {
    color: var(--text-faint);
    font-family: var(--font-mono);
  }
  .set-codeline {
    font-family: var(--font-mono);
    font-size: 0.95em;
    background: var(--bg-light);
    padding-block: 1px;
    padding-inline: var(--space-xs);
    border-radius: 3px;
  }

  .set-plan {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-m);
    padding: var(--space-m);
    border: 1px solid var(--border-color-light);
    border-radius: var(--radius);
    background: var(--bg-light);
  }
  .set-plan__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }
  .set-plan__kicker {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .set-plan__name {
    font-family: var(--font-display);
    font-size: 1.8rem;
    font-weight: 400;
    letter-spacing: -0.02em;
    margin: 0;
    color: var(--text-color);
  }
  .set-plan__name em {
    font-style: italic;
    color: var(--text-muted);
  }
  .set-plan__name span {
    font-size: 1.3rem;
    color: var(--text-muted);
  }
  .set-plan__sub {
    font-size: var(--text-s);
    color: var(--text-muted);
    margin: var(--space-xs) 0 0;
    line-height: 1.55;
  }
  .set-plan__actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    align-items: flex-end;
  }
  .set-plan__actions button {
    white-space: nowrap;
  }

  .set-card {
    display: inline-flex;
    align-items: center;
    gap: var(--space-s);
    font-size: var(--text-s);
    color: var(--text-color);
  }
  .set-card__brand {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.1em;
    background: var(--text-color);
    color: var(--bg);
    padding-block: 3px;
    padding-inline: var(--space-s);
    border-radius: 3px;
  }

  .set-invoices {
    display: flex;
    flex-direction: column;
  }
  .set-invoice {
    display: grid;
    grid-template-columns: 100px 1fr auto auto auto;
    gap: var(--space-m);
    align-items: center;
    padding-block: var(--space-s);
    border-block-end: 1px solid var(--border-color-light);
    font-size: var(--text-s);
  }
  .set-invoice:last-child {
    border-block-end: 0;
  }
  .set-invoice__date {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    letter-spacing: 0.04em;
  }
  .set-invoice__plan {
    color: var(--text-color);
  }
  .set-invoice__amt {
    font-family: var(--font-mono);
    color: var(--text-color);
    font-weight: 500;
  }
  .set-invoice__status {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--success);
    border: 1px solid currentColor;
    padding-block: 2px;
    padding-inline: var(--space-s);
    border-radius: 3px;
  }
</style>
