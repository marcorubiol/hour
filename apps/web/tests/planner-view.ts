import { expect, type APIRequestContext } from '@playwright/test';

/**
 * THE E2E USER OPENS THE PLANNER IN THE SEASON, UNTIL A SPEC SAYS OTHERWISE.
 *
 * ADR-192 made the drawing the Planner opens in a stored preference
 * (`membership.planner_view`), written whenever a drawing is picked in the
 * bar. The suite signs in as one user, so a spec that picks the Month left
 * every later `/h/planner` without `?view=` on the Month, in this run and the
 * next (2026-11-11: the season specs went red after the overview spec's
 * click). The auth setup calls this once per run, and a spec that picks a
 * drawing calls it again when it is done, so the state every spec meets is
 * the default: null, the season.
 */
export async function forgetPlannerView(request: APIRequestContext): Promise<void> {
  const res = await request.get('/api/workspaces');
  expect(res.ok(), `GET /api/workspaces answered ${res.status()}`).toBe(true);
  const { items } = (await res.json()) as { items: { id: string; planner_view?: string | null }[] };
  for (const w of items) {
    if (!w.planner_view) continue;
    const put = await request.put('/api/me/planner-view', {
      data: { workspace_id: w.id, planner_view: null },
    });
    expect(put.ok(), `the stored drawing of ${w.id} could not be forgotten (${put.status()})`).toBe(true);
  }
}
