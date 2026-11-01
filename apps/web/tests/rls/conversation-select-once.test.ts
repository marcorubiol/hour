import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgRpc,
  projectAccess,
  requireEnv,
  requireLimitedEnv,
  restoreProjectAccess,
  setFacets,
  type ProjectAccess,
} from './_helpers';

/**
 * ADR-160 · `conversation_select` resuelve los proyectos una vez por consulta
 * (20261101100000_conversation_select_once).
 *
 * La política deja de llamar a `has_permission` por fila y compara con
 * `accessible_project_ids('read:conversation')`. Lo que fija este fichero es
 * que se ve exactamente lo mismo que antes:
 *   - con Converses en el proyecto se ve, sin Converses no, y en los dos casos
 *     ver la fila es lo que dice `has_permission`;
 *   - una privada de otra persona no se ve, la propia sí;
 *   - la conversación de un proyecto borrado no se ve;
 *   - la de un espacio ajeno no se ve.
 * Y que las tablas hijas (eventos, contactos, etiquetas), cuyas políticas son
 * `EXISTS (… conversation …)`, siguen lo mismo que su conversación.
 *
 * Fixture: `playwright`, proyecto `zzz-e2e-collab` y un proyecto
 * `zzz-rls-select-once-gone`, borrado entre pasadas (lo revive y lo vuelve a
 * borrar la clave de servicio). Deja las conversaciones borradas y el acceso
 * del limitado como estaba.
 */
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const GONE_SLUG = 'zzz-rls-select-once-gone';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface ConversationRow {
  id: string;
  private_to: string | null;
}

const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

