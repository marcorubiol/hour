/**
 * ADR-087 — una función solo cuelga de un bolo de SU proyecto.
 *
 * `performance.bolo_id` es la costura entre el calendario y el dinero, y hasta
 * el 2026-08-28 lo único que la sujetaba era la FK a `bolo(id)`: bastaba con
 * que el bolo existiera. `authenticated` tiene GRANT UPDATE sobre todas las
 * columnas de `performance` —no hay grant por columna— así que cualquiera con
 * `edit:performance` podía colgar su función de un bolo de otro proyecto, o de
 * otro ESPACIO con el UUID en la mano, y moverle a un tercero el
 * `function_count` y el `next_performed_at` sin tocar una fila suya.
 *
 * Lo sujeta ahora el trigger `performance_guard_bolo`
 * (`20260828100000_guard_performance_bolo_same_project`). Este fichero va ROJO
 * contra un origen donde esa migración no esté aplicada — y ese rojo es la
 * demostración del agujero, no un fallo del test.
 *
 * NO ESTRECHA PERMISOS: la puerta sigue siendo `edit:performance`, para que
 * quien coloca fechas pueda colgarlas de su trato sin leer el caché. Lo que
 * añade es la coherencia.
 *
 * Todo ocurre en el workspace `playwright`, entre sus DOS proyectos
 * (`zzz-e2e-collab` y `zzz-rls-foreign-project`, que existe justo para esto).
 * Autolimpiante: cada fila creada se borra en afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { envReady, login, pgGet, pgRpc, requireEnv } from './_helpers';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const NOWHERE = '00000000-0000-0000-0000-000000000000';

interface Row {
  id: string;
}

describe.skipIf(!envReady())('performance ↔ bolo — same project only (ADR-087)', () => {
  let jwt: string;
  let homeProjectId: string;
  let foreignProjectId: string;
  let perfId: string;
  let homeBoloId: string;
  let foreignBoloId: string;

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

    const perf = await pgRpc<Row>('create_performance', jwt, {
      p_project_id: homeProjectId,
      p_performed_at: '2027-01-15',
      p_status: 'proposed',
      p_venue_name: `RLS bolo guard ${RUN}`,
    });
    expect(perf.status, perf.error).toBe(200);
    perfId = perf.data!.id;

    for (const [projectId, target] of [
      [homeProjectId, 'home'],
      [foreignProjectId, 'foreign'],
    ] as const) {
      const bolo = await pgRpc<Row>('create_bolo', jwt, {
        p_project_id: projectId,
        p_status: 'proposed',
        p_venue_name: `RLS bolo guard ${target} ${RUN}`,
      });
      expect(bolo.status, bolo.error).toBe(200);
      if (target === 'home') homeBoloId = bolo.data!.id;
      else foreignBoloId = bolo.data!.id;
    }
  });

  afterAll(async () => {
    if (perfId) await pgRpc('delete_performance', jwt, { p_performance_id: perfId });
    for (const id of [homeBoloId, foreignBoloId]) {
      if (id) await pgRpc('delete_bolo', jwt, { p_bolo_id: id });
    }
  });

  /**
   * NO `pgPatch` AQUÍ, y el motivo es la mitad de lo que este fichero enseña.
   *
   * El helper pide `Prefer: return=representation`, o sea que PostgREST
   * devuelve la fila entera — y `20260720172431` retiró del GRANT de SELECT las
   * columnas de dinero, `bolo_id` entre ellas. Así que CUALQUIER enlace por
   * `pgPatch` responde 403 «permission denied for table performance» **antes de
   * llegar a la regla**. La primera versión de este test usaba el helper y
   * estaba verde: rechazaba el bolo ajeno, sí, pero por el grant de lectura y
   * no por la guarda. Un test verde por el motivo equivocado es peor que rojo.
   *
   * `return=minimal` no devuelve fila, así que no pide SELECT y el 403 que
   * llegue es el de la guarda. Es también lo que hace la API real, que nombra
   * sus columnas en el `select` en vez de pedirlas todas.
   */
  async function link(boloId: string | null): Promise<number> {
    const env = requireEnv();
    const res = await fetch(`${env.url}/rest/v1/performance?id=eq.${perfId}&select=id`, {
      method: 'PATCH',
      headers: {
        apikey: env.anon,
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ bolo_id: boloId }),
    });
    return res.status;
  }

  /** `bolo_id` no se puede LEER por PostgREST (mismo revoke), así que el enlace
      se comprueba por donde el dinero lo cuenta: `function_count`. */
  async function functionCount(boloId: string): Promise<number> {
    const res = await pgRpc<Array<{ id: string; function_count: number }>>(
      'list_money_bolos',
      jwt,
      { p_project_ids: null, p_workspace_ids: null, p_line_ids: null, p_from: null, p_to: null, p_limit: 500 },
    );
    expect(res.status).toBe(200);
    return (res.data ?? []).find((b) => b.id === boloId)?.function_count ?? -1;
  }

  it('hangs from a bolo of its OWN project', async () => {
    expect(await link(homeBoloId), 'a bolo of the same project must be accepted').toBe(204);
    expect(await functionCount(homeBoloId), 'the deal must count its function').toBe(1);
  });

  it('REFUSES a bolo of another project', async () => {
    expect(await link(foreignBoloId), 'a bolo of another project must not be accepted').toBe(403);
    expect(await functionCount(foreignBoloId), 'nothing may have landed on it').toBe(0);
  });

  it('refuses a bolo that does not exist, the same way', async () => {
    // «No es tuyo» y «no existe» comparten UNA sola `RAISE` en el trigger, para
    // que la guarda no sea un oráculo de existencia de UUIDs ajenos (misma
    // lección que 20260725100000_unexpose_project_id_helpers). Aquí se afirma
    // la mitad observable: los dos caminos se rechazan igual de lejos.
    expect(await link(NOWHERE)).toBe(403);
    expect(await link(foreignBoloId)).toBe(403);
  });

  it('still lets go — null detaches', async () => {
    expect(await link(homeBoloId)).toBe(204);
    expect(await link(null), 'a performance must always be able to leave its bolo').toBe(204);
    expect(await functionCount(homeBoloId), 'the deal must stop counting it').toBe(0);
  });

  it('the link that survives is the one that was set', async () => {
    expect(await link(homeBoloId)).toBe(204);
    expect(await functionCount(homeBoloId)).toBe(1);
    expect(await functionCount(foreignBoloId), 'the refused one never took it').toBe(0);
  });
});
