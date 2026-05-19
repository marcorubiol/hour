<script lang="ts">
  /**
   * Today — editorial dashboard (ADR-033, design system v0.5).
   *
   * Masthead → stats → "Everything on your plate" week table → "What's alive
   * right now" project rows.
   *
   * Data sources (Phase 0, mocked):
   * - Workspaces: TanStack ['workspaces'] (cached by Plaza).
   * - Active projects: TanStack ['projects', { status: 'active' }] (cached by Plaza).
   * - Engagements: TanStack ['engagements', workspace] — scoped to URL
   *   workspace. Cross-workspace aggregation deferred to Phase 0.2 (the
   *   endpoint requires project_slug today).
   *
   * Where data isn't derivable from the current schema (shows by status),
   * placeholders ("—") are honest about it instead of fabricating.
   */

  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import { accentVar, accentVarFor } from '$lib/utils/accent';
  import { decodeJwtClaim } from '$lib/realtime';
  import Pill from '$lib/components/Pill.svelte';
  import TagChip from '$lib/components/TagChip.svelte';

  type Workspace = {
    id: string;
    slug: string;
    name: string;
    kind: 'personal' | 'team';
    accent?: string | null;
    description?: string | null;
  };

  type Project = {
    id: string;
    slug: string;
    name: string;
    workspace_id: string;
    status: 'draft' | 'active' | 'archived';
  };

  type EngagementStatus =
    | 'contacted'
    | 'in_conversation'
    | 'hold'
    | 'confirmed'
    | 'declined'
    | 'dormant'
    | 'recurring';

  type Engagement = {
    id: string;
    status: EngagementStatus;
    role: string | null;
    next_action_at: string | null;
    next_action_note: string | null;
    updated_at: string;
    custom_fields: Record<string, unknown> | null;
    person: {
      full_name: string | null;
      organization_name: string | null;
    } | null;
    project: {
      id: string;
      slug: string;
      name: string;
    } | null;
  };

  let workspaceSlug = $derived(page.params.workspace ?? '');

  function clearAuthAndBounce() {
    localStorage.removeItem('hour_jwt');
    localStorage.removeItem('hour_refresh');
    localStorage.removeItem('hour_expires_at');
    goto('/login', { replaceState: true });
  }

  async function fetchJSON<T>(url: string, signal: AbortSignal): Promise<T> {
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) {
      clearAuthAndBounce();
      throw new Error('Missing JWT');
    }
    const res = await fetch(url, {
      signal,
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (res.status === 401) {
      clearAuthAndBounce();
      throw new Error('Unauthorized');
    }
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return (await res.json()) as T;
  }

  const workspacesQuery = createQuery({
    queryKey: ['workspaces'],
    queryFn: ({ signal }) => fetchJSON<{ items: Workspace[] }>('/api/workspaces', signal),
  });

  const projectsQuery = createQuery({
    queryKey: ['projects', { status: 'active' }],
    queryFn: ({ signal }) =>
      fetchJSON<{ items: Project[] }>('/api/projects?status=active', signal),
  });

  // Engagements scoped to the URL workspace's first active project (Phase 0
  // convention: 1 project per workspace). When a workspace has 0 projects
  // the query stays disabled and the week renders empty.
  let firstProjectSlug = $derived.by(() => {
    const ws = $workspacesQuery.data?.items.find((h) => h.slug === workspaceSlug);
    if (!ws) return null;
    const r = $projectsQuery.data?.items.find((r) => r.workspace_id === ws.id);
    return r?.slug ?? null;
  });

  const engagementsQuery = createQuery({
    get queryKey() {
      return ['engagements', firstProjectSlug ?? ''];
    },
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ total: number; items: Engagement[] }>(
        `/api/engagements?project_slug=${encodeURIComponent(firstProjectSlug ?? '')}&status=any&limit=100`,
        signal,
      ),
    get enabled() {
      return !!firstProjectSlug;
    },
  });

  let engagements = $derived($engagementsQuery.data?.items ?? []);
  let totalEngagements = $derived($engagementsQuery.data?.total ?? 0);

  // ──────────────────────────────────────────────────────────────────────
  // Masthead derivations

  let now = $derived(new Date());

  let dateLabel = $derived(
    now
      .toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
      .toUpperCase(),
  );

  // Greeting takes the user's first name from the JWT (user_metadata.full_name
  // set at signup; otherwise the email's local part with separators). Falls
  // back to the personal workspace name. Workspace name is the wrong source
  // — Marco isn't "mamemi" when he's looking at the mamemi workspace.

  function titleCase(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  let jwtName = $state<string | null>(null);

  $effect(() => {
    if (typeof window === 'undefined') return;
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) return;
    const full =
      decodeJwtClaim(jwt, 'user_metadata.full_name') ||
      decodeJwtClaim(jwt, 'user_metadata.name');
    if (full) {
      jwtName = full.split(/\s+/)[0] ?? full;
      return;
    }
    const email = decodeJwtClaim(jwt, 'email');
    if (email) {
      const local = email.split('@')[0] ?? '';
      const first = local.split(/[._-]+/)[0];
      if (first && first.length < local.length) {
        // Email had separators — first segment is a real name.
        jwtName = titleCase(first);
      }
    }
  });

  // Final greeting name: JWT user_metadata > JWT email split > the personal
  // workspace's display name (always reads cleanly even if signup metadata
  // is missing).
  let firstName = $derived.by(() => {
    if (jwtName) return jwtName;
    const personal = $workspacesQuery.data?.items.find((h) => h.kind === 'personal');
    if (personal) {
      return personal.name.split(/\s+/)[0] ?? personal.name;
    }
    return 'there';
  });

  let activeProjectsCount = $derived(
    ($projectsQuery.data?.items ?? []).filter((r) => r.status === 'active').length,
  );

  let thisWeekCount = $derived.by(() => {
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const limit = now.getTime() + sevenDays;
    return engagements.filter((e) => {
      if (!e.next_action_at) return false;
      const t = new Date(e.next_action_at).getTime();
      return t >= now.getTime() && t <= limit;
    }).length;
  });

  // ──────────────────────────────────────────────────────────────────────
  // Week table derivation

  type WeekRow = {
    id: string;
    kind: string;
    verb: string;
    subject: string;
    tags: { label: string; tone: 'amber' | 'blue' | 'teal' | 'green' | 'purple' | 'red' | 'neutral' }[];
    projectName: string;
    projectSlug: string;
    daySortKey: number;
    dayLabel: string;
  };

  const VERBS: Record<EngagementStatus, { upcoming: string; overdue: string }> = {
    contacted: { upcoming: 'Follow up', overdue: 'Chase' },
    in_conversation: { upcoming: 'Reply', overdue: 'Reply' },
    hold: { upcoming: 'Confirm', overdue: 'Confirm' },
    confirmed: { upcoming: 'Prep', overdue: 'Prep' },
    declined: { upcoming: 'Note', overdue: 'Note' },
    dormant: { upcoming: 'Revive', overdue: 'Revive' },
    recurring: { upcoming: 'Check', overdue: 'Check' },
  };

  const TAG_TONES: WeekRow['tags'][number]['tone'][] = [
    'teal',
    'blue',
    'green',
    'purple',
    'amber',
    'red',
    'neutral',
  ];

  function toneForTag(tag: string): WeekRow['tags'][number]['tone'] {
    let h = 0;
    for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
    return TAG_TONES[h % TAG_TONES.length];
  }

  function dayBucket(d: Date | null): { sortKey: number; label: string } {
    if (!d) return { sortKey: 1_000_000, label: 'WHENEVER' };
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const diffMs = d.getTime() - start.getTime();
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    if (diffDays < 0) return { sortKey: -1, label: 'OVERDUE' };
    if (diffDays === 0) return { sortKey: 0, label: 'TODAY' };
    if (diffDays === 1) return { sortKey: 1, label: 'TOMORROW' };
    if (diffDays < 7) {
      return {
        sortKey: diffDays,
        label: d
          .toLocaleDateString('en-US', { weekday: 'short' })
          .toUpperCase(),
      };
    }
    if (diffDays < 14) return { sortKey: 7, label: 'NEXT WEEK' };
    return { sortKey: 99, label: 'LATER' };
  }

  let weekRows = $derived.by<WeekRow[]>(() => {
    return engagements
      .filter((e) => e.status !== 'declined' && e.status !== 'dormant')
      .map((e) => {
        const date = e.next_action_at ? new Date(e.next_action_at) : null;
        const bucket = dayBucket(date);
        const isOverdue = bucket.sortKey === -1;
        const verb = VERBS[e.status]?.[isOverdue ? 'overdue' : 'upcoming'] ?? 'Look at';
        const tagsRaw = Array.isArray(e.custom_fields?.tags)
          ? (e.custom_fields?.tags as unknown[]).filter(
              (t): t is string => typeof t === 'string',
            )
          : [];
        const tags = tagsRaw.slice(0, 2).map((label) => ({
          label: label.startsWith('#') ? label : `#${label}`,
          tone: toneForTag(label),
        }));
        const subject =
          e.person?.full_name ||
          e.person?.organization_name ||
          e.next_action_note ||
          'Untitled';
        return {
          id: e.id,
          kind: 'task',
          verb,
          subject,
          tags,
          projectName: e.project?.name ?? '—',
          projectSlug: e.project?.slug ?? '',
          daySortKey: bucket.sortKey,
          dayLabel: bucket.label,
        };
      })
      .sort((a, b) => a.daySortKey - b.daySortKey)
      .slice(0, 12);
  });

  let groupedWeek = $derived.by(() => {
    const groups: { day: string; rows: WeekRow[] }[] = [];
    let current: { day: string; rows: WeekRow[] } | null = null;
    for (const row of weekRows) {
      if (!current || current.day !== row.dayLabel) {
        current = { day: row.dayLabel, rows: [] };
        groups.push(current);
      }
      current.rows.push(row);
    }
    return groups;
  });

  // ──────────────────────────────────────────────────────────────────────
  // Project rows derivation

  type ProjectRow = {
    workspace: Workspace;
    sub: string;
    activeProjects: number;
    engagementCount: number;
  };

  let projectRows = $derived.by<ProjectRow[]>(() => {
    const workspaces = $workspacesQuery.data?.items ?? [];
    const projects = $projectsQuery.data?.items ?? [];
    return workspaces.map((ws) => ({
      workspace: ws,
      sub:
        ws.kind === 'personal'
          ? 'Personal workspace'
          : 'Team workspace',
      activeProjects: projects.filter((p) => p.workspace_id === ws.id && p.status === 'active').length,
      engagementCount: ws.slug === workspaceSlug ? totalEngagements : 0,
    }));
  });

  // ──────────────────────────────────────────────────────────────────────
  // Filters (visual only in Phase 0; localStorage hookup in Phase 0.2)

  type RoleFilter = 'all' | 'sound' | 'production' | 'lighting' | 'distribution' | 'author' | 'musician';
  type TagFilter =
    | 'all'
    | '#production'
    | '#logistics'
    | '#travel'
    | '#creative'
    | '#billable'
    | '#admin'
    | '#contract'
    | '#press'
    | '#show';

  let roleFilter = $state<RoleFilter>('all');
  let tagFilter = $state<TagFilter>('all');

  const ROLES: RoleFilter[] = [
    'all',
    'sound',
    'production',
    'lighting',
    'distribution',
    'author',
    'musician',
  ];
  const TAGS: TagFilter[] = [
    'all',
    '#production',
    '#logistics',
    '#travel',
    '#creative',
    '#billable',
    '#admin',
    '#contract',
    '#press',
    '#show',
  ];
