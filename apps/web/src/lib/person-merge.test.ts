import { describe, expect, test } from 'vitest';
import {
  canChooseKeep,
  countParts,
  fieldsPayload,
  fieldsToChoose,
  hasConflicts,
  lostEmail,
  mergeRefusal,
  resultingValue,
  shouldFlip,
  undoOpen,
  type MergeDossier,
  type MergePreview,
} from './person-merge';

const dossier = (over: Partial<MergeDossier> = {}): MergeDossier => ({
  full_name: 'Inés Ortega',
  email: 'ines@sala.example',
  phone: null,
  title: null,
  slug: 'ines-ortega',
  created_at: '2026-10-01T10:00:00Z',
  is_account: false,
  ...over,
});

const preview = (over: Partial<MergePreview> = {}): MergePreview => ({
  keep_person_id: 'k',
  drop_person_id: 'd',
  swapped: false,
  keep_is_account: false,
  keep: dossier(),
  drop: dossier({
    full_name: 'Inés Ortega Ruiz',
    email: 'ines@correo.example',
    phone: '600 000 000',
    slug: 'ines-ortega-ruiz',
    created_at: '2026-10-05T10:00:00Z',
  }),
  counts: {
    cast: 2,
    overrides: 0,
    crew: 0,
    availability: 0,
    commitments: 5,
    conversations: 1,
    mailouts: 0,
    my_notes: 3,
  },
  conflicts: {},
  ...over,
});

describe('fields to choose', () => {
  test('only where both have a value and they differ', () => {
    expect(fieldsToChoose(preview())).toEqual(['full_name', 'email']);
  });

  test('case and spaces do not make two values', () => {
    const p = preview({ drop: dossier({ full_name: ' inés ortega ', email: 'INES@sala.example' }) });
    expect(fieldsToChoose(p)).toEqual([]);
  });

  test('no file to keep yet (an account): nothing to choose', () => {
    expect(fieldsToChoose(preview({ keep: null }))).toEqual([]);
  });
});

describe('what stays in each field', () => {
  test('keep by default; drop fills what keep lacks', () => {
    const p = preview();
    expect(resultingValue(p, 'full_name', {})).toBe('Inés Ortega');
    expect(resultingValue(p, 'phone', {})).toBe('600 000 000');
    expect(resultingValue(p, 'email', { email: 'drop' })).toBe('ines@correo.example');
  });

  test('p_fields names each chosen field by person id, and only those', () => {
    expect(fieldsPayload(preview(), { email: 'drop' })).toEqual({ full_name: 'k', email: 'd' });
    // A choice on a field without two values is not sent.
    expect(fieldsPayload(preview(), { phone: 'drop' })).toEqual({ full_name: 'k', email: 'k' });
  });
});

describe('the email that stops bringing mail', () => {
  test('the one not chosen', () => {
    expect(lostEmail(preview(), {})).toBe('ines@correo.example');
    expect(lostEmail(preview(), { email: 'drop' })).toBe('ines@sala.example');
  });

  test('none when one is empty or both are the same', () => {
    expect(lostEmail(preview({ drop: dossier({ email: null }) }), {})).toBeNull();
    expect(lostEmail(preview({ drop: dossier({ email: 'Ines@Sala.example' }) }), {})).toBeNull();
  });
});

describe('counts and conflicts', () => {
  test('non-zero counts, in the said order', () => {
    expect(countParts(preview().counts)).toEqual([
      { key: 'cast', n: 2 },
      { key: 'commitments', n: 5 },
      { key: 'conversations', n: 1 },
      { key: 'my_notes', n: 3 },
    ]);
  });

  test('a conflict is any shared row', () => {
    expect(hasConflicts(preview())).toBe(false);
    expect(hasConflicts(preview({ conflicts: { cast: 0, conversations: 1 } }))).toBe(true);
  });
});

describe('which file stays by default', () => {
  test('neither an account: the older stays, so flip when drop is older', () => {
    expect(shouldFlip(preview())).toBe(false);
    expect(shouldFlip(preview({ drop: dossier({ created_at: '2026-09-01T00:00:00Z' }) }))).toBe(true);
  });

  test('an account always stays: never flip, and no choice', () => {
    const acc = preview({ keep_is_account: true, drop: dossier({ created_at: '2026-01-01T00:00:00Z' }) });
    expect(shouldFlip(acc)).toBe(false);
    expect(canChooseKeep(acc)).toBe(false);
    expect(shouldFlip(preview({ swapped: true, drop: dossier({ created_at: '2026-01-01T00:00:00Z' }) }))).toBe(
      false,
    );
    expect(canChooseKeep(preview())).toBe(true);
  });
});

describe('undo', () => {
  const now = new Date('2026-10-31T12:00:00Z');
  test('open for 30 days', () => {
    expect(undoOpen('2026-10-02T12:00:01Z', now)).toBe(true);
    expect(undoOpen('2026-10-01T12:00:00Z', now)).toBe(false);
    expect(undoOpen('not a date', now)).toBe(false);
  });
});

describe('refusals', () => {
  test('each 22023 of the RPC by its message', () => {
    expect(mergeRefusal('a person cannot be merged with itself')).toBe('same_person');
    expect(mergeRefusal('both people are accounts')).toBe('both_accounts');
    expect(mergeRefusal('fields must choose full_name, email or phone by person id')).toBe('invalid_fields');
    expect(mergeRefusal('invitation does not match this merge')).toBe('invitation_mismatch');
    expect(mergeRefusal('merge already undone')).toBe('already_undone');
    expect(mergeRefusal('merge is older than 30 days')).toBe('undo_expired');
    expect(mergeRefusal('undo the later merge first')).toBe('later_merge');
    expect(mergeRefusal(null)).toBe('invalid_input');
  });
});
