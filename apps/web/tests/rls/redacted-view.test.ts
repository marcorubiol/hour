/**
 * RLS regression — fee columns must not be directly selectable.
 *
 * 2026-05-18_rls_findings_fix applied `security_invoker = true` to the
 * view; the 2026-05-19 recreations (section revert + show→performance
 * rename) silently dropped it, restoring definer semantics: anon could
 * read every workspace's performances through the view (verified live
 * 2026-07-02). The fix migration is
 * build/migrations/2026-07-02_fix_performance_redacted_security_invoker.sql.
 *
 * The anon test here is the canary: it MUST stay green forever. If the
 * view is ever recreated again without `security_invoker = true` (or the
 * anon grant returns), this turns red.
 */

import { describe, expect, test } from 'vitest';
import { envReady, pgGet } from './_helpers';

describe.skipIf(!envReady())('RLS — fee column isolation', () => {
  test('the legacy redacted view is not exposed through the Data API', async () => {
    const result = await pgGet<{ id: string }>(
      'performance_redacted',
      null,
      new URLSearchParams({ select: 'id', limit: '5' }),
    );
    expect(result.status).toBeGreaterThanOrEqual(400);
  });

  test('anon reads zero rows from performance and date base tables', async () => {
    for (const table of ['performance', 'date']) {
      const { rows } = await pgGet<{ id: string }>(
        table,
        null,
        new URLSearchParams({ select: 'id', limit: '5' }),
      );
      expect(rows).toHaveLength(0);
    }
  });
});
