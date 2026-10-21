import type { Page } from '@playwright/test';

/**
 * A SPEC TAKES BACK WHAT IT MADE, ALSO THE ORGANIZATION AND THE CONTACTS.
 *
 * Deleting a conversation used to leave its organization and its contacts'
 * dossiers alive, and `playwright` grew by about twelve of each per pass (204
 * organizations and 164 people hidden by hand on 2026-10-21). These two helpers
 * replace a spec's bare conversation delete: they read the conversation first,
 * delete it, and then soft-delete its organization and every contact.
 *
 * - Only in the `playwright` workspace. The E2E login is admin of `muk-cia`,
 *   whose directory is real (memory: e2e-writes-to-real-data).
 * - The base refuses (409) an organization or a person that something live
 *   still uses, so a shared fixture contact or another spec's row stays.
 * - Behind migration `20261021200000_delete_organization_person`: until it is
 *   applied the two deletes answer an error and nothing else moves, so the
 *   cleanup never fails a spec over it.
 */

const WORKSPACE = 'playwright';

/** In the page, through the app's API (the session cookie). */
export async function forgetConversations(page: Page, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await page.evaluate(
    async ({ ids, ws }) => {
      type Item = {
        workspace_id: string;
        workspace?: { slug: string } | null;
        organization?: { id: string } | null;
        contacts?: { person_id: string }[];
      };
      for (const id of ids) {
        const r = await fetch(`/api/conversations/${id}`);
        const item = r.ok ? ((await r.json()) as { item: Item }).item : null;
        await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
        if (!item || item.workspace?.slug !== ws) continue;
        for (const c of item.contacts ?? []) {
          await fetch(`/api/persons/${c.person_id}?workspace_id=${item.workspace_id}`, { method: 'DELETE' });
        }
        if (item.organization?.id) {
          await fetch(`/api/organizations/${item.organization.id}`, { method: 'DELETE' });
        }
      }
    },
    { ids, ws: WORKSPACE },
  );
}

type Helpers = typeof import('./rls/_helpers');

/** From Node, through PostgREST with a JWT (the specs that drive the RPCs). */
export async function forgetConversationsRpc(h: Helpers, jwt: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    const row = await h.pgGet<{
      workspace_id: string;
      organization_id: string | null;
      workspace: { slug: string } | null;
      contacts: { person_id: string }[];
    }>(
      'conversation',
      jwt,
      new URLSearchParams({
        select: 'workspace_id,organization_id,workspace:workspace_id(slug),contacts:conversation_contact(person_id)',
        id: `eq.${id}`,
      }),
    );
    await h.pgRpc('delete_conversation', jwt, { p_conversation_id: id });
    const c = row.rows[0];
    if (!c || c.workspace?.slug !== WORKSPACE) continue;
    for (const p of c.contacts ?? []) {
      await h.pgRpc('delete_workspace_person', jwt, { p_workspace_id: c.workspace_id, p_person_id: p.person_id });
    }
    if (c.organization_id) {
      await h.pgRpc('delete_workspace_organization', jwt, { p_organization_id: c.organization_id });
    }
  }
}