</script>

<svelte:head>
  <title>Today — Hour</title>
</svelte:head>

<section class="today">
  <header class="today__masthead">
    <p class="eyebrow">{dateLabel}</p>
    <h1 class="today__greeting">
      Hello, <em>{firstName}</em>.
    </h1>
    <div class="today__stats">
      <span><b>{activeProjectsCount}</b> active projects</span>
      <span><b>—</b> shows total</span>
      <span><b>—</b> confirmed</span>
      <span><b>—</b> on hold</span>
      <span><b>{thisWeekCount}</b> this week</span>
    </div>
  </header>

  <section class="today__plate">
    <header class="today__section-head">
      <div>
        <p class="eyebrow">This week</p>
        <h2 class="today__section-title">Everything on your plate</h2>
      </div>
      <a class="today__section-link" href={`/h/${workspaceSlug}/calendar`}>
        Open calendar →
      </a>
    </header>

    <div class="today__filters">
      <div class="today__filter-row">
        <span class="eyebrow today__filter-label">Role</span>
        {#each ROLES as role (role)}
          <Pill
            size="sm"
            active={roleFilter === role}
            onclick={() => (roleFilter = role)}
          >
            {role}
          </Pill>
        {/each}
      </div>
      <div class="today__filter-row">
        <span class="eyebrow today__filter-label">Tag</span>
        {#each TAGS as tag (tag)}
          <Pill
            size="sm"
            active={tagFilter === tag}
            onclick={() => (tagFilter = tag)}
          >
            {tag}
          </Pill>
        {/each}
      </div>
    </div>

    {#if $engagementsQuery.isPending && firstProjectSlug}
      <p class="today__placeholder">Loading…</p>
    {:else if $engagementsQuery.isError}
      <p class="today__placeholder today__placeholder--err">
        Couldn't load your week.
      </p>
    {:else if !firstProjectSlug}
      <p class="today__placeholder">
        This workspace has no active projects yet.
      </p>
    {:else if groupedWeek.length === 0}
      <p class="today__placeholder">Nothing scheduled for the week.</p>
    {:else}
      <div class="week">
        {#each groupedWeek as group (group.day)}
          <div class="week__day-label">{group.day}</div>
          <div class="week__rows">
            {#each group.rows as row (row.id)}
              <div class="week__item">
                <span class="week__kind">{row.kind}</span>
                <span class="week__verb">{row.verb}</span>
                <span class="week__subject">{row.subject}</span>
                <span class="week__tags">
                  {#each row.tags as tag (tag.label)}
                    <TagChip label={tag.label} tone={tag.tone} />
                  {/each}
                </span>
                <span
                  class="week__project"
                  style={`--c: ${accentVar(row.projectSlug)}`}
                >
                  <span class="week__project-dot" aria-hidden="true"></span>
                  <span>{row.projectName}</span>
                </span>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section class="today__alive">
    <header class="today__section-head">
      <div>
        <p class="eyebrow">Projects</p>
        <h2 class="today__section-title">What's alive right now</h2>
      </div>
    </header>

    {#if $workspacesQuery.isPending}
      <p class="today__placeholder">Loading…</p>
    {:else}
      <ul class="alive" role="list">
        {#each projectRows as row (row.workspace.id)}
          <li class="alive__row" style={`--c: ${accentVarFor(row.workspace)}`}>
            <span class="alive__rail" aria-hidden="true"></span>
            <div class="alive__body">
              <a
                class="alive__name"
                href={`/h/${row.workspace.slug}/`}
              >
                {row.workspace.name}
              </a>
              <p class="alive__sub">
                {row.sub} · {row.activeProjects} {row.activeProjects === 1 ? 'project' : 'projects'}
              </p>
            </div>
            <div class="alive__metrics">
              <div class="alive__metric">
                <span class="alive__metric-v">{row.engagementCount || '—'}</span>
                <span class="alive__metric-l">Engagements</span>
              </div>
              <div class="alive__metric">
                <span class="alive__metric-v">—</span>
                <span class="alive__metric-l">Confirmed</span>
              </div>
              <div class="alive__metric">
                <span class="alive__metric-v">—</span>
                <span class="alive__metric-l">On hold</span>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</section>

<style>
  @layer components {
    .today {
      display: flex;
      flex-direction: column;
      gap: var(--space-xl);
      max-inline-size: 72rem;
      margin-inline: auto;
    }

    /* ────────────────────────────── Masthead ─────────────────────────── */

    .today__masthead {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding-block-end: var(--space-xl);
      border-block-end: 1px solid var(--border-color-dark);
    }

    .today__greeting {
      font-family: var(--font-display);
      font-size: clamp(2rem, 1.4rem + 3vw, 3rem);
      font-weight: 400;
      letter-spacing: -0.025em;
      line-height: 1;
      margin: 0;
      color: var(--text-color);
    }

    .today__greeting em {
      font-style: italic;
      color: var(--text-muted);
    }

    .today__stats {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-l);
      margin-block-start: var(--space-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
      letter-spacing: 0.02em;
    }

    .today__stats b {
      color: var(--text-color);
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      margin-inline-end: var(--space-xs);
    }

    /* ──────────────────────────── Section heads ──────────────────────── */

    .today__section-head {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--space-m);
      margin-block-end: var(--space-m);
    }

    .today__section-title {
      font-family: var(--font-display);
      font-size: var(--text-xxl);
      font-weight: 400;
      letter-spacing: -0.02em;
      line-height: 1.1;
      margin: 0;
      color: var(--text-color);
    }

    .today__section-link {
      font-size: var(--text-s);
      color: var(--text-muted);
      text-decoration: none;
      transition: color var(--transition);
    }

    .today__section-link:hover {
      color: var(--text-color);
    }

    /* ───────────────────────────── Filters ───────────────────────────── */

    .today__filters {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      margin-block-end: var(--space-m);
    }

    .today__filter-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-xs);
    }

    .today__filter-label {
      min-inline-size: 32px;
      margin: 0;
    }

    /* ────────────────────────────── Week ─────────────────────────────── */

    .today__placeholder {
      padding-block: var(--space-l);
      text-align: center;
      color: var(--text-faint);
      font-size: var(--text-s);
    }

    .today__placeholder--err {
      color: var(--danger);
    }

    .week {
      display: grid;
      grid-template-columns: 90px 1fr;
      gap: var(--space-s) var(--space-m);
      align-items: baseline;
    }

    .week__day-label {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.1em;
      color: var(--text-faint);
      padding-block-start: var(--space-xs);
    }

    .week__rows {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .week__item {
      display: grid;
      grid-template-columns: 68px 80px minmax(0, 1fr) auto auto;
      gap: var(--space-s);
      align-items: baseline;
      padding-block: var(--space-xs);
      padding-inline: var(--space-s);
      border-radius: var(--radius-s);
      font-size: var(--text-s);
      transition: background var(--transition);
    }

    .week__item:hover {
      background: var(--bg-hover);
    }

    .week__kind {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-faint);
    }

    .week__verb {
      font-weight: 500;
      color: var(--text-color);
    }

    .week__subject {
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .week__tags {
      display: inline-flex;
      gap: var(--space-xs);
    }

    .week__project {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      font-size: var(--text-xs);
      color: var(--text-faint);
      font-variant: small-caps;
      letter-spacing: 0.04em;
    }

    .week__project-dot {
      inline-size: 6px;
      block-size: 6px;
      border-radius: 50%;
      background: var(--c, var(--text-faint));
    }

    /* ────────────────────────── What's alive ─────────────────────────── */

    .alive {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
    }

    .alive__row {
      display: grid;
      grid-template-columns: 14px 1fr auto;
      gap: var(--space-m);
      align-items: center;
      padding-block: var(--space-m);
      border-block-end: 1px solid var(--border-color-light);
    }

    .alive__row:last-child {
      border-block-end: 0;
    }

    .alive__rail {
      inline-size: 4px;
      block-size: 36px;
      background: var(--c, var(--text-faint));
      border-radius: 2px;
    }

    .alive__body {
      min-inline-size: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .alive__name {
      font-family: var(--font-display);
      font-size: var(--text-l);
      font-weight: 500;
      letter-spacing: -0.015em;
      color: var(--text-color);
      text-decoration: none;
    }

    .alive__name:hover {
      color: var(--text-muted);
    }

    .alive__sub {
      font-size: var(--text-xs);
      color: var(--text-faint);
      margin: 0;
    }

    .alive__metrics {
      display: grid;
      grid-auto-flow: column;
      gap: var(--space-m);
      align-items: baseline;
      padding-inline-start: var(--space-m);
      border-inline-start: 1px solid var(--border-color-light);
    }

    .alive__metric {
      display: flex;
      flex-direction: column;
      align-items: center;
      min-inline-size: 48px;
    }

    .alive__metric-v {
      font-family: var(--font-display);
      font-size: var(--text-l);
      font-weight: 500;
      line-height: 1;
      color: var(--text-color);
      font-variant-numeric: tabular-nums;
    }

    .alive__metric-l {
      font-family: var(--font-mono);
      font-size: 0.5625rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-faint);
      margin-block-start: var(--space-xs);
    }

    @media (max-width: 47.999rem) {
      .week {
        grid-template-columns: 60px 1fr;
      }
      .week__item {
        grid-template-columns: 60px minmax(0, 1fr);
        gap: var(--space-xs);
      }
      .week__verb,
      .week__subject,
      .week__tags,
      .week__project {
        grid-column: 2;
      }
      .alive__metrics {
        display: none;
      }
    }
  }
</style>
