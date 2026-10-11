import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeJwt, envReady, login, pgGet, pgRpc, requireEnv } from './_helpers';

/**
 * ADR-090 P2: la escaleta la escribe el doc en directo, y el Durable Object
 * de collab la materializa como `service_role` con el usuario explícito
 * (`20261010220000_schedule_slot_live`).
 *
 * Esta suite corre como `authenticated` y `anon` (no tiene la clave de
 * servicio), así que fija la MITAD que se ve desde fuera:
 * - la costura del DO (`replace_schedule_slots_for_user`) y la autorización
 *   en vivo (`can_user_write_collab`) no se pueden llamar sin ser
 *   `service_role`: ni con sesión ni sin ella, y nada cambia al intentarlo;
 * - `replace_schedule_slots`, que ahora es el cuerpo común con la sesión,
 *   mantiene su contrato: diffea por id, devuelve la escaleta en orden y firma
 *   cada alta con quien la pidió.
 * La otra mitad (que el DO escribe solo con `edit:performance` del usuario,
 * que el audit lleva a esa persona, que `collab_snapshot` acepta `date`) la
 * prueba el SQL de la migración contra la base local; ver el estado del
 * carril `claude/escaleta-live`.
 *
 * Ojo: contra un origen SIN `20261010220000` también pasa (una función que no
 * existe da 404, que aquí cuenta como «no se puede»). Es una guarda de que la
 * migración no abre nada y no rompe el contrato, no una prueba de que está.
 * Autolimpiante: vive en `zzz-e2e-collab` (espacio `playwright`) con el
 * prefijo ZZZ y se borra al final.
 */
const RUN = Date.now().toString(36);

interface SlotRow {
  id: string;
  label: string | null;
  kind: string | null;
  at: string;
  sort: number;
  created_by: string | null;
}

const one = <T>(data: T | T[] | null): T | undefined =>
  Array.isArray(data) ? data[0] : (data ?? undefined);

describe.skipIf(!envReady())('schedule slots live (ADR-090 P2)', () => {
  let jwt: string;
  let me: string;
  let projectId: string;
  let dayId: string;

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    me = String(decodeJwt(jwt).sub);
    const p = await pgGet<{ id: string }>('project?select=id&slug=eq.zzz-e2e-collab', jwt);
    expect(p.status).toBe(200);
    projectId = p.rows[0]!.id;
    const d = await pgRpc<{ id: string }>('create_date', jwt, {
      p_project_id: projectId,
      p_kind: 'rehearsal',
      p_starts_at: '2031-05-09T10:00:00Z',
      p_title: `ZZZ RLS Live ${RUN}`,
    });
    expect(d.status, d.error).toBe(200);
    dayId = one(d.data)!.id;
  });

  afterAll(async () => {
    if (dayId) await pgRpc('delete_date', jwt, { p_date_id: dayId });
  });

  const slotsOf = async () =>
    (
      await pgGet<SlotRow>(
        'schedule_slot',
        jwt,
        new URLSearchParams({ date_id: `eq.${dayId}`, select: '*', order: 'sort' }),
      )
    ).rows;

  it('the DO seam is service_role only: no session and a session both bounce, nothing moves', async () => {
    const before = await slotsOf();
    const body = {
      p_user_id: me,
      p_target_table: 'date',
      p_target_id: dayId,
      p_slots: [{ label: 'ZZZ smuggled', at: '2031-05-09T12:00:00Z' }],
    };
    for (const as of [jwt, null]) {
      const r = await pgRpc('replace_schedule_slots_for_user', as, body);
      // 401/403 = no EXECUTE; 404 = PostgREST hides a function the role
      // cannot run. All three are «cannot», none is a write.
      expect([401, 403, 404]).toContain(r.status);
    }
    expect(await slotsOf()).toEqual(before);
  });

  it('nobody but service_role asks who may write a collab doc', async () => {
    for (const as of [jwt, null]) {
      const r = await pgRpc('can_user_write_collab', as, {
        p_user_id: me,
        p_target_table: 'date',
        p_target_id: dayId,
      });
      expect([401, 403, 404]).toContain(r.status);
    }
  });

  it('replace keeps its contract through the shared body: diff by id, order, signed by the session', async () => {
    const first = await pgRpc<SlotRow[]>('replace_schedule_slots', jwt, {
      p_target_table: 'date',
      p_target_id: dayId,
      p_slots: [
        { label: 'ZZZ call', at: '2031-05-09T09:00:00Z' },
        { kind: 'start', at: '2031-05-09T19:00:00Z' },
      ],
    });
    expect(first.status, first.error).toBe(200);
    const rows = first.data as SlotRow[];
    expect(rows.map((s) => [s.sort, s.label ?? s.kind])).toEqual([
      [1, 'ZZZ call'],
      [2, 'start'],
    ]);
    expect(rows.every((s) => s.created_by === me)).toBe(true);

    // Swap them by id and drop nothing: same ids, new places.
    const second = await pgRpc<SlotRow[]>('replace_schedule_slots', jwt, {
      p_target_table: 'date',
      p_target_id: dayId,
      p_slots: [
        { id: rows[1]!.id, kind: 'start', at: '2031-05-09T19:00:00Z' },
        { id: rows[0]!.id, label: 'ZZZ call', at: '2031-05-09T09:00:00Z' },
      ],
    });
    expect(second.status, second.error).toBe(200);
    expect((second.data as SlotRow[]).map((s) => s.id)).toEqual([rows[1]!.id, rows[0]!.id]);
  });

  it('without a session the shared body still refuses (42501, not a write by nobody)', async () => {
    const r = await pgRpc('replace_schedule_slots', null, {
      p_target_table: 'date',
      p_target_id: dayId,
      p_slots: [],
    });
    expect([401, 403, 404]).toContain(r.status);
    expect((await slotsOf()).length).toBe(2);
  });
});