/** Una lectura o escritura con la clave de servicio: solo para preparar la fixture. */
async function service(path: string, init: RequestInit = {}): Promise<Response> {
  const { url, anon } = requireEnv();
  return fetch(new URL(`/rest/v1/${path}`, url), {
    ...init,
    headers: {
      apikey: SERVICE!.startsWith('eyJ') ? anon : SERVICE!,
      Authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  });
}

async function setProjectDeleted(id: string, deleted: boolean): Promise<void> {
  const res = await service(`project?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ deleted_at: deleted ? new Date().toISOString() : null }),
  });
  expect(res.ok, `service PATCH project: ${res.status}`).toBe(true);
}

describe.skipIf(!envReady() || !limitedEnvReady() || !SERVICE)(
  'conversation_select resolves the projects once and sees what it saw (ADR-160)',
  () => {
    let admin: string;
    let adminSub: string;
    let limited: string;
    let limitedSub: string;
    let workspaceId: string;
    let projectId: string;
    let goneProjectId: string | null = null;
    let snapshot: ProjectAccess;
    const live: string[] = [];
    let created = 0;

    async function create(project: string, label: string): Promise<ConversationRow> {
      const n = ++created;
      const r = await pgRpc<ConversationRow>('create_conversation', admin, {
        p_project_id: project,
        p_full_name: `ZZZ RLS Select Once ${label} ${RUN} ${n}`,
        p_email: `zzz-rls-select-once-${label}-${RUN}-${n}@hour.test`,
      });
      expect(r.status, r.error).toBe(200);
      const row = one(r.data)!;
      live.push(row.id);
      return row;
    }

    async function sees(jwt: string, id: string): Promise<boolean> {
      const r = await pgGet<{ id: string }>('conversation', jwt, new URLSearchParams({ id: `eq.${id}`, select: 'id' }));
      expect(r.status).toBe(200);
      return r.rows.length === 1;
    }

    async function hasRead(jwt: string, project: string): Promise<boolean> {
      const r = await pgRpc<boolean>('has_permission', jwt, { p_project_id: project, p_perm: 'read:conversation' });
      expect(r.status, r.error).toBe(200);
      return r.data === true;
    }

    /** What the child tables show of one conversation: they follow it. */
    async function childrenSeen(jwt: string, id: string): Promise<number> {
      let n = 0;
      for (const table of ['conversation_contact', 'conversation_event', 'conversation_tagging']) {
        const r = await pgGet(table, jwt, new URLSearchParams({ conversation_id: `eq.${id}`, select: 'conversation_id' }));
        expect(r.status).toBe(200);
        n += r.rows.length;
      }
      return n;
    }

    beforeAll(async () => {
      const env = requireEnv();
      admin = await login(env.email, env.password);
      adminSub = String(decodeJwt(admin).sub);
      const lim = requireLimitedEnv();
      limited = await login(lim.email, lim.password);
      limitedSub = String(decodeJwt(limited).sub);
      const p = await pgGet<{ id: string; workspace_id: string }>(
        'project',
        admin,
        new URLSearchParams({
          select: 'id,workspace_id,workspace:workspace_id!inner(slug)',
          'workspace.slug': 'eq.playwright',
          slug: 'eq.zzz-e2e-collab',
          deleted_at: 'is.null',
          limit: '1',
        }),
      );
      if (p.rows.length === 0) throw new Error('zzz-e2e-collab missing in playwright');
      projectId = p.rows[0]!.id;
      workspaceId = p.rows[0]!.workspace_id;
      snapshot = await projectAccess(admin, projectId, limitedSub);
    });

    afterAll(async () => {
      if (goneProjectId) await setProjectDeleted(goneProjectId, false).catch(() => undefined);
      for (const id of [...live]) await pgRpc('delete_conversation', admin, { p_conversation_id: id }).catch(() => undefined);
      if (goneProjectId) await setProjectDeleted(goneProjectId, true).catch(() => undefined);
      await restoreProjectAccess(admin, projectId, limitedSub, snapshot);
    });

    test('with Converses it is seen, without it is not, and seeing is what has_permission says', async () => {
      const shared = await create(projectId, 'shared');
      expect(shared.private_to).toBeNull();

      await setFacets(admin, snapshot.membershipId, { converses: 'view' });
      expect(await hasRead(limited, projectId)).toBe(true);
      expect(await sees(limited, shared.id)).toBe(true);
      expect(await childrenSeen(limited, shared.id)).toBe(await childrenSeen(admin, shared.id));

      await setFacets(admin, snapshot.membershipId, { converses: null });
      const can = await hasRead(limited, projectId);
      expect(await sees(limited, shared.id)).toBe(can);
      if (!can) expect(await childrenSeen(limited, shared.id)).toBe(0);
    });

    test('someone else\'s private conversation is not seen; your own is', async () => {
      await setFacets(admin, snapshot.membershipId, { converses: 'view' });
      const mine = await create(projectId, 'private');
      const patched = await pgPatch<ConversationRow>(
        'conversation',
        admin,
        { private_to: adminSub },
        new URLSearchParams({ id: `eq.${mine.id}`, select: 'id,private_to' }),
      );
      expect(patched.rows[0]?.private_to).toBe(adminSub);
      expect(await sees(admin, mine.id)).toBe(true);
      expect(await sees(limited, mine.id)).toBe(false);
      expect(await childrenSeen(limited, mine.id)).toBe(0);
    });

    test('a conversation of a deleted project is not seen', async () => {
      // The project, revived for the run (or created the first time).
      const existing = await service(`project?slug=eq.${GONE_SLUG}&workspace_id=eq.${workspaceId}&select=id`);
      const rows = (await existing.json()) as { id: string }[];
      if (rows[0]) {
        goneProjectId = rows[0].id;
        await setProjectDeleted(goneProjectId, false);
      } else {
        const r = await pgRpc<{ id: string }>('create_project', admin, {
          p_workspace_id: workspaceId,
          p_name: 'ZZZ RLS Select Once Gone',
          p_slug: GONE_SLUG,
        });
        expect(r.status, r.error).toBe(200);
        goneProjectId = one(r.data)!.id;
      }
      const inGone = await create(goneProjectId!, 'gone');
      expect(await sees(admin, inGone.id)).toBe(true);

      await setProjectDeleted(goneProjectId!, true);
      expect(await hasRead(admin, goneProjectId!)).toBe(false);
      expect(await sees(admin, inGone.id)).toBe(false);
      expect(await childrenSeen(admin, inGone.id)).toBe(0);
    });

    test('a conversation of another workspace is not seen', async () => {
      const res = await service(`conversation?workspace_id=neq.${workspaceId}&deleted_at=is.null&private_to=is.null&select=id,project_id&limit=1`);
      const [foreign] = (await res.json()) as { id: string; project_id: string }[];
      if (!foreign) return; // no other workspace has conversations: nothing to cross
      expect(await hasRead(admin, foreign.project_id)).toBe(false);
      expect(await sees(admin, foreign.id)).toBe(false);
      expect(await sees(limited, foreign.id)).toBe(false);
    });
  },
);
