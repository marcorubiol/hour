import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
  CONVERSATION_STATUSES,
  ConversationCreateSchema,
  ConversationPatchSchema,
  STATUS_LABELS,
  normalizeConversationItem,
  statusBadgeClass,
  statusLabel,
  type ConversationDbItem,
} from './conversation';

describe('workspace dossier projection', () => {
  it('keeps the API contract while deriving organization_name locally', () => {
    const item = normalizeConversationItem({
      person: {
        person_id: '22222222-2222-4222-8222-222222222222',
        slug: 'jordi',
        full_name: 'Jordi',
        email: 'jordi@example.test',
        country: 'ES',
        city: 'Girona',
        website: null,
        organization: { name: 'Teatre X' },
      },
      project: null,
    } as unknown as ConversationDbItem);

    expect(item.person).toMatchObject({
      id: '22222222-2222-4222-8222-222222222222',
      full_name: 'Jordi',
      organization_name: 'Teatre X',
    });
    expect('organization' in (item.person ?? {})).toBe(false);
  });
});

describe('ConversationPatchSchema', () => {
  it('accepts a single-field status patch', () => {
    const r = v.safeParse(ConversationPatchSchema, { status: 'in_conversation' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.output).toEqual({ status: 'in_conversation' });
  });

  it('accepts date-only next_action_at and null to clear', () => {
    const set = v.safeParse(ConversationPatchSchema, { next_action_at: '2026-09-15' });
    expect(set.success).toBe(true);
    const clear = v.safeParse(ConversationPatchSchema, { next_action_at: null });
    expect(clear.success).toBe(true);
    if (clear.success) expect(clear.output.next_action_at).toBeNull();
  });

  it('rejects a status outside the enum', () => {
    const r = v.safeParse(ConversationPatchSchema, { status: 'lead' });
    expect(r.success).toBe(false);
  });

  it('rejects a timestamped next_action_at (date-only contract)', () => {
    const r = v.safeParse(ConversationPatchSchema, {
      next_action_at: '2026-09-15T10:00:00Z',
    });
    expect(r.success).toBe(false);
  });

  it('rejects impossible calendar dates that pass the isoDate regex', () => {
    for (const bad of ['2026-02-31', '2026-06-31', '2026-02-29']) {
      expect(v.safeParse(ConversationPatchSchema, { next_action_at: bad }).success).toBe(
        false,
      );
    }
    // Real leap day passes.
    expect(
      v.safeParse(ConversationPatchSchema, { next_action_at: '2024-02-29' }).success,
    ).toBe(true);
  });

  it('trims the note and accepts null to clear it', () => {
    const r = v.safeParse(ConversationPatchSchema, { next_action_note: '  call back  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.output.next_action_note).toBe('call back');
    const clear = v.safeParse(ConversationPatchSchema, { next_action_note: null });
    expect(clear.success).toBe(true);
  });

  it('rejects a note over 500 chars', () => {
    const r = v.safeParse(ConversationPatchSchema, { next_action_note: 'x'.repeat(501) });
    expect(r.success).toBe(false);
  });

  it('strips unknown fields so RLS-sensitive columns cannot ride along', () => {
    const r = v.safeParse(ConversationPatchSchema, {
      status: 'hold',
      workspace_id: '11111111-1111-1111-1111-111111111111',
      deleted_at: '2026-01-01',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.output).toEqual({ status: 'hold' });
      expect('workspace_id' in r.output).toBe(false);
    }
  });

  it('accepts an empty object (endpoint rejects it separately as empty_patch)', () => {
    const r = v.safeParse(ConversationPatchSchema, {});
    expect(r.success).toBe(true);
    if (r.success) expect(Object.keys(r.output)).toHaveLength(0);
  });

  it('accepts a line_id relink and null to detach (ADR-056)', () => {
    const set = v.safeParse(ConversationPatchSchema, {
      line_id: '55555555-5555-5555-5555-555555555555',
    });
    expect(set.success).toBe(true);
    const detach = v.safeParse(ConversationPatchSchema, { line_id: null });
    expect(detach.success).toBe(true);
    if (detach.success) expect(detach.output.line_id).toBeNull();
    expect(v.safeParse(ConversationPatchSchema, { line_id: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('status vocabulary', () => {
  it('has a label and a badge class for every enum value', () => {
    for (const s of CONVERSATION_STATUSES) {
      expect(STATUS_LABELS[s]).toBeTruthy();
      expect(statusBadgeClass(s)).toBe(`badge--${s.replace(/_/g, '-')}`);
    }
  });

  it('falls back to the raw value for unknown statuses', () => {
    expect(statusLabel('mystery')).toBe('mystery');
  });
});

describe('ConversationCreateSchema', () => {
  const PROJECT = '11111111-1111-1111-1111-111111111111';
  const PERSON = '22222222-2222-2222-2222-222222222222';

  it('accepts the existing-person shape and defaults status to contacted', () => {
    const r = v.safeParse(ConversationCreateSchema, {
      project_id: PROJECT,
      person_id: PERSON,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.output.status).toBe('contacted');
      expect(r.output.person).toBeUndefined();
    }
  });

  it('accepts the inline-person shape with trims applied', () => {
    const r = v.safeParse(ConversationCreateSchema, {
      project_id: PROJECT,
      person: {
        full_name: '  Jordi Programador  ',
        email: 'jordi@teatre.cat',
        organization_name: 'Teatre X',
      },
      status: 'in_conversation',
      next_action_at: '2026-09-15',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.output.person?.full_name).toBe('Jordi Programador');
      expect(r.output.status).toBe('in_conversation');
    }
  });

  it('rejects a missing project_id or a non-uuid project_id', () => {
    expect(v.safeParse(ConversationCreateSchema, { person_id: PERSON }).success).toBe(false);
    expect(
      v.safeParse(ConversationCreateSchema, { project_id: 'mamemi', person_id: PERSON })
        .success,
    ).toBe(false);
  });

  it('rejects an inline person without full_name and a bad email', () => {
    expect(
      v.safeParse(ConversationCreateSchema, {
        project_id: PROJECT,
        person: { email: 'jordi@teatre.cat' },
      }).success,
    ).toBe(false);
    expect(
      v.safeParse(ConversationCreateSchema, {
        project_id: PROJECT,
        person: { full_name: 'Jordi', email: 'not-an-email' },
      }).success,
    ).toBe(false);
  });

  it('rejects impossible next_action_at dates (same guard as the PATCH)', () => {
    const r = v.safeParse(ConversationCreateSchema, {
      project_id: PROJECT,
      person_id: PERSON,
      next_action_at: '2026-02-31',
    });
    expect(r.success).toBe(false);
  });

  it('strips unknown keys (RLS-sensitive columns can never ride along)', () => {
    const r = v.safeParse(ConversationCreateSchema, {
      project_id: PROJECT,
      person_id: PERSON,
      workspace_id: '33333333-3333-3333-3333-333333333333',
      created_by: '44444444-4444-4444-4444-444444444444',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect('workspace_id' in r.output).toBe(false);
      expect('created_by' in r.output).toBe(false);
    }
  });

  it('accepts line_id at capture (ADR-056) and rejects non-uuids', () => {
    const r = v.safeParse(ConversationCreateSchema, {
      project_id: PROJECT,
      person_id: PERSON,
      line_id: '55555555-5555-5555-5555-555555555555',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.output.line_id).toBe('55555555-5555-5555-5555-555555555555');
    expect(
      v.safeParse(ConversationCreateSchema, {
        project_id: PROJECT,
        person_id: PERSON,
        line_id: 'difusion-2026-27',
      }).success,
    ).toBe(false);
  });

  it('allows both shapes through the schema — exactly-one is the endpoint rule', () => {
    // The endpoint rejects person_id+person / neither with a specific
    // hint; the schema stays permissive so that error can be precise.
    const both = v.safeParse(ConversationCreateSchema, {
      project_id: PROJECT,
      person_id: PERSON,
      person: { full_name: 'Jordi' },
    });
    expect(both.success).toBe(true);
    const neither = v.safeParse(ConversationCreateSchema, { project_id: PROJECT });
    expect(neither.success).toBe(true);
  });
});
