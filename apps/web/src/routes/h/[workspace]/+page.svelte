<script lang="ts">
  /**
   * Agenda — the Home (ADR-055 nav redesign). The logo lands here; there is
   * no "Today"/"Home" pill (that would just repeat the logo). A single quiet
   * column: greeting, this-week agenda (what's due), and whatever the user
   * has PINNED brought forward. Calendar and Money are the other two views of
   * the same pinned scope, switched from the shell segment.
   *
   * Scope: empty pins = everything the user can see; a pinned space scopes to
   * its workspace; a pinned line scopes to its project (engagements carry no
   * line_id yet — line scope resolves through the line's project).
   */

  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { fetchJSON } from '$lib/api';
  import { accentVar, accentVarFor } from '$lib/utils/accent';
  import { lineKindGlyph, lineKindLabel } from '$lib/utils/line-kind';
  import { decodeJwtClaim } from '$lib/realtime';
  import { usePins, spacePin } from '$lib/stores/pins.svelte';
  import {
    buildLineIndex,
    resolveScope,
    lineUrl,
    type NavLine,
    type NavWorkspace,
    type RawLine,
  } from '$lib/nav';
  import { workspacesQueryOptions, allLinesQueryOptions } from '$lib/nav-queries';
  import ScopeStrip from '$lib/components/ScopeStrip.svelte';
  import TagChip from '$lib/components/TagChip.svelte';
  import { goto } from '$app/navigation';

  const pins = usePins();
  let workspaceSlug = $derived(page.params.workspace ?? '');

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
    next_action_at: string | null;
    next_action_note: string | null;
    updated_at: string;
    workspace_id: string;
    custom_fields: Record<string, unknown> | null;
    person: { full_name: string | null; organization_name: string | null; slug: string | null } | null;
    project: { id: string; slug: string; name: string } | null;
  };
  type Performance = {
    id: string;
    status: string;
    performed_at: string | null;
    line_id: string | null;
    fee_amount: number | null;
    project: { id: string; slug: string; name: string; workspace_id: string } | null;
  };

  const workspacesQuery = createQuery(workspacesQueryOptions());
  const linesQuery = createQuery(allLinesQueryOptions());
  const engagementsQuery = createQuery({
    queryKey: ['engagements', 'today'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: Engagement[] }>('/api/engagements?status=any&limit=100', signal),
  });
  const performancesQuery = createQuery({
    queryKey: ['today-performances'],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: Performance[] }>(
        `/api/performances?status=any&from=${new Date().toISOString().slice(0, 10)}&limit=200`,
        signal,
      ),
  });

  let workspaces = $derived<NavWorkspace[]>($workspacesQuery.data?.items ?? []);
  let lineIndex = $derived(buildLineIndex(workspaces, ($linesQuery.data?.items as RawLine[]) ?? []));
  let engagements = $derived<Engagement[]>($engagementsQuery.data?.items ?? []);
  let performances = $derived<Performance[]>($performancesQuery.data?.items ?? []);

  // ── Scope resolution ──────────────────────────────────────────────────
  let scope = $derived(resolveScope(pins.pins, workspaces, lineIndex));
  let pinnedProjectIds = $derived(new Set(scope.lines.map((l) => l.projectId)));

  function engInScope(e: Engagement): boolean {
    if (scope.isEmpty) return true;
    if (scope.workspaceIds.includes(e.workspace_id)) return true;
    if (e.project && pinnedProjectIds.has(e.project.id)) return true;
    return false;
  }
  let scopedEngagements = $derived(engagements.filter(engInScope));

  // ── Greeting + date ───────────────────────────────────────────────────
  let now = $derived(new Date());
  let greetWord = $derived.by(() => {
    const h = now.getHours();
    return h < 12 ? 'Good morning' : h < 19 ? 'Good afternoon' : 'Good evening';
  });
  let dateLabel = $derived(
    now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
  );

  let jwtName = $state<string | null>(null);
  $effect(() => {
    if (typeof window === 'undefined') return;
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt) return;
    const full =
      decodeJwtClaim(jwt, 'user_metadata.full_name') || decodeJwtClaim(jwt, 'user_metadata.name');
    if (full) {
      jwtName = full.split(/\s+/)[0] ?? full;
      return;
    }
    const email = decodeJwtClaim(jwt, 'email');
    if (email) {
      const local = email.split('@')[0] ?? '';
      const first = local.split(/[._-]+/)[0];
      if (first && first.length < local.length) {
        jwtName = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
      }
    }
  });
  let firstName = $derived.by(() => {
    if (jwtName) return jwtName;
    const personal = workspaces.find((h) => h.kind === 'personal');
    return personal ? (personal.name.split(/\s+/)[0] ?? personal.name) : 'there';
  });

  // ── Agenda (this week) ────────────────────────────────────────────────
  type WeekRow = {
    id: string;
    verb: string;
    subject: string;
    personSlug: string | null;
    overdue: boolean;
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
  const TAG_TONES: WeekRow['tags'][number]['tone'][] = ['teal', 'blue', 'green', 'purple', 'amber', 'red', 'neutral'];
  function toneForTag(tag: string): WeekRow['tags'][number]['tone'] {
    let h = 0;
    for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
    return TAG_TONES[h % TAG_TONES.length];
  }
  function dayBucket(d: Date | null): { sortKey: number; label: string } {
    if (!d) return { sortKey: 1_000_000, label: 'WHENEVER' };
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((d.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays < 0) return { sortKey: -1, label: 'OVERDUE' };
    if (diffDays === 0) return { sortKey: 0, label: 'TODAY' };
    if (diffDays === 1) return { sortKey: 1, label: 'TOMORROW' };
    if (diffDays < 7)
      return { sortKey: diffDays, label: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase() };
    if (diffDays < 14) return { sortKey: 7, label: 'NEXT WEEK' };
    return { sortKey: 99, label: 'LATER' };
  }
  let weekRows = $derived.by<WeekRow[]>(() =>
    scopedEngagements
      .filter((e) => e.status !== 'declined' && e.status !== 'dormant')
      .filter((e) => e.next_action_at)
      .map((e) => {
        const date = new Date(e.next_action_at!);
        const bucket = dayBucket(date);
        const isOverdue = bucket.sortKey === -1;
        const verb = VERBS[e.status]?.[isOverdue ? 'overdue' : 'upcoming'] ?? 'Look at';
        const tagsRaw = Array.isArray(e.custom_fields?.tags)
          ? (e.custom_fields?.tags as unknown[]).filter((t): t is string => typeof t === 'string')
          : [];
        const tags = tagsRaw.slice(0, 2).map((label) => ({
          label: label.startsWith('#') ? label : `#${label}`,
          tone: toneForTag(label),
        }));
        const subject =
          e.person?.full_name || e.person?.organization_name || e.next_action_note || 'Untitled';
        return {
          id: e.id,
          verb,
          subject,
          personSlug: e.person?.slug ?? null,
          overdue: isOverdue,
          tags,
          projectName: e.project?.name ?? '—',
          projectSlug: e.project?.slug ?? '',
          daySortKey: bucket.sortKey,
          dayLabel: bucket.label,
        };
      })
      .sort((a, b) => a.daySortKey - b.daySortKey)
      .slice(0, 24),
  );
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

  // ── Pinned panels ─────────────────────────────────────────────────────
  function perfsForLine(lineId: string): Performance[] {
    return performances.filter((p) => p.line_id === lineId);
  }
  function perfsForWorkspace(wsId: string): Performance[] {
    return performances.filter((p) => p.project?.workspace_id === wsId);
  }
  function statOf(list: Performance[]) {
    const confirmed = list.filter((p) => ['confirmed', 'done', 'invoiced', 'paid'].includes(p.status)).length;
    const holds = list.filter((p) => p.status.startsWith('hold')).length;
    return { confirmed, holds };
  }

  type PinnedUnit =
    | { kind: 'line'; pin: string; line: NavLine }
    | { kind: 'space'; pin: string; ws: NavWorkspace };
  let pinnedUnits = $derived.by<PinnedUnit[]>(() => {
    const out: PinnedUnit[] = [];
    const lineById = new Map(lineIndex.map((l) => [l.id, l]));
    const wsBySlug = new Map(workspaces.map((w) => [w.slug, w]));
    for (const pin of pins.pins) {
      if (pin.startsWith('l:')) {
        const line = lineById.get(pin.slice(2));
        if (line) out.push({ kind: 'line', pin, line });
      } else {
        const ws = wsBySlug.get(pin.slice(2));
        if (ws) out.push({ kind: 'space', pin, ws });
      }
    }
    return out;
  });
  function linesOfWorkspace(wsId: string): NavLine[] {
    return lineIndex.filter((l) => l.workspaceId === wsId);
  }

  function openLine(line: NavLine) {
    void goto(lineUrl(line));
  }
</script>

<svelte:head><title>Agenda — Hour</title></svelte:head>

<div class="home">
  <h1 class="home__greet">{greetWord}, <em>{firstName}</em>.</h1>
  <p class="home__date">{dateLabel} · a quiet start — pin a space or a line to bring it forward</p>

  <ScopeStrip onOpenLine={openLine} />

  <div class="home__toolbar"><span class="eyebrow">Today &amp; this week</span></div>
  <div class="home__agenda-wrap">
    {#if $engagementsQuery.isPending}
      <p class="home__empty">Loading…</p>
    {:else if $engagementsQuery.isError}
      <p class="home__empty home__empty--err">Couldn't load your week.</p>
    {:else if groupedWeek.length === 0}
      <p class="home__empty">Nothing due in this scope. Set next actions on your conversations and they land here.</p>
    {:else}
      <div class="week">
        {#each groupedWeek as group (group.day)}
          <div class="week__day" class:week__day--overdue={group.day === 'OVERDUE'} class:week__day--today={group.day === 'TODAY'}>
            {group.day}
          </div>
          <div class="week__rows">
            {#each group.rows as row (row.id)}
              <div class="week__item" class:week__item--overdue={row.overdue}>
                <span class="week__verb">{row.verb}</span>
                {#if row.personSlug}
                  <a class="week__subject" href={`/h/${workspaceSlug}/person/${row.personSlug}`}>{row.subject}</a>
                {:else}
                  <span class="week__subject">{row.subject}</span>
                {/if}
                <span class="week__meta">
                  {#each row.tags as tag (tag.label)}
                    <TagChip label={tag.label} tone={tag.tone} />
                  {/each}
                  <span class="week__project" style={`--c: ${accentVar(row.projectSlug)}`}>
                    <span class="week__dot" aria-hidden="true"></span>
                    <span>{row.projectName}</span>
                  </span>
                </span>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#if pinnedUnits.length > 0}
    <div class="home__pinned-head"><span class="eyebrow">Pinned</span></div>
    <div class="home__pinned">
      {#each pinnedUnits as unit (unit.pin)}
        {#if unit.kind === 'line'}
          {@const st = statOf(perfsForLine(unit.line.id))}
          <button type="button" class="lmini" style={`--c: ${unit.line.accent}`} onclick={() => openLine(unit.line)}>
            <div class="lmini__head">
              <span class="lmini__co"><span class="dot" aria-hidden="true"></span>{unit.line.projectName}</span>
              <span class="lmini__kind">{lineKindGlyph(unit.line.kind)} {lineKindLabel(unit.line.kind)}</span>
              <span
                class="lmini__rm"
                role="button"
                tabindex="0"
                aria-label="Unpin"
                onclick={(e) => { e.stopPropagation(); pins.remove(unit.pin); }}
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); pins.remove(unit.pin); } }}
              >×</span>
            </div>
            <h3 class="lmini__name">{unit.line.name}</h3>
            <p class="lmini__foot">
              {#if st.confirmed || st.holds}
                <b>{st.confirmed}</b> confirmed{#if st.holds} · {st.holds} holds{/if}
              {:else}
                internal — no dates
              {/if}
            </p>
          </button>
        {:else}
          {@const st = statOf(perfsForWorkspace(unit.ws.id))}
          {@const wsLines = linesOfWorkspace(unit.ws.id)}
          <div class="spin" style={`--c: ${accentVarFor(unit.ws)}`}>
            <div class="spin__head">
              <span class="dot" aria-hidden="true"></span>
              <h3 class="spin__name">{unit.ws.name}</h3>
              <span class="spin__meta">{st.confirmed} confirmed · {st.holds} holds</span>
              <span
                class="spin__rm"
                role="button"
                tabindex="0"
                aria-label="Unpin"
                onclick={() => pins.remove(unit.pin)}
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pins.remove(unit.pin); } }}
              >×</span>
            </div>
            <div class="spin__lines">
              {#each wsLines as line (line.id)}
                <button type="button" class="spin__line" onclick={() => openLine(line)}>
                  <span class="spin__g">{lineKindGlyph(line.kind)}</span>
                  <span class="spin__ln">{line.name}</span>
                  <span class="spin__go" aria-hidden="true">→</span>
                </button>
              {:else}
                <p class="spin__empty">No lines yet.</p>
              {/each}
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {:else if workspaces.length > 0}
    <div class="home__pinned-head">
      <span class="eyebrow">All spaces</span>
      <span class="home__pinned-hint">nothing pinned — browse everything, pin what you live in</span>
    </div>
    <div class="home__pinned">
      {#each workspaces as ws (ws.id)}
        {@const st = statOf(perfsForWorkspace(ws.id))}
        {@const wsLines = linesOfWorkspace(ws.id)}
        <div class="spin" style={`--c: ${accentVarFor(ws)}`}>
          <div class="spin__head">
            <span class="dot" aria-hidden="true"></span>
            <h3 class="spin__name">{ws.name}</h3>
            <span class="spin__meta">{st.confirmed} confirmed · {st.holds} holds</span>
            <button
              type="button"
              class="spin__pin"
              onclick={() => pins.add(spacePin(ws.slug))}
              title="Pin this space"
            >pin</button>
          </div>
          <div class="spin__lines">
            {#each wsLines as line (line.id)}
              <button type="button" class="spin__line" onclick={() => openLine(line)}>
                <span class="spin__g">{lineKindGlyph(line.kind)}</span>
                <span class="spin__ln">{line.name}</span>
                <span class="spin__go" aria-hidden="true">→</span>
              </button>
            {:else}
              <p class="spin__empty">No lines yet.</p>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  @layer components {
    /* .home is a plain <div> (not <section>) so it dodges base.css's section
       defaults (big padding-block + a space-l flex gap between children); the
       vertical rhythm here is controlled by each element's own margin. */
    .home {
      max-inline-size: 46rem;
      margin-inline: auto;
    }

    .home__greet {
      font-family: var(--font-display);
      font-weight: 400;
      font-size: clamp(1.9rem, 1.4rem + 2.2vw, 2.6rem);
      letter-spacing: -0.02em;
      line-height: 1.05;
      margin: 0 0 var(--space-2xs);
      color: var(--text-color);
    }
    .home__greet em {
      font-style: italic;
    }
    .home__date {
      font-size: var(--text-m);
      color: var(--text-muted);
      margin: 0 0 var(--space-s);
    }

    .home__toolbar {
      margin-block: var(--space-s) var(--space-2xs);
    }
    .home__agenda-wrap {
      border-block-start: 1px solid var(--border-color-light);
    }

    /* ── agenda / week — dense timeline (matches the design mock) ── */
    .week {
      display: grid;
      grid-template-columns: 4.5rem 1fr;
    }
    .week__day {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
      padding-block: var(--space-s) var(--space-2xs);
      align-self: start;
    }
    .week__day--today {
      color: var(--primary);
    }
    .week__day--overdue {
      color: var(--danger);
    }
    .week__rows {
      border-inline-start: 1px solid var(--border-color-light);
    }
    .week__item {
      position: relative;
      display: grid;
      grid-template-columns: 5rem 1fr auto;
      align-items: baseline;
      gap: var(--space-s);
      padding-block: var(--space-xs);
      padding-inline-start: var(--space-l);
      border-block-end: 1px solid color-mix(in oklch, var(--border-color-light) 55%, transparent);
    }
    /* the dot on the rail */
    .week__item::before {
      content: '';
      position: absolute;
      inset-inline-start: -0.28rem;
      inset-block-start: 0.6rem;
      inline-size: 0.44rem;
      block-size: 0.44rem;
      border-radius: var(--radius-circle);
      background: var(--bg);
      border: 1.5px solid var(--border-color-dark);
    }
    .week__item--overdue::before {
      background: var(--danger);
      border-color: var(--danger);
    }
    .week__verb {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
      text-transform: lowercase;
    }
    .week__item--overdue .week__verb {
      color: var(--danger);
    }
    .week__subject {
      font-size: var(--text-s);
      color: var(--text-color);
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      min-inline-size: 0;
    }
    a.week__subject:hover {
      text-decoration: underline;
    }
    .week__meta {
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--space-s);
    }
    .week__project {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      font-size: var(--text-xs);
      color: var(--text-muted);
      white-space: nowrap;
    }
    .week__dot,
    .dot {
      inline-size: 0.5rem;
      block-size: 0.5rem;
      border-radius: var(--radius-circle);
      background: var(--c, var(--text-faint));
      flex: none;
    }

    .home__empty {
      color: var(--text-muted);
      font-style: italic;
      font-family: var(--font-display);
      padding-block: var(--space-l);
      text-align: center;
    }
    .home__empty--err {
      color: var(--danger);
    }

    /* ── pinned panels ── */
    .home__pinned-head {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
      flex-wrap: wrap;
      margin-block: var(--space-l) var(--space-s);
    }
    .home__pinned-hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
      font-style: italic;
      font-family: var(--font-display);
    }
    .home__pinned {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
      gap: var(--space-m);
    }

    .lmini {
      position: relative;
      display: block;
      inline-size: 100%;
      text-align: start;
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-xl);
      padding: var(--space-m);
      background: var(--bg-ultra-light);
      cursor: pointer;
      overflow: hidden;
      font-family: inherit;
      transition: border-color var(--transition), transform var(--transition);
    }
    .lmini::before {
      content: '';
      position: absolute;
      inset-block: 0;
      inset-inline-start: 0;
      inline-size: 3px;
      background: var(--c, var(--primary));
    }
    .lmini:hover {
      border-color: var(--border-color-dark);
      transform: translateY(-1px);
    }
    .lmini__head {
      display: flex;
      align-items: center;
      gap: var(--space-s);
      margin-block-end: var(--space-xs);
    }
    .lmini__co {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .lmini__co .dot {
      background: var(--c, var(--text-faint));
    }
    .lmini__kind {
      margin-inline-start: auto;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--c, var(--text-muted));
    }
    .lmini__rm,
    .spin__rm {
      color: var(--text-faint);
      font-size: var(--text-m);
      line-height: 1;
      cursor: pointer;
    }
    .lmini__rm:hover,
    .spin__rm:hover {
      color: var(--danger);
    }
    .lmini__name {
      font-family: var(--font-display);
      font-size: var(--text-l);
      font-weight: 500;
      margin: 0 0 var(--space-xs);
    }
    .lmini__foot {
      font-size: var(--text-s);
      color: var(--text-muted);
      margin: 0;
    }
    .lmini__foot b {
      color: var(--text-color);
    }

    .spin {
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-xl);
      background: var(--bg-ultra-light);
      overflow: hidden;
    }
    .spin__head {
      display: flex;
      align-items: center;
      gap: var(--space-s);
      padding-block: var(--space-s);
      padding-inline: var(--space-m);
      border-block-end: 1px solid var(--border-color-light);
    }
    .spin__head .dot {
      background: var(--c, var(--text-faint));
    }
    .spin__name {
      font-family: var(--font-display);
      font-size: var(--text-l);
      font-weight: 500;
      margin: 0;
    }
    .spin__meta {
      font-size: var(--text-xs);
      color: var(--text-muted);
      margin-inline-start: auto;
    }
    .spin__pin {
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-circle);
      background: none;
      padding-block: var(--space-2xs);
      padding-inline: var(--space-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-muted);
      cursor: pointer;
      transition: border-color var(--transition), color var(--transition);
    }
    .spin__pin:hover {
      border-color: var(--text-muted);
      color: var(--text-color);
    }
    .spin__lines {
      padding: var(--space-xs);
    }
    .spin__line {
      display: flex;
      align-items: center;
      gap: var(--space-s);
      inline-size: 100%;
      padding-block: var(--space-s);
      padding-inline: var(--space-s);
      border: 0;
      border-radius: var(--radius-m);
      background: none;
      text-align: start;
      cursor: pointer;
      font-family: inherit;
    }
    .spin__line:hover {
      background: var(--bg-light);
    }
    .spin__g {
      inline-size: 1.1rem;
      text-align: center;
      color: var(--c, var(--text-muted));
      font-size: var(--text-s);
    }
    .spin__ln {
      flex: 1;
      font-size: var(--text-s);
      font-weight: 500;
      color: var(--text-color);
    }
    .spin__go {
      color: var(--text-faint);
      opacity: 0;
    }
    .spin__line:hover .spin__go {
      opacity: 1;
    }
    .spin__empty {
      margin: 0;
      padding: var(--space-s);
      font-size: var(--text-xs);
      color: var(--text-faint);
      font-style: italic;
    }

    @media (max-width: 47.999rem) {
      .week__item {
        grid-template-columns: 5rem 1fr;
      }
      .week__project {
        display: none;
      }
    }
  }
</style>
