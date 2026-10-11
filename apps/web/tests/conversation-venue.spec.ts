import { test, expect } from '@playwright/test';
import { waitForLoaded } from './loaded';

const EMAIL = process.env.PW_TEST_EMAIL;
const PASSWORD = process.env.PW_TEST_PASSWORD;

/**
 * E2E — ADR-102, fase 2: la conversación es con la organización.
 *
 * 1. Desde la lente, el alta con solo la organización (sin persona) crea la
 *    conversación y la lente la enseña por su organización.
 * 2. Por la API, con la misma sesión: el segundo alta con esa organización es
 *    un 409 que nombra la primera; la búsqueda encuentra por organización y
 *    por contacto; un contacto se añade, sale en la ficha de persona y se
 *    cierra sin perder su `since`; un papel de más de 200 caracteres es 400.
 *
 * Fixture: `playwright`, proyecto `ZZZ e2e collab`; organización y persona
 * `ZZZ E2E Venue` propias. Se recoge al empezar (por si una pasada murió a
 * medias) y se borra al final; la siguiente pasada la revive. Nunca toca
 * `muk-cia`. Solo contra un origen desplegado con 20261011800000.
 */
const ORG = 'ZZZ E2E Venue';
const CONTACT = { full_name: 'ZZZ E2E Venue Contact', email: 'zzz-e2e-venue@hour.test' };

test.describe('conversation with the venue', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set PW_TEST_EMAIL / PW_TEST_PASSWORD.');

  test('create by organization, 409 names it, search, contacts, person file', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto('/h/conversations');
    await waitForLoaded(page);

    const sweep = () =>
      page.evaluate(async (org) => {
        const list = await fetch(`/api/conversations?status=any&q=${encodeURIComponent(org)}`);
        const items = ((await list.json()) as { items: Array<{ id: string; organization: { name: string } | null }> }).items;
        for (const i of items.filter((x) => x.organization?.name === org)) {
          await fetch(`/api/conversations/${i.id}`, { method: 'DELETE' });
        }
      }, ORG);
    await sweep();

    // 1. La lente: solo la organización.
    await page.getByRole('button', { name: 'Add conversation' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByLabel('ZZZ e2e collab').check({ force: true });
    await dialog.getByLabel('Organization').fill(ORG);
    await dialog.getByRole('button', { name: 'Add conversation' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder('People or organizations…').fill(ORG);
    await expect(page.locator('main')).toContainText(ORG, { timeout: 10_000 });

    // 2. La API.
    const r = await page.evaluate(
      async ({ org, contact }) => {
        const json = { 'content-type': 'application/json' };
        const find = async (q: string) =>
          ((await (await fetch(`/api/conversations?status=any&q=${encodeURIComponent(q)}`)).json()) as {
            items: Array<{
              id: string;
              project_id: string;
              workspace_id: string;
              person_id: string | null;
              organization: { name: string } | null;
              contacts: Array<{ person_id: string; since: string | null; until: string | null; role: string | null }>;
            }>;
          }).items.filter((i) => i.organization?.name === org);

        const [conv] = await find(org);
        if (!conv) return { found: false as const };

        const dup = await fetch('/api/conversations', {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ project_id: conv.project_id, organization: { name: org } }),
        });
        const dupBody = (await dup.json()) as { conversation_id?: string };

        // Un contacto nuevo (el dossier se crea con una conversación propia que se borra).
        const seed = await fetch('/api/conversations', {
          method: 'POST',
          headers: json,
          body: JSON.stringify({
            project_id: conv.project_id,
            person: { ...contact, organization_name: `${org} Seed` },
          }),
        });
        let personId: string | null = null;
        if (seed.status === 201) {
          const s = (await seed.json()) as { conversation: { id: string; person_id: string } };
          personId = s.conversation.person_id;
          await fetch(`/api/conversations/${s.conversation.id}`, { method: 'DELETE' });
        } else {
          const persons = (await (await fetch(`/api/conversations?status=any&q=${encodeURIComponent(contact.email)}`)).json()) as {
            items: Array<{ contacts: Array<{ person_id: string; person: { email: string | null } | null }> }>;
          };
          personId =
            persons.items.flatMap((i) => i.contacts).find((c) => c.person?.email === contact.email)?.person_id ?? null;
        }

        const add = await fetch(`/api/conversations/${conv.id}/contacts`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ person_id: personId, role: 'programación', since: '2026-01-01' }),
        });
        // Cambiar el papel no borra el `since`.
        const role = await fetch(`/api/conversations/${conv.id}/contacts`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ person_id: personId, role: 'dirección' }),
        });
        const long = await fetch(`/api/conversations/${conv.id}/contacts`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ person_id: personId, role: 'x'.repeat(201) }),
        });
        const byContact = await find(contact.full_name);
        const after = byContact[0]?.contacts.find((c) => c.person_id === personId);

        const close = await fetch(`/api/conversations/${conv.id}/contacts`, {
          method: 'PATCH',
          headers: json,
          body: JSON.stringify({ person_id: personId }),
        });

        const del = await fetch(`/api/conversations/${conv.id}`, { method: 'DELETE' });
        return {
          found: true as const,
          id: conv.id,
          personNull: conv.person_id === null,
          dupStatus: dup.status,
          dupId: dupBody.conversation_id ?? null,
          addStatus: add.status,
          roleStatus: role.status,
          longStatus: long.status,
          contactFound: byContact.length,
          since: after?.since ?? null,
          role: after?.role ?? null,
          closeStatus: close.status,
          delStatus: del.status,
        };
      },
      { org: ORG, contact: CONTACT },
    );

    expect(r.found).toBe(true);
    if (!r.found) return;
    expect(r.personNull).toBe(true);
    expect(r.dupStatus).toBe(409);
    expect(r.dupId).toBe(r.id);
    expect([200, 201]).toContain(r.addStatus);
    expect(r.roleStatus).toBe(200);
    expect(r.longStatus).toBe(400);
    expect(r.contactFound).toBe(1);
    expect(r.since).toBe('2026-01-01');
    expect(r.role).toBe('dirección');
    expect(r.closeStatus).toBe(200);
    expect(r.delStatus).toBeLessThan(300);
  });
});
