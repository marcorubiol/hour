import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { waitForLoaded } from './loaded';

/**
 * ADR-138 § 6, the Planner's margin (plan § 8.4, phase E3).
 *
 * Lo que fija:
 *   - la Agenda y el Día dicen en el margen el próximo paso de una
 *     conversación y una tarea con fecha, y cada línea abre su sitio; la
 *     conversación no se dibuja en la rejilla;
 *   - el Mes dice un número en ese día, que abre el Día; la Temporada, igual;
 *   - desde la conversación, «Ver en el Planner» abre la Agenda con el
 *     proyecto fijado.
 *
 * En el espacio `playwright`, en `zzz-e2e-collab`, con una conversación y una
 * tarea del propio spec (nunca `muk-cia`). Autolimpiante: las borra al acabar.
 *
 * Contra un origen desplegado (PW_BASE_URL) o `vite dev` con su Supabase;
 * nunca contra `vite preview`.
 */

if (existsSync('.env')) loadEnvFile('.env');

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const VENUE = `E2E Margen ${RUN}`;
const TASK = `ZZZ E2E Tarea margen ${RUN}`;

type Helpers = typeof import('./rls/_helpers');
const one = <T>(d: T | T[] | null): T => (Array.isArray(d) ? d[0] : d)!;

/** Two days from today, in the local calendar (browser and runner share it). */
function stepDay(): string {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test.describe('el margen del Planner (ADR-138 § 6)', () => {
  test.skip(!EMAIL || !PASSWORD || !process.env.PUBLIC_SUPABASE_URL, 'Set PW_TEST_* and PUBLIC_SUPABASE_*.');
  test.describe.configure({ mode: 'serial' });

  let h: Helpers;
  let jwt = '';
  let convId = '';
  let projectId = '';
  let taskId = '';
  const day = stepDay();

  test.beforeAll(async () => {
    test.setTimeout(60_000);
    h = await import('./rls/_helpers');
    jwt = await h.login(EMAIL!, PASSWORD!);
    const project = await h.pgGet<{ id: string; workspace_id: string }>(
      'project',
      jwt,
      new URLSearchParams({ slug: 'eq.zzz-e2e-collab', select: 'id,workspace_id' }),
    );
    projectId = project.rows[0].id;
    const conv = await h.pgRpc<{ id: string }>('create_conversation', jwt, {
      p_project_id: projectId,
      p_organization_name: VENUE,
      p_full_name: `${VENUE} contacto`,
      p_email: `e2e-margen-${RUN}@example.test`,
    });
    expect(conv.status, conv.error).toBe(200);
    convId = one(conv.data).id;
    const patch = await h.pgPatch(
      'conversation',
      jwt,
      { private_to: null, next_action_at: day, next_action_note: 'margen' },
      new URLSearchParams({ id: `eq.${convId}` }),
    );
    expect(patch.status).toBeLessThan(300);
    expect(patch.rows, "the next step was written").toHaveLength(1);
    // Tasks are written by RPC only (ADR-048): the direct INSERT is closed.
    const task = await h.pgRpc<{ id: string }>('create_task', jwt, {
      p_title: TASK,
      p_note: null,
      p_due_at: day,
      p_from_at: null,
      p_lead_days: null,
      p_workspace_id: null,
      p_project_id: projectId,
      p_line_id: null,
      p_performance_id: null,
      p_conversation_id: null,
    });
    expect(task.status, task.error).toBe(200);
    taskId = one(task.data).id;
  });

  test.afterAll(async () => {
    if (!h) return;
    if (convId) await h.pgRpc('delete_conversation', jwt, { p_conversation_id: convId });
    if (taskId) await h.pgRpc('delete_task', jwt, { p_task_id: taskId });
  });

  async function open(page: Page, url: string) {
    await page.goto(url);
    await waitForLoaded(page);
  }

  test('la Agenda dice el paso en el margen del día, y la conversación no entra en la rejilla', async ({ page }) => {
    test.setTimeout(60_000);
    await open(page, `/h/planner?view=agenda&d=${day}&scope=s:playwright`);
    const theDay = page.locator(`.ag__day[data-day="${day}"]`);
    const steps = theDay.getByTestId('planner-steps');
    await expect(steps).toContainText(VENUE, { timeout: 15_000 });
    await expect(steps).toContainText(TASK);
    await expect(steps.getByRole('link', { name: new RegExp(VENUE) })).toHaveAttribute(
      'href',
      new RegExp(`/conversation/${convId}$`),
    );
    // The margin is not the grid: the day's rows do not draw it.
    await expect(theDay.locator('.ag__rows')).not.toContainText(VENUE);
  });

  test('el Día lo dice en su pie, y la línea abre la conversación', async ({ page }) => {
    test.setTimeout(60_000);
    await open(page, `/h/planner?view=day&d=${day}&scope=s:playwright`);
    const steps = page.getByTestId('planner-steps');
    await expect(steps).toContainText(VENUE, { timeout: 15_000 });
    await steps.getByRole('link', { name: new RegExp(VENUE) }).click();
    // It opens in the vistazo over the Day (ADR-139 p1), and the address says which.
    await expect(page.getByTestId('peek')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(new RegExp(`peek=conversation%2F[^&]+%2F${convId}`));
  });

  test('el Mes dice un número en ese día, que abre el Día', async ({ page }) => {
    test.setTimeout(60_000);
    await open(page, `/h/planner?view=month&ym=${day.slice(0, 7)}&scope=s:playwright`);
    const count = page.locator(`[data-testid="month-steps"][data-day="${day}"]`);
    await expect(count).toHaveText(/^\d+ (steps|pasos|passos|étapes)$/, { timeout: 15_000 });
    await count.click();
    await expect(page).toHaveURL(new RegExp(`view=day.*d=${day}|d=${day}.*view=day`));
    await expect(page.getByTestId('planner-steps')).toContainText(VENUE, { timeout: 15_000 });
  });

  test('la Temporada, un número en la casilla del día', async ({ page }) => {
    test.setTimeout(60_000);
    await open(page, `/h/planner?view=overview&scope=s:playwright`);
    await expect(page.locator(`.d[data-day="${day}"]`).getByTestId('season-steps')).toBeVisible({ timeout: 15_000 });
  });

  test('desde la conversación, «Ver en el Planner» abre la Agenda con el proyecto fijado', async ({ page }) => {
    test.setTimeout(60_000);
    await open(page, `/h/playwright/conversation/${convId}`);
    const link = page.getByTestId('conversation-planner');
    await expect(link).toHaveAttribute('href', `/h/planner?view=agenda&scope=p:${projectId}`);
    await link.click();
    await expect(page).toHaveURL(/view=agenda/);
    // The shell applies the pin and writes it back in its own form.
    await expect(page).toHaveURL(/scope=p:/);
    await waitForLoaded(page);
    // Without a bolo the book opens on today, and its first stretch is this
    // month: on the month's last two days the step lies past it.
    test.skip(day.slice(0, 7) !== new Date().toISOString().slice(0, 7), 'the step falls in next month');
    await expect(page.locator(`.ag__day[data-day="${day}"]`).getByTestId('planner-steps')).toContainText(VENUE, {
      timeout: 15_000,
    });
  });
});
