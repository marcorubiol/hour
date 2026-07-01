import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
  ENGAGEMENT_STATUSES,
  EngagementPatchSchema,
  STATUS_LABELS,
  statusBadgeClass,
  statusLabel,
} from './engagement';

describe('EngagementPatchSchema', () => {
  it('accepts a single-field status patch', () => {
    const r = v.safeParse(EngagementPatchSchema, { status: 'in_conversation' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.output).toEqual({ status: 'in_conversation' });
  });

  it('accepts date-only next_action_at and null to clear', () => {
    const set = v.safeParse(EngagementPatchSchema, { next_action_at: '2026-09-15' });
    expect(set.success).toBe(true);
    const clear = v.safeParse(EngagementPatchSchema, { next_action_at: null });
    expect(clear.success).toBe(true);
    if (clear.success) expect(clear.output.next_action_at).toBeNull();
  });

  it('rejects a status outside the enum', () => {
    const r = v.safeParse(EngagementPatchSchema, { status: 'lead' });
    expect(r.success).toBe(false);
  });

  it('rejects a timestamped next_action_at (date-only contract)', () => {
    const r = v.safeParse(EngagementPatchSchema, {
      next_action_at: '2026-09-15T10:00:00Z',
    });
    expect(r.success).toBe(false);
  });

  it('trims the note and accepts null to clear it', () => {
    const r = v.safeParse(EngagementPatchSchema, { next_action_note: '  call back  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.output.next_action_note).toBe('call back');
    const clear = v.safeParse(EngagementPatchSchema, { next_action_note: null });
    expect(clear.success).toBe(true);
  });

  it('rejects a note over 500 chars', () => {
    const r = v.safeParse(EngagementPatchSchema, { next_action_note: 'x'.repeat(501) });
    expect(r.success).toBe(false);
  });

  it('strips unknown fields so RLS-sensitive columns cannot ride along', () => {
    const r = v.safeParse(EngagementPatchSchema, {
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
    const r = v.safeParse(EngagementPatchSchema, {});
    expect(r.success).toBe(true);
    if (r.success) expect(Object.keys(r.output)).toHaveLength(0);
  });
});

describe('status vocabulary', () => {
  it('has a label and a badge class for every enum value', () => {
    for (const s of ENGAGEMENT_STATUSES) {
      expect(STATUS_LABELS[s]).toBeTruthy();
      expect(statusBadgeClass(s)).toBe(`badge--${s.replace(/_/g, '-')}`);
    }
  });

  it('falls back to the raw value for unknown statuses', () => {
    expect(statusLabel('mystery')).toBe('mystery');
  });
});
