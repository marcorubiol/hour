/**
 * RLS regression — the fee must not be directly selectable.
 *
 * Money v2 masked the fee with the `performance_redacted` view. ADR-087 moved
 * the fee onto the `bolo` table, and the view was retired — the fee is now
 * guarded by row-level RLS on `bolo` (read:money), not a masked column. The
 * anon canary here MUST stay green forever: the legacy view stays gone, and
 * anon reads zero rows from the base money/scheduling tables (bolo included).
 */

import { describe, expect, test } from 'vitest';
import { envReady, pgGet } from './_helpers';

describe.skipIf(!envReady())('RLS — fee column isolation', () => {
  test('the legacy redacted view is gone from the Data API', async () => {
    const result = await pgGet<{ id: string }>(
      'performance_redacted',
      null,
      new URLSearchParams({ select: 'id', limit: '5' }),
    );
    expect(result.status).toBeGreaterThanOrEqual(400);
  });

  test('anon reads zero rows from bolo, performance and date base tables', async () => {
    for (const table of ['bolo', 'performance', 'date']) {
      const { rows } = await pgGet<{ id: string }>(
        table,
        null,
        new URLSearchParams({ select: 'id', limit: '5' }),
      );
      expect(rows).toHaveLength(0);
    }
  });
});
