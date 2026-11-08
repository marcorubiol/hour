import { test, expect, type Page } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;
const SB_URL = process.env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * E2E: la invitación con diseño (tarea 99, ADR-190). Escrito sin correr: lo
 * corre el coordinador contra un origen desplegado tras aplicar la migración
 * 20261108120000. No sale ningún correo (solo un borrador, sin destinatarios).
 *
 * Solo en el espacio `playwright`. Recorrido: una invitación en borrador por
 * la API → «Con diseño» abre el editor (Templatical) con la carta como
 * primeros bloques → «Listo» compila en el navegador y guarda → la tarjeta
 * «Diseño» y el borrador guardado; la API devuelve el JSON, el HTML sin
 * scripts y el cuerpo derivado con sus campos → el servidor rechaza un bloque
 * fuera de la paleta y una imagen de fuera → «Volver a carta» lo borra y deja
 * el texto.
 */

const RUN = Date.now().toString(36);

async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  return page.evaluate(
    async ([m, p, b]) => {
      const r = await fetch(p as string, {
        method: m as string,
        headers: { 'content-type': 'application/json' },
        body: b === undefined ? undefined : JSON.stringify(b),
      });
      const text = await r.text();
      return { status: r.status, data: (text ? JSON.parse(text) : null) as T };
    },
    [method, path, body] as const,
  );
}

async function serviceDelete(path: string): Promise<void> {
  const res = await fetch(new URL(`/rest/v1/${path}`, SB_URL), {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`DELETE ${path} ${res.status}: ${await res.text()}`);
}

type Detail = {
  mailout: {
    subject: string | null;
    body: string | null;
    language: string;
    from_local_part: string;
    from_name: string | null;
    mail_domain_id: string | null;
    design: { blocks: unknown[] } | null;
    design_html: string | null;
  };
};

test.describe('designed invitation (ADR-190)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('letter → designed in the editor → saved, checked, derived text → back to letter', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/h/conversations?view=envios');
    await waitForLoaded(page);

    const workspaces = await api<{ items: { id: string; slug: string }[] }>(page, 'GET', '/api/workspaces');
    const workspaceId = workspaces.data.items.find((w) => w.slug === 'playwright')!.id;
    const created = await api<{ id: string }>(page, 'POST', '/api/mailout/invitation', { workspace_id: workspaceId });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    const mailoutId = created.data.id;

    try {
      await page.goto(`/h/playwright/mailout/${mailoutId}`);
      const mo = page.getByTestId('mailout');
      await expect(mo).toBeVisible({ timeout: 15_000 });

      await mo.getByLabel(/^(Subject|Asunto|Assumpte|Objet)$/).fill(`E2E diseño ${RUN}`);
      await mo.locator('#mailout-body').fill('Hola, {nombre}:\n\nEstrenamos en {sala}.');
      await expect(mo).toContainText(/Draft saved|Borrador guardado|Esborrany desat|Brouillon enregistré/, { timeout: 10_000 });

      // ── «Con diseño» abre el editor con la carta dentro ──
      const format = mo.getByTestId('mailout-format');
      await format.locator('label', { hasText: /Designed|Con diseño|Amb disseny|Mis en page/ }).click();
      const editor = page.getByTestId('mail-design-editor');
      await expect(editor).toBeVisible();
      const done = editor.getByRole('button', { name: /^(Done|Listo|Fet|Terminé)$/ });
      await expect(done).toBeEnabled({ timeout: 30_000 });

      const saved = page.waitForResponse(
        (r) => r.request().method() === 'PATCH' && r.url().endsWith(`/api/mailout/${mailoutId}`) && (r.request().postData() ?? '').includes('"design":{'),
      );
      await done.click();
      expect((await saved).status()).toBe(200);
      await expect(editor).toBeHidden();
      await expect(mo.getByTestId('mailout-design')).toBeVisible();

      // ── Lo guardado: JSON, HTML limpio con sus campos, texto derivado ──
      const after = await api<Detail>(page, 'GET', `/api/mailout/${mailoutId}`);
      expect(after.data.mailout.design?.blocks.length ?? 0).toBeGreaterThan(0);
      expect(after.data.mailout.design_html).toContain('{nombre}');
      expect(after.data.mailout.design_html).not.toMatch(/<script/i);
      expect(after.data.mailout.body).toContain('Hola, {nombre}:');
      expect(after.data.mailout.body).toContain('{sala}');

      // ── El servidor no acepta lo que la paleta no ofrece ──
      const m = after.data.mailout;
      const base = {
        subject: m.subject ?? '',
        body: m.body ?? '',
        language: m.language,
        mail_domain_id: m.mail_domain_id,
        from_local_part: m.from_local_part,
        from_name: m.from_name,
      };
      const html = { ...base, design: { content: { blocks: [{ type: 'html', content: '<b>x</b>' }], settings: {} }, html: '<p>x</p>' } };
      const r1 = await api<{ error: string }>(page, 'PATCH', `/api/mailout/${mailoutId}`, html);
      expect(r1.status).toBe(400);
      expect(r1.data.error).toBe('design_block');
      const outside = {
        ...base,
        design: {
          content: { blocks: [{ type: 'image', src: 'https://example.com/x.png' }, { type: 'paragraph', content: '<p>x</p>' }], settings: {} },
          html: '<p>x</p>',
        },
      };
      const r2 = await api<{ error: string }>(page, 'PATCH', `/api/mailout/${mailoutId}`, outside);
      expect(r2.status).toBe(400);
      expect(r2.data.error).toBe('design_image');

      // ── Volver a carta: el diseño se borra, el texto se queda ──
      await mo.getByRole('button', { name: /^(Back to letter|Volver a carta|Tornar a carta|Revenir à la lettre)$/ }).click();
      const back = page.waitForResponse(
        (r) => r.request().method() === 'PATCH' && r.url().endsWith(`/api/mailout/${mailoutId}`) && (r.request().postData() ?? '').includes('"design":null'),
      );
      await page.getByRole('dialog').getByRole('button', { name: /^(Back to letter|Volver a carta|Tornar a carta|Revenir à la lettre)$/ }).click();
      expect((await back).status()).toBe(200);
      await expect(mo.locator('#mailout-body')).toHaveValue(/Hola, \{nombre\}:/);
      const letter = await api<Detail>(page, 'GET', `/api/mailout/${mailoutId}`);
      expect(letter.data.mailout.design).toBeNull();
      expect(letter.data.mailout.design_html).toBeNull();
    } finally {
      // Ninguna RPC borra un envío en borrador: lo hace la clave de servicio.
      if (SB_URL && SERVICE_KEY) await serviceDelete(`mailout?id=eq.${mailoutId}`);
    }
  });
});
