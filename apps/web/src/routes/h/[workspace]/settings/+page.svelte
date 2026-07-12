<script lang="ts">
  /**
   * Settings — lives inside the workspace shell. The sidebar swaps
   * Plaza+LineList for <SettingsNav /> while the user is here (handled
   * by /h/+layout.svelte detecting the route). This page only renders
   * the active section panel in the main column.
   *
   * Active section is driven by the `?section=` query param so the URL
   * is shareable and the sidebar nav stays in sync.
   *
   * Phase 0 reality: only Profile (full name, email) and Notifications →
   * Master View are wired. Workspaces/privacy/languages/notifications/
   * billing/danger are kept as scaffolding for the cases the roadmap
   * will actually need; the rest was pruned (vapor).
   */

  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { accentVar } from '$lib/utils/accent';
  import { decodeJwtClaim } from '$lib/realtime';
  import { type SectionId } from '$lib/components/SettingsNav.svelte';
  import {
    isMasterViewEnabled,
    getMasterViewPath,
    setMasterViewEnabled,
    clearMasterViewPath,
  } from '$lib/master-view';

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let active = $derived<SectionId>(
    (page.url.searchParams.get('section') as SectionId | null) ?? 'profile',
  );

  // ─── identity from JWT ────────────────────────────────────────────────
  let userEmail = $state('');
  let userName = $state('Marco Rubiol');

  onMount(() => {
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) return;
    const email = decodeJwtClaim(jwt, 'email');
    if (email) userEmail = email;
    const full =
      decodeJwtClaim(jwt, 'user_metadata.full_name') ||
      decodeJwtClaim(jwt, 'user_metadata.name');
    if (full) userName = full;
  });

  let initials = $derived(
    userName
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || 'MR',
  );

  // ─── workspaces & projects ────────────────────────────────────────────
  type Workspace = {
    id: string;
    slug: string;
    name: string;
    kind: 'personal' | 'team';
  };
  type Project = {
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

  const workspacesQuery = createQuery({
    queryKey: ['workspaces'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: Workspace[] }>('/api/workspaces', signal),
  });

  const projectsQuery = createQuery({
    queryKey: ['projects', { status: 'active' }],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: Project[] }>('/api/projects?status=active', signal),
  });

  let workspaces = $derived($workspacesQuery.data?.items ?? []);
  let projects = $derived($projectsQuery.data?.items ?? []);

  // ─── privacy state ────────────────────────────────────────────────────
  let privTasksDefault = $state<'shared' | 'private'>('shared');
  let privMoneyVis = $state<'me-only' | 'project' | 'all'>('me-only');
  let privNotesPrivate = $state(true);
  let privDistribution = $state<'me-only' | 'distributors' | 'all'>('me-only');

  // ─── languages state ──────────────────────────────────────────────────
  // Working languages (which langs the user speaks) deferred: it's Person
  // metadata, not an app setting. Only the app-interface language remains.
  let appLanguage = $state<'ca' | 'es' | 'en' | 'fr'>('en');

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

