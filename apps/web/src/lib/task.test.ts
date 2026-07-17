import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TaskCreateSchema,
  TaskPatchSchema,
  taskContextLabel,
  taskProjectId,
  taskSurfaceState,
  type TaskItem,
} from './task';

const WS = '018f3b1a-0000-7000-8000-000000000001';
const PARENT = '018f3b1a-0000-7000-8000-000000000002';

function item(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: '018f3b1a-0000-7000-8000-00000000000f',
    workspace_id: WS,
    project_id: null,
    line_id: null,
    performance_id: null,
    engagement_id: null,
    title: 'Send the rider',
    note: null,
    due_at: null,
    from_at: null,
    lead_days: null,
    status: 'open',
    origin: 'manual',
    custom_fields: {},
    created_by: null,
    created_at: '2026-07-17T00:00:00Z',
    updated_at: '2026-07-17T00:00:00Z',
    deleted_at: null,
    project: null,
    line: null,
    performance: null,
    engagement: null,
    ...overrides,
  };
}

describe('task vocabulary', () => {
  it('mirrors the DB enum order', () => {
    expect(TASK_STATUSES).toEqual(['open', 'done']);
  });

  it('labels every status', () => {
    for (const s of TASK_STATUSES) {
      expect(TASK_STATUS_LABELS[s]).toBeTruthy();
    }
  });
});

describe('TaskCreateSchema', () => {
  it('accepts a minimal free task', () => {
    const r = v.safeParse(TaskCreateSchema, { title: 'Call the venue', workspace_id: WS });
    expect(r.success).toBe(true);
  });

  it('trims the title', () => {
    const r = v.parse(TaskCreateSchema, { title: '  call back  ', workspace_id: WS });
    expect(r.title).toBe('call back');
  });

  it('rejects an empty title', () => {
    expect(v.safeParse(TaskCreateSchema, { title: '', workspace_id: WS }).success).toBe(false);
  });

  it('rejects a title over 200 chars', () => {
    const r = v.safeParse(TaskCreateSchema, { title: 'x'.repeat(201), workspace_id: WS });
    expect(r.success).toBe(false);
  });

  it('rejects a note over 500 chars', () => {
    const r = v.safeParse(TaskCreateSchema, {
      title: 'ok',
      workspace_id: WS,
      note: 'x'.repeat(501),
    });
    expect(r.success).toBe(false);
  });

  it('due_at is date-only: rejects a timestamp', () => {
    const r = v.safeParse(TaskCreateSchema, {
      title: 'ok',
      workspace_id: WS,
      due_at: '2026-07-17T10:00:00Z',
    });
    expect(r.success).toBe(false);
  });

  it('due_at rejects impossible calendar dates that pass the regex', () => {
    const r = v.safeParse(TaskCreateSchema, {
      title: 'ok',
      workspace_id: WS,
      due_at: '2026-02-31',
    });
    expect(r.success).toBe(false);
  });

  it('due_at accepts a real leap day', () => {
    const r = v.safeParse(TaskCreateSchema, {
      title: 'ok',
      workspace_id: WS,
      due_at: '2028-02-29',
    });
    expect(r.success).toBe(true);
  });

  it('rejects non-uuid parent ids', () => {
    const r = v.safeParse(TaskCreateSchema, { title: 'ok', line_id: 'not-a-uuid' });
    expect(r.success).toBe(false);
  });

  it('strips unknown fields so RLS-sensitive columns cannot ride along', () => {
    const r = v.parse(TaskCreateSchema, {
      title: 'ok',
      workspace_id: WS,
      origin: 'ai',
      created_by: PARENT,
      deleted_at: '2026-01-01',
      status: 'done',
    } as Record<string, unknown>);
    expect(r).toEqual({ title: 'ok', workspace_id: WS });
  });

  it('accepts a parent without workspace_id (the endpoint pairs the rules)', () => {
    const r = v.safeParse(TaskCreateSchema, { title: 'ok', engagement_id: PARENT });
    expect(r.success).toBe(true);
  });
});

describe('TaskPatchSchema', () => {
  it('accepts a single-field patch', () => {
    expect(v.safeParse(TaskPatchSchema, { status: 'done' }).success).toBe(true);
  });

  it('accepts null to clear due_at and note', () => {
    const r = v.parse(TaskPatchSchema, { due_at: null, note: null });
    expect(r).toEqual({ due_at: null, note: null });
  });

  it('rejects an unknown status', () => {
    expect(v.safeParse(TaskPatchSchema, { status: 'blocked' }).success).toBe(false);
  });

  it('strips unknown fields so parent FKs and scope columns cannot ride along', () => {
    const r = v.parse(TaskPatchSchema, {
      status: 'done',
      workspace_id: WS,
      line_id: PARENT,
      origin: 'protocol',
      deleted_at: '2026-01-01',
    } as Record<string, unknown>);
    expect(r).toEqual({ status: 'done' });
  });

  it('accepts an empty object (endpoint rejects it separately as empty_patch)', () => {
    expect(v.safeParse(TaskPatchSchema, {}).success).toBe(true);
  });
});

