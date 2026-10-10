/**
 * ADR-087 · `_tasks.md § 37` — una función puede NACER colgada de su bolo.
 *
 * `create_performance` y `create_performance_series` aceptan `p_bolo_id`
 * (`20261010100000_create_performance_bolo`). La puerta es la misma que la del
 * PATCH de `bolo_id`: `edit:performance`, y la coherencia la sujeta el trigger
 * `performance_guard_bolo` (bolo vivo y del mismo proyecto, un solo 42501 para
 * «no existe» y «no es tuyo»). No pide dinero: quien coloca fechas cuelga su
 * función del trato sin leer el caché.
 *
 * `bolo_id` no se puede LEER por PostgREST (revoke de las columnas de dinero,
 * 20260720172431), así que el enlace se comprueba por donde el dinero lo
 * cuenta: `function_count` de `list_money_bolos`, igual que
 * `performance-bolo.test.ts`.
 *
 * Todo en el workspace `playwright` (`zzz-e2e-collab` y
 * `zzz-rls-foreign-project`). Autolimpiante: cada fila creada se borra y la
 * membresía de `limited` vuelve a como estaba.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeJwt,
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgRpc,
  requireEnv,
  requireLimitedEnv,
} from './_helpers';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const NOWHERE = '00000000-0000-0000-0000-000000000000';

interface Row {
  id: string;
}

interface MembershipRow {
  id: string;
  permission_grants: string[];
  permission_revokes: string[];
}

describe.skipIf(!envReady())('create_performance with p_bolo_id (ADR-087, § 37)', () => {
  let jwt: string;
  let homeProjectId: string;
  let foreignProjectId: string;
  let homeBoloId: string;
  let foreignBoloId: string;
  const perfIds: string[] = [];

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);

    const projects = await pgGet<{ id: string; slug: string }>(
      'project?select=id,slug&slug=in.(zzz-e2e-collab,zzz-rls-foreign-project)',
      jwt,
    );
    expect(projects.status).toBe(200);
    homeProjectId = projects.rows.find((p) => p.slug === 'zzz-e2e-collab')!.id;
    foreignProjectId = projects.rows.find((p) => p.slug === 'zzz-rls-foreign-project')!.id;
    expect(homeProjectId, 'fixture project zzz-e2e-collab').toBeTruthy();
    expect(foreignProjectId, 'fixture project zzz-rls-foreign-project').toBeTruthy();

    for (const [projectId, target] of [
      [homeProjectId, 'home'],
      [foreignProjectId, 'foreign'],
    ] as const) {
      const bolo = await pgRpc<Row>('create_bolo', jwt, {
        p_project_id: projectId,
        p_status: 'proposed',
        p_venue_name: `RLS create linked ${target} ${RUN}`,
      });
      expect(bolo.status, bolo.error).toBe(200);
      if (target === 'home') homeBoloId = bolo.data!.id;
      else foreignBoloId = bolo.data!.id;
    }
  });

  afterAll(async () => {
    for (const id of perfIds) await pgRpc('delete_performance', jwt, { p_performance_id: id });
    for (const id of [homeBoloId, foreignBoloId]) {
      if (id) await pgRpc('delete_bolo', jwt, { p_bolo_id: id });
    }
  });

  async function functionCount(boloId: string): Promise<number> {
    const res = await pgRpc<Array<{ id: string; function_count: number }>>(
      'list_money_bolos',
      jwt,
      { p_project_ids: null, p_workspace_ids: null, p_line_ids: null, p_from: null, p_to: null, p_limit: 500 },
    );
    expect(res.status).toBe(200);
    return (res.data ?? []).find((b) => b.id === boloId)?.function_count ?? -1;
  }

  async function create(caller: string, boloId: string | undefined, day: string) {
    const res = await pgRpc<Row & { bolo_id: string | null }>('create_performance', caller, {
      p_project_id: homeProjectId,
      p_performed_at: day,
      p_venue_name: `RLS create linked ${RUN}`,
      ...(boloId === undefined ? {} : { p_bolo_id: boloId }),
    });
    if (res.status === 200 && res.data) perfIds.push(res.data.id);
    return res;
  }

  it('is born hanging from a bolo of its own project', async () => {
    const res = await create(jwt, homeBoloId, '2027-02-01');
    expect(res.status, res.error).toBe(200);
    expect(res.data!.bolo_id).toBe(homeBoloId);
    expect(await functionCount(homeBoloId), 'the deal counts it at birth').toBe(1);
  });

  it('refuses a bolo of another project, and nothing is created', async () => {
    const before = perfIds.length;
    const res = await create(jwt, foreignBoloId, '2027-02-02');
    expect(res.status).toBe(403);
    expect(perfIds.length, 'no performance may exist after the refusal').toBe(before);
    expect(await functionCount(foreignBoloId)).toBe(0);
  });

  it('refuses a bolo that does not exist with the same answer (no oracle)', async () => {
    const missing = await create(jwt, NOWHERE, '2027-02-03');
    const foreign = await create(jwt, foreignBoloId, '2027-02-03');
    expect(missing.status).toBe(403);
    expect(foreign.status).toBe(403);
    expect(JSON.parse(missing.error!).message).toBe(JSON.parse(foreign.error!).message);
  });

  it('without a bolo it stays as it always was (the call of the deployed Worker)', async () => {
    const res = await create(jwt, undefined, '2027-02-04');
    expect(res.status, res.error).toBe(200);
    expect(res.data!.bolo_id).toBeNull();
    expect(await functionCount(homeBoloId), 'an unlinked create must not land on any deal').toBe(1);
  });

  it('a series hangs every one of its days from the same bolo', async () => {
    const res = await pgRpc<Array<Row & { bolo_id: string | null }>>('create_performance_series', jwt, {
      p_project_id: homeProjectId,
      p_performed_at: ['2027-03-01', '2027-03-02', '2027-03-03'],
      p_venue_name: `RLS create linked series ${RUN}`,
      p_bolo_id: homeBoloId,
    });
    expect(res.status, res.error).toBe(200);
    for (const p of res.data ?? []) perfIds.push(p.id);
    expect(res.data!.map((p) => p.bolo_id)).toEqual([homeBoloId, homeBoloId, homeBoloId]);
    expect(await functionCount(homeBoloId)).toBe(4);
  });

  it('a series with a foreign bolo is refused whole', async () => {
    const before = perfIds.length;
    const res = await pgRpc<Row[]>('create_performance_series', jwt, {
      p_project_id: homeProjectId,
      p_performed_at: ['2027-03-10', '2027-03-11'],
      p_venue_name: `RLS create linked series foreign ${RUN}`,
      p_bolo_id: foreignBoloId,
    });
    expect(res.status).toBe(403);
    expect(perfIds.length).toBe(before);
    expect(await functionCount(foreignBoloId)).toBe(0);
  });

  describe.skipIf(!limitedEnvReady())('the gate is edit:performance, as in the PATCH', () => {
    let limitedJwt: string;
    let membership: MembershipRow;

    beforeAll(async () => {
      const limited = requireLimitedEnv();
      limitedJwt = await login(limited.email, limited.password);
      const rows = await pgGet<MembershipRow>(
        'project_membership',
        jwt,
        new URLSearchParams({
          project_id: `eq.${homeProjectId}`,
          user_id: `eq.${String(decodeJwt(limitedJwt).sub)}`,
          select: 'id,permission_grants,permission_revokes',
        }),
      );
      expect(rows.rows).toHaveLength(1);
      membership = rows.rows[0];
    });

    afterAll(async () => {
      if (!membership) return;
      await pgPatch(
        'project_membership',
        jwt,
        {
          permission_grants: membership.permission_grants,
          permission_revokes: membership.permission_revokes,
        },
        new URLSearchParams({ id: `eq.${membership.id}` }),
      );
    });

    it('a performer without edit:performance is refused, bolo or not', async () => {
      const before = await functionCount(homeBoloId);
      expect((await create(limitedJwt, homeBoloId, '2027-04-01')).status).toBe(403);
      expect(await functionCount(homeBoloId)).toBe(before);
    });

    it('edit:performance alone is enough: no money permission is asked', async () => {
      const granted = await pgPatch(
        'project_membership',
        jwt,
        { permission_grants: ['edit:performance'], permission_revokes: [] },
        new URLSearchParams({ id: `eq.${membership.id}` }),
      );
      expect(granted.status).toBe(200);
      const money = await pgRpc<boolean>('has_permission', limitedJwt, {
        p_project_id: homeProjectId,
        p_perm: 'read:money',
      });
      expect(money.data, 'the fixture must still not read money').toBe(false);

      const before = await functionCount(homeBoloId);
      const res = await create(limitedJwt, homeBoloId, '2027-04-02');
      expect(res.status, res.error).toBe(200);
      expect(await functionCount(homeBoloId)).toBe(before + 1);
    });
  });
});

/**
 * Las funciones de trigger de `public` ya no las puede ejecutar `anon` ni
 * `authenticated` (misma migración, § 3). OJO: este test NO distingue el
 * grant. PostgREST no publica nunca una función que devuelve `trigger`, así
 * que responde 404 con o sin EXECUTE (comprobado en local antes y después de la
 * migración). Lo que el grant hace lo afirma la propia migración contra el
 * catálogo y revierte si queda alguna. Esto sujeta la otra mitad: que la
 * superficie siga cerrada por HTTP para los dos roles.
 */
describe.skipIf(!envReady())('trigger functions are not RPC', () => {
  const TRIGGER_FNS = [
    'guard_performance_bolo_same_project',
    'guard_immutable_author',
    'guard_immutable_created_by',
    'guard_immutable_note_anchor',
    'guard_immutable_task_parents',
    'guard_immutable_workspace_id',
    'maintain_conversation_contact_timestamps',
    'set_updated_at',
  ];

  it('anon and authenticated cannot call them', async () => {
    const env = requireEnv();
    const jwt = await login(env.email, env.password);
    for (const fn of TRIGGER_FNS) {
      for (const caller of [null, jwt]) {
        const res = await pgRpc(fn, caller, {});
        expect([401, 403, 404], `${fn} as ${caller ? 'authenticated' : 'anon'}`).toContain(res.status);
      }
    }
  });
});
