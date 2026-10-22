import { describe, expect, test } from 'vitest';
import * as v from 'valibot';
import ca from './i18n/ca.json';
import en from './i18n/en.json';
import es from './i18n/es.json';
import fr from './i18n/fr.json';
import {
  BULK_MAX,
  BULK_REASONS,
  BulkSchema,
  bulkBodies,
  bulkDoneTitle,
  bulkFailedLine,
  restoreBodies,
  runBulk,
  type BulkRequest,
} from './conversation-bulk';

const id = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('the bulk contract', () => {
  test('a body takes at most BULK_MAX ids, and at least one', () => {
    const ids = Array.from({ length: BULK_MAX + 1 }, (_, i) => id(i));
    expect(v.safeParse(BulkSchema, { action: 'settle', ids: ids.slice(0, BULK_MAX) }).success).toBe(true);
    expect(v.safeParse(BulkSchema, { action: 'settle', ids }).success).toBe(false);
    expect(v.safeParse(BulkSchema, { action: 'settle', ids: [] }).success).toBe(false);
  });

  test('a restore writes only the whitelisted columns', () => {
    const r = v.safeParse(BulkSchema, {
      action: 'restore',
      items: [{ id: id(1), columns: { not_now_at: null, project_id: id(9), private_to: id(9) } }],
    });
    expect(r.success).toBe(true);
    expect((r.output as Extract<BulkRequest, { action: 'restore' }>).items[0].columns).toEqual({ not_now_at: null });
  });

  test('a tag key follows the column CHECK', () => {
    expect(v.safeParse(BulkSchema, { action: 'tag', ids: [id(1)], key: 'press', op: 'add' }).success).toBe(true);
    expect(v.safeParse(BulkSchema, { action: 'tag', ids: [id(1)], key: 'Press!', op: 'add' }).success).toBe(false);
  });

  test('a selection is cut into bodies, without repeats', () => {
    const ids = Array.from({ length: 45 }, (_, i) => id(i));
    const bodies = bulkBodies({ action: 'not_now', until: null }, [...ids, id(0)]);
    expect(bodies.map((b) => (b as { ids: string[] }).ids.length)).toEqual([20, 20, 5]);
    expect(restoreBodies(ids.map((x) => ({ id: x, columns: {} }))).length).toBe(3);
  });
});

describe('runBulk', () => {
  test('joins the parts in order; a part that throws counts its ids as error and the rest goes on', async () => {
    const bodies = bulkBodies({ action: 'settle' }, Array.from({ length: 50 }, (_, i) => id(i)));
    const r = await runBulk(bodies, async (body) => {
      const ids = (body as { ids: string[] }).ids;
      if (ids[0] === id(20)) throw new Error('network');
      return { done: ids, failed: [], undo: ids.map((x) => ({ id: x, columns: { reply_settled_at: null } })) };
    });
    expect(r.done).toEqual([...Array.from({ length: 20 }, (_, i) => id(i)), ...Array.from({ length: 10 }, (_, i) => id(40 + i))]);
    expect(r.failed).toHaveLength(20);
    expect(r.failed.every((f) => f.reason === 'error')).toBe(true);
    expect(r.undo).toHaveLength(30);
  });
});

describe('the words', () => {
  test('every word exists in the four languages (the keys are built, so the keys guard cannot see them)', () => {
    const keys = [
      ...['not_now', 'next_step', 'settle', 'tag'].flatMap((a) => [`bulk.done_${a}_one`, `bulk.done_${a}_other`]),
      ...BULK_REASONS.map((r) => `bulk.reason_${r}`),
    ];
    for (const dict of [ca, en, es, fr] as Record<string, string>[]) {
      for (const k of keys) expect(dict[k], k).toBeTruthy();
    }
  });

  test('the toast says how many could not, and why', () => {
    expect(bulkDoneTitle('not_now', 3, 'es')).toBe('3 en «no esta vez»');
    expect(bulkFailedLine({ failed: [] }, 'es')).toBeNull();
    expect(
      bulkFailedLine(
        {
          failed: [
            { id: id(1), reason: 'forbidden' },
            { id: id(2), reason: 'not_found' },
            { id: id(3), reason: 'forbidden' },
          ],
        },
        'es',
      ),
    ).toBe('3 no se han podido: 1 ya no está · 2 sin permiso para editar');
  });
});