describe('taskSurfaceState (ADR-070)', () => {
  // Fixed clock — 2026-07-17 morning for a viewer east of UTC.
  const NOW = new Date('2026-07-17T10:00:00+02:00');
  type SurfaceInput = Parameters<typeof taskSurfaceState>[0];
  function task(overrides: Partial<SurfaceInput> = {}): SurfaceInput {
    return { status: 'open', from_at: null, due_at: null, lead_days: null, ...overrides };
  }

  it('no dates → anytime, never surfaces', () => {
    expect(taskSurfaceState(task(), NOW)).toEqual({ surfacesAt: null, state: 'anytime' });
  });

  it('future from → dormant, surfacing on the from day', () => {
    const s = taskSurfaceState(task({ from_at: '2026-07-20T00:00:00+00:00' }), NOW);
    expect(s).toEqual({ surfacesAt: '2026-07-20', state: 'dormant' });
  });

  it('from today → surfaced (boundary), a plain open task', () => {
    const s = taskSurfaceState(task({ from_at: '2026-07-17T00:00:00+00:00' }), NOW);
    expect(s.state).toBe('open');
  });

  it('due + lead before the window → dormant until due − lead', () => {
    const s = taskSurfaceState(
      task({ due_at: '2026-07-30T00:00:00+00:00', lead_days: 3 }),
      NOW,
    );
    expect(s).toEqual({ surfacesAt: '2026-07-27', state: 'dormant' });
  });

  it('due + lead inside the window → urgent', () => {
    const s = taskSurfaceState(
      task({ due_at: '2026-07-19T00:00:00+00:00', lead_days: 3 }),
      NOW,
    );
    expect(s).toEqual({ surfacesAt: '2026-07-16', state: 'urgent' });
  });

  it('due today → urgent (boundary), with or without lead', () => {
    expect(taskSurfaceState(task({ due_at: '2026-07-17T00:00:00+00:00' }), NOW).state).toBe(
      'urgent',
    );
  });

  it('due ahead with no lead → open now (no silent sleep)', () => {
    expect(taskSurfaceState(task({ due_at: '2026-07-25T00:00:00+00:00' }), NOW).state).toBe(
      'open',
    );
  });

  it('past due → overdue', () => {
    expect(taskSurfaceState(task({ due_at: '2026-07-16T00:00:00+00:00' }), NOW).state).toBe(
      'overdue',
    );
  });

  it('surfacesAt = max(from, due − lead)', () => {
    // from later than the lead window opening
    const a = taskSurfaceState(
      task({ from_at: '2026-07-18T00:00:00+00:00', due_at: '2026-07-20T00:00:00+00:00', lead_days: 5 }),
      NOW,
    );
    expect(a).toEqual({ surfacesAt: '2026-07-18', state: 'dormant' });
    // lead window opening later than from
    const b = taskSurfaceState(
      task({ from_at: '2026-07-15T00:00:00+00:00', due_at: '2026-07-20T00:00:00+00:00', lead_days: 1 }),
      NOW,
    );
    expect(b).toEqual({ surfacesAt: '2026-07-19', state: 'dormant' });
  });

  it('done wins over everything', () => {
    const s = taskSurfaceState(
      task({ status: 'done', due_at: '2026-07-01T00:00:00+00:00' }),
      NOW,
    );
    expect(s.state).toBe('done');
  });

  it('due today stays urgent until the local day ends — calendar days, not instants', () => {
    // 23:30 LOCAL on the due day (no zone suffix → runtime zone). An
    // instant-based compare against local midnight would call this overdue
    // for any viewer west of the stored UTC midnight.
    const lateEvening = new Date('2026-07-17T23:30:00');
    const s = taskSurfaceState(task({ due_at: '2026-07-17T00:00:00+00:00' }), lateEvening);
    expect(s.state).toBe('urgent');
  });
});

describe('taskProjectId', () => {
  it('is null for a free workspace task', () => {
    expect(taskProjectId(item())).toBeNull();
  });

  it('resolves through each parent embed', () => {
    expect(taskProjectId(item({ project_id: PARENT, project: { id: PARENT, slug: 'p', name: 'P' } }))).toBe(PARENT);
    expect(
      taskProjectId(item({ line: { id: 'x', slug: 'l', name: 'L', project_id: PARENT } })),
    ).toBe(PARENT);
    expect(
      taskProjectId(
        item({
          performance: { id: 'x', slug: 'g', project_id: PARENT, venue_name: null, city: null, start_at: null },
        }),
      ),
    ).toBe(PARENT);
    expect(
      taskProjectId(item({ engagement: { id: 'x', project_id: PARENT, person: null } })),
    ).toBe(PARENT);
  });
});

describe('taskContextLabel', () => {
  it('is null for a free workspace task', () => {
    expect(taskContextLabel(item())).toBeNull();
  });

  it('prefers the line name', () => {
    const t = item({
      line: { id: 'x', slug: 'l', name: 'Gira 26-27', project_id: PARENT },
      project: { id: PARENT, slug: 'p', name: 'MaMeMi' },
    });
    expect(taskContextLabel(t)).toBe('Gira 26-27');
  });

  it('labels a performance by venue and city', () => {
    const t = item({
      performance: {
        id: 'x',
        slug: 'g',
        project_id: PARENT,
        venue_name: 'Teatre Lliure',
        city: 'Barcelona',
        start_at: null,
      },
    });
    expect(taskContextLabel(t)).toBe('Teatre Lliure, Barcelona');
  });

  it('labels an engagement by its person', () => {
    const t = item({
      engagement: {
        id: 'x',
        project_id: PARENT,
        person: { slug: 'anna', full_name: 'Anna Puig', organization_name: null },
      },
    });
    expect(taskContextLabel(t)).toBe('Anna Puig');
  });
});
