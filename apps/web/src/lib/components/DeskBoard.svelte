<script lang="ts" module>
  export type EngagementStatus =
    | 'contacted'
    | 'in_conversation'
    | 'hold'
    | 'confirmed'
    | 'declined'
    | 'dormant'
    | 'recurring';
  export type DeskEngagement = {
    id: string;
    status: EngagementStatus;
    next_action_at: string | null;
    next_action_note: string | null;
    custom_fields: Record<string, unknown> | null;
    person: { full_name: string | null; organization_name: string | null; slug: string | null } | null;
    project: { id: string; slug: string; name: string } | null;
  };
</script>

<script lang="ts">
  /**
   * DeskBoard — the this-week timeline (dot rail + day buckets). Shared by
   * the Home (capped, this-week-only, with a "+N more" link to the full view)
   * and the Agenda view (uncapped, all time ranges). Engagements come in
   * already scoped by the caller's pins.
   */
  import TagChip from '$lib/components/TagChip.svelte';
  import { accentVar } from '$lib/utils/accent';

  interface Props {
    engagements: DeskEngagement[];
    workspaceSlug: string;
    cap?: number | null;
    next7Days?: boolean;
    /** where "+N more this week" points (only rendered when cap hides rows) */
    moreHref?: string;
    loading?: boolean;
    error?: boolean;
  }
  let {
    engagements,
    workspaceSlug,
    cap = null,
    next7Days = false,
    moreHref,
    loading = false,
    error = false,
  }: Props = $props();

  type Tone = 'amber' | 'blue' | 'teal' | 'green' | 'purple' | 'red' | 'neutral';
  type WeekRow = {
    id: string;
    verb: string;
    subject: string;
    personSlug: string | null;
    overdue: boolean;
    tags: { label: string; tone: Tone }[];
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
  const TAG_TONES: Tone[] = ['teal', 'blue', 'green', 'purple', 'amber', 'red', 'neutral'];
  function toneForTag(tag: string): Tone {
    let h = 0;
    for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
    return TAG_TONES[h % TAG_TONES.length];
  }

  let now = $derived(new Date());
  function dayBucket(d: Date): { sortKey: number; label: string } {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((d.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays < 0) return { sortKey: -1, label: 'OVERDUE' };
    if (diffDays === 0) return { sortKey: 0, label: 'TODAY' };
    if (diffDays === 1) return { sortKey: 1, label: 'TOMORROW' };
    if (diffDays < 7)
      return { sortKey: diffDays, label: d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase() };
    if (diffDays < 14) return { sortKey: 7, label: 'NEXT WEEK' };
    return { sortKey: 99, label: 'LATER' };
  }

  // "This week" = overdue + everything due within 7 days (sortKey < 7).
  let allRows = $derived.by<WeekRow[]>(() =>
    engagements
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
      .filter((r) => (next7Days ? r.daySortKey < 7 : true))
      .sort((a, b) => a.daySortKey - b.daySortKey),
  );
  let rows = $derived(cap == null ? allRows : allRows.slice(0, cap));
  let moreCount = $derived(Math.max(0, allRows.length - rows.length));
  let grouped = $derived.by(() => {
    const groups: { day: string; rows: WeekRow[] }[] = [];
    let current: { day: string; rows: WeekRow[] } | null = null;
    for (const row of rows) {
      if (!current || current.day !== row.dayLabel) {
        current = { day: row.dayLabel, rows: [] };
        groups.push(current);
      }
      current.rows.push(row);
    }
    return groups;
  });
</script>

<div class="agenda-wrap">
  {#if loading}
    <p class="agenda-empty">Loading…</p>
  {:else if error}
    <p class="agenda-empty agenda-empty--err">Couldn't load your week.</p>
  {:else if grouped.length === 0}
    <p class="agenda-empty">Nothing due in this scope. Set next actions on your conversations and they land here.</p>
  {:else}
    <div class="week">
      {#each grouped as group (group.day)}
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
    {#if moreCount > 0 && moreHref}
      <a class="week__more" href={moreHref}>
        + {moreCount} more · next 7 days <span class="week__more-cal">→ Desk</span>
      </a>
    {/if}
  {/if}
</div>

<style>
  @layer components {
    .agenda-wrap {
      border-block-start: 1px solid var(--border-color-light);
    }
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
    .week__dot {
      inline-size: 0.5rem;
      block-size: 0.5rem;
      border-radius: var(--radius-circle);
      background: var(--c, var(--text-faint));
      flex: none;
    }

    .agenda-empty {
      color: var(--text-muted);
      font-style: italic;
      font-family: var(--font-display);
      padding-block: var(--space-l);
      text-align: center;
    }
    .agenda-empty--err {
      color: var(--danger);
    }

    .week__more {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      margin-block-start: var(--space-m);
      padding-block: var(--space-xs);
      padding-inline: var(--space-m);
      border: 1px dashed var(--border-color-dark);
      border-radius: var(--radius-circle);
      background: transparent;
      font-size: var(--text-xs);
      color: var(--text-muted);
      text-decoration: none;
      transition: color var(--transition), border-color var(--transition);
    }
    .week__more:hover {
      color: var(--text-color);
      border-color: var(--text-muted);
    }
    .week__more-cal {
      color: var(--text-faint);
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