<article class="set-page">
  {#if active === 'profile'}
    <header class="set-mast">
      <p class="eyebrow set-mast__kicker">Account</p>
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
            <div class="set-row__hint">A monogram for now. Drop an image later.</div>
          </div>
          <div class="set-row__ctrl">
            <div class="set-avatar-pick">
              <span
                class="set-avatar-pick__big"
                style={`background: ${accentVar(workspaceSlug)}`}
              >
                {initials}
              </span>
              <button type="button" class="btn--primary btn--s">Upload image</button>
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
            <input type="text" bind:value={userName} />
          </div>
        </div>

        <div class="set-row">
          <div class="set-row__lead">
            <div class="set-row__label">Email</div>
            <div class="set-row__hint">Sign-in and project invitations.</div>
          </div>
          <div class="set-row__ctrl">
            <input type="email" bind:value={userEmail} readonly />
          </div>
        </div>
      </div>
    </section>

    <!-- LOCATION & TIMEZONE group killed: timezone derives from
         browser automatically, week-starts-on default to Monday is
         fine for Phase 0, location adds nothing operational.
         Pronouns and Display name killed too (Phase 0 reality:
         solo Marco; pronouns opens a debate we don't need to host). -->
  {/if}

      {#if active === 'workspaces'}
        <header class="set-mast">
          <p class="eyebrow set-mast__kicker">Roster</p>
          <h1 class="set-mast__title"><em>Workspaces &amp; roles</em></h1>
          <p class="set-mast__sub">
            Each project is its own workspace. Your role decides what you see —
            and what your collaborators see of you.
          </p>
        </header>

        <section class="set-group">
          <div class="set-group__head">
            <span class="eyebrow set-group__kicker">{workspaces.length} active</span>
            <h2 class="set-group__title">My projects</h2>
          </div>
          <div class="set-group__body">
            <div class="set-ws-list">
              {#each workspaces as w (w.id)}
                {@const projectCount = projects.filter((p) => p.workspace_id === w.id).length}
                {@const myRoles =
                  w.kind === 'personal'
                    ? ['author', 'performer']
                    : ['musician', 'lighting', 'distribution']}
                <div class="set-ws" style={`--c: ${accentVar(w.slug)}`}>
                  <div class="set-ws__rail"></div>
                  <div class="set-ws__name">
                    <h3>{w.name}</h3>
                    <div class="set-ws__sub">
                      {w.kind === 'personal' ? 'Personal workspace' : 'Team workspace'}
                    </div>
                  </div>
                  <div class="set-ws__roles">
                    {#each myRoles as role (role)}
                      <span class="role-badge is-mine">{role}</span>
                    {/each}
                  </div>
                  <div class="set-ws__meta">
                    <span>— people</span>
                    <span class="sep">·</span>
                    <span>{projectCount} {projectCount === 1 ? 'project' : 'projects'}</span>
                  </div>
                  <div class="set-ws__actions">
                    <button type="button" class="btn--outline btn--s">Edit role</button>
                    <button type="button" class="btn--outline btn--s is-warn">Leave</button>
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
            <span class="eyebrow set-group__kicker">By role</span>
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
                  class={['pill--sm', 'pill--mono', 'set-role-chip', activeRoles.has(role) && 'pill--on']
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
          <p class="eyebrow set-mast__kicker">Boundaries</p>
          <h1 class="set-mast__title"><em>Visibility &amp; privacy</em></h1>
          <p class="set-mast__sub">
            Across your collectives, some things are shared and some are yours
            alone. Defaults here apply to every new project.
          </p>
        </header>

        <section class="set-group">
          <div class="set-group__head">
            <span class="eyebrow set-group__kicker">Defaults</span>
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
          <p class="eyebrow set-mast__kicker">Materials</p>
          <h1 class="set-mast__title"><em>Languages</em></h1>
          <p class="set-mast__sub">
            Press kits, dossiers, riders — Hour produces each in the languages
            you work in.
          </p>
        </header>

        <!-- "Working languages" list killed: it's metadata of the Person
             entity (which languages Marco speaks), not an app setting.
             Belongs on the Person profile when that page exists. -->

        <section class="set-group">
          <div class="set-group__head">
            <span class="eyebrow set-group__kicker">Interface</span>
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

      <!-- "Connections" section killed: 7 providers (Fastmail, Holded,
           Spotify, Bandcamp, Drive, Bank...) ZERO actually wired —
           vapor visual. Resurrects when an integration ships. Same
           goes for Personal API token (Phase 1 public API). -->

      {#if active === 'notifications'}
        <header class="set-mast">
          <p class="eyebrow set-mast__kicker">Quiet by default</p>
          <h1 class="set-mast__title"><em>Notifications</em></h1>
          <p class="set-mast__sub">
            Hour only nudges you when something genuinely changed. You decide
            where.
          </p>
        </header>

        <section class="set-group">
          <div class="set-group__head">
            <span class="eyebrow set-group__kicker">Digest</span>
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
            <span class="eyebrow set-group__kicker">Priority alerts</span>
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
            <span class="eyebrow set-group__kicker">Channels</span>
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
                  <input class="input--tight" type="text" bind:value={quietStart} />
                  <span class="sep">→</span>
                  <input class="input--tight" type="text" bind:value={quietEnd} />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="set-group">
          <div class="set-group__head">
            <span class="eyebrow set-group__kicker">Browser memory</span>
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
                    class="btn--outline btn--s"
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
          <p class="eyebrow set-mast__kicker">Money</p>
          <h1 class="set-mast__title"><em>Billing</em></h1>
          <p class="set-mast__sub">
            Hour is a small Barcelona-based tool. Your money goes a long way here.
          </p>
        </header>

        <section class="set-group">
          <div class="set-group__body">
            <div class="set-plan">
              <div class="set-plan__head">
                <span class="eyebrow set-plan__kicker">Current plan</span>
                <h2 class="set-plan__name">
                  Solo <em>·</em> <span>€9/mo</span>
                </h2>
                <p class="set-plan__sub">
                  All features, unlimited projects, one person. Next billing 1
                  May 2026.
                </p>
              </div>
              <div class="set-plan__actions">
                <button type="button" class="btn--primary btn--s">
                  Switch to yearly · save 20%
                </button>
                <button type="button" class="btn--outline btn--s">
                  Upgrade to Collective (€19/mo, up to 6 people)
                </button>
                <button type="button" class="btn--outline btn--s is-warn">Cancel plan</button>
              </div>
            </div>
          </div>
        </section>

        <section class="set-group">
          <div class="set-group__head">
            <span class="eyebrow set-group__kicker">Payment</span>
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
                  <button type="button" class="btn--outline btn--s">Update</button>
                </div>
              </div>
            </div>
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Billing email</div>
                <div class="set-row__hint">Receipts and VAT documents.</div>
              </div>
              <div class="set-row__ctrl">
                <input  type="email" value={userEmail} readonly />
              </div>
            </div>
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">Tax ID</div>
                <div class="set-row__hint">ES NIF / EU VAT — for proper invoices.</div>
              </div>
              <div class="set-row__ctrl">
                <input class="input--short" type="text" value="ES 41XXXXXXX-A" />
              </div>
            </div>
          </div>
        </section>

        <section class="set-group">
          <div class="set-group__head">
            <span class="eyebrow set-group__kicker">History</span>
          </div>
          <div class="set-group__body">
            <div class="set-invoices">
              {#each ['2026-04-01', '2026-03-01', '2026-02-01', '2026-01-01'] as d (d)}
                <div class="set-invoice">
                  <span class="set-invoice__date">{d}</span>
                  <span class="set-invoice__plan">Solo · monthly</span>
                  <span class="set-invoice__amt">€9.00</span>
                  <span class="set-invoice__status">paid</span>
                  <button type="button" class="btn--outline btn--s">PDF</button>
                </div>
              {/each}
            </div>
          </div>
        </section>
      {/if}

      {#if active === 'danger'}
        <header class="set-mast">
          <p class="eyebrow set-mast__kicker">Last resort</p>
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
                <button type="button" class="btn--outline btn--s">Request export</button>
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
                <button type="button" class="btn--outline btn--s is-warn">Leave all…</button>
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
                <button type="button" class="btn--danger btn--s">
                  Delete my Hour…
                </button>
              </div>
            </div>
          </div>
        </section>
  {/if}
</article>

<style>
  /* The page is rendered inside .workspace-shell__content (which already
     paints background + outer padding). We just need a centred article
     with a sensible reading measure and an avatar-pick row composer. */
  .set-page {
    --set-pad: clamp(16px, 1.6vw, 24px);

    max-inline-size: var(--page-width-wide);
    margin-inline: auto;
    color: var(--text-color);
    font-family: var(--font-sans);
  }

  .set-avatar-pick {
    display: inline-flex;
    align-items: center;
    gap: var(--space-m);
    flex-wrap: wrap;
  }
  .set-avatar-pick__big {
    inline-size: 56px;
    block-size: 56px;
    border-radius: 50%;
    color: var(--bg);
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-size: var(--text-l);
    font-weight: 600;
    flex: none;
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
  }
  /* Masthead typography via base.css h1 defaults. */
  .set-mast__title {
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
  /* Kicker typography via base.css .eyebrow. */

  .set-group__title {
    font-family: var(--font-display);
    font-size: var(--h3);
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
    box-shadow: var(--box-shadow-1);
  }

  .set-toggle {
    appearance: none;
    border: 0;
    background: var(--border-color-dark);
    inline-size: 36px;
    block-size: 20px;
    border-radius: var(--radius-circle);
    padding: 2px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    transition: background var(--transition);
  }
  .set-toggle__dot {
    inline-size: 16px;
    block-size: 16px;
    border-radius: 50%;
    background: var(--bg-ultra-light);
    box-shadow: var(--box-shadow-1);
    transition: transform var(--transition);
  }
  .set-toggle.is-on {
    background: var(--text-color);
  }
  .set-toggle.is-on .set-toggle__dot {
    transform: translateX(16px);
  }

  /* Pseudo-button "+ Add a thing" — dashed outline placeholder for
     creation affordances. Specific enough to keep local. */
  .set-add {
    appearance: none;
    align-self: flex-start;
    padding-block: var(--space-s);
    padding-inline: var(--space-m);
    border: 1px dashed var(--border-color-dark);
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    cursor: pointer;
    margin-block-start: var(--space-s);
    transition: color var(--transition), border-color var(--transition);
  }
  .set-add:hover {
    color: var(--text-color);
    border-color: var(--text-muted);
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
  /* Role badges via base.css .role-badge (+ .is-mine). */
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
  /* Pill skeleton (base.css) carries the chip; only the dot is local. */
  .set-role-chip {
    --pill-gap: var(--space-xs);
  }
  .set-role-chip__dot {
    inline-size: 7px;
    block-size: 7px;
    border: 1px solid currentColor;
    border-radius: 50%;
    display: inline-block;
  }
  :global(.set-role-chip.pill--on) .set-role-chip__dot {
    background: currentColor;
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
    border-radius: var(--radius-s);
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
  /* Kicker typography via base.css .eyebrow. */

  .set-plan__name {
    font-family: var(--font-display);
    font-size: var(--text-xxl);
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
    font-size: var(--text-xl);
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
    border-radius: var(--radius-s);
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
    border-radius: var(--radius-s);
  }
</style>
