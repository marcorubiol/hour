import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgPost,
  pgRpc,
  requireEnv,
  requireLimitedEnv,
} from './_helpers';

/**
 * ADR-090 P1: la escaleta es una lista de momentos colgada de una función XOR
 * de un día (`schedule_slot`), y las cinco franjas de `performance` ya no son
 * columnas.
 *
 * Lo que fija este fichero:
 * - un momento cuelga de una función o de un día, se escribe solo por RPC, y
 *   sus posiciones son siempre 1..N: al añadir, al reordenar, al borrar y al
 *   sustituir la lista entera;
 * - `replace_schedule_slots` diffea por id: conserva ids, crea con el id que
 *   le dan, borra lo que falta y no roba un momento de otra escaleta;
 * - la puerta es la del padre: se lee con `read:performance`, se escribe con
 *   `edit:performance`, y un padre borrado se lleva sus momentos de la vista;
 * - el road sheet público sigue diciendo las cinco franjas, ahora desde aquí;
 * - las cinco columnas ya no existen en `performance`.
 *
 * Va rojo contra un origen sin `20261009200000`. Autolimpiante: todo vive en
 * `zzz-e2e-collab` (espacio `playwright`) con el prefijo ZZZ y se borra al
 * final. Nunca toca `muk-cia`.
 */
const RUN = Date.now().toString(36);
const NOWHERE = '00000000-0000-4000-8000-000000000000';

interface SlotRow {
  id: string;
  performance_id: string | null;
  date_id: string | null;
  label: string | null;
  kind: string | null;
  at: string;
  ends_at: string | null;
  sort: number;
  notes: string | null;
  updated_at: string;
}

/** `RETURNS SETOF` sale como array por PostgREST; una fila sola, como objeto. */
const one = <T>(data: T | T[] | null): T | undefined =>
  Array.isArray(data) ? data[0] : (data ?? undefined);

const iso = (s: string) => new Date(s).toISOString();

describe.skipIf(!envReady())('schedule slots (ADR-090 P1)', () => {
  let jwt: string;
  let projectId: string;
  const performances: string[] = [];
  const dates: string[] = [];

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const p = await pgGet<{ id: string }>('project?select=id&slug=eq.zzz-e2e-collab', jwt);
    expect(p.status).toBe(200);
    projectId = p.rows[0]!.id;
  });

  afterAll(async () => {
    for (const id of performances) await pgRpc('delete_performance', jwt, { p_performance_id: id });
    for (const id of dates) await pgRpc('delete_date', jwt, { p_date_id: id });
  });

  const gig = async () => {
    const r = await pgRpc<{ id: string }>('create_performance', jwt, {
      p_project_id: projectId,
      p_performed_at: '2031-04-10',
      p_venue_name: `ZZZ RLS Slot ${RUN}`,
      p_status: 'proposed',
    });
    expect(r.status, r.error).toBe(200);
    const id = one(r.data)!.id;
    performances.push(id);
    return id;
  };

  const rehearsal = async () => {
    const r = await pgRpc<{ id: string }>('create_date', jwt, {
      p_project_id: projectId,
      p_kind: 'rehearsal',
      p_starts_at: '2031-04-09T10:00:00Z',
      p_title: `ZZZ RLS Slot ${RUN} rehearsal`,
    });
    expect(r.status, r.error).toBe(200);
    const id = one(r.data)!.id;
    dates.push(id);
    return id;
  };

  const add = (table: 'performance' | 'date', id: string, args: Record<string, unknown>) =>
    pgRpc<SlotRow>('create_schedule_slot', jwt, {
      p_target_table: table,
      p_target_id: id,
      ...args,
    });

  const slotsOf = async (column: 'performance_id' | 'date_id', id: string, as = jwt) =>
    (
      await pgGet<SlotRow>(
        'schedule_slot',
        as,
        new URLSearchParams({ [column]: `eq.${id}`, select: '*', order: 'sort' }),
      )
    ).rows;

  /**
   * Expand/contract: entre la fase A (20261009200000) y la B
   * (20261009210000) las cinco columnas conviven con los slots y un espejo
   * las mantiene iguales en los dos sentidos; tras la B ya no existen. El
   * test pregunta en qué fase está la base y exige lo que toca en cada una.
   */
  it('the five columns: mirrored both ways in phase A, gone after phase B', async () => {
    const g = await gig();
    const probe = await pgGet<Record<string, string | null>>(
      `performance?select=start_at,load_in_at&id=eq.${g}`,
      jwt,
    );
    if (probe.status === 400) return; // fase B: las columnas ya no existen
    expect(probe.status).toBe(200);

    // El Worker nuevo escribe un slot → la columna lo sigue al confirmar.
    await add('performance', g, { p_at: '2031-04-10T20:00:00Z', p_kind: 'start' });
    const after = await pgGet<Record<string, string | null>>(
      `performance?select=start_at&id=eq.${g}`,
      jwt,
    );
    expect(iso(after.rows[0]!.start_at!)).toBe(iso('2031-04-10T20:00:00Z'));

    // El Worker viejo escribe la columna → el slot la sigue.
    const w = await pgPatch(
      'performance',
      jwt,
      { load_in_at: '2031-04-10T15:00:00Z' },
      new URLSearchParams({ id: `eq.${g}`, select: 'id' }),
    );
    expect(w.status).toBe(200);
    const slots = await slotsOf('performance_id', g);
    expect(slots.map((s) => s.kind)).toEqual(['start', 'load_in']);
    expect(iso(slots[1]!.at)).toBe(iso('2031-04-10T15:00:00Z'));
  });

  it('slots append 1..N on a gig and on a day, names trimmed', async () => {
    const g = await gig();
    const a = await add('performance', g, { p_at: '2031-04-10T15:00:00Z', p_kind: 'load_in' });
    const b = await add('performance', g, {
      p_at: '2031-04-10T17:00:00Z',
      p_label: '  Photo call ',
      p_ends_at: '2031-04-10T17:30:00Z',
    });
    expect(a.status, a.error).toBe(200);
    expect(b.status, b.error).toBe(200);
    expect(one(a.data)).toMatchObject({ sort: 1, kind: 'load_in', label: null, performance_id: g, date_id: null });
    expect(one(b.data)).toMatchObject({ sort: 2, label: 'Photo call', kind: null });

    const d = await rehearsal();
    const c = await add('date', d, { p_at: '2031-04-09T10:00:00Z', p_label: 'Warm up' });
    expect(c.status, c.error).toBe(200);
    expect(one(c.data)).toMatchObject({ sort: 1, date_id: d, performance_id: null });
  });

  it('a slot needs a name, a time and a sane range', async () => {
    const g = await gig();
    expect((await add('performance', g, { p_at: '2031-04-10T15:00:00Z' })).status, 'no label nor kind').toBe(400);
    expect((await add('performance', g, { p_at: null, p_label: 'x' })).status, 'no at').toBe(400);
    expect(
      (await add('performance', g, { p_at: '2031-04-10T15:00:00Z', p_ends_at: '2031-04-10T14:00:00Z', p_label: 'x' })).status,
      'ends before it starts',
    ).toBe(400);
    expect((await add('performance', g, { p_at: '2031-04-10T15:00:00Z', p_kind: 'Not A Kind' })).status, 'kind format').toBe(400);
    const bad = await pgRpc('create_schedule_slot', jwt, {
      p_target_table: 'venue',
      p_target_id: g,
      p_at: '2031-04-10T15:00:00Z',
      p_label: 'x',
    });
    expect(bad.status, 'only performance or date').toBe(400);
  });

  it('reorder takes the whole order or nothing; delete closes the gap', async () => {
    const g = await gig();
    const ids: string[] = [];
    for (const k of ['load_in', 'soundcheck', 'start']) {
      ids.push(one((await add('performance', g, { p_at: '2031-04-10T15:00:00Z', p_kind: k })).data)!.id);
    }
    const args = (slotIds: string[]) => ({ p_target_table: 'performance', p_target_id: g, p_slot_ids: slotIds });
    expect((await pgRpc('reorder_schedule_slots', jwt, args(ids.slice(0, 2)))).status, 'partial').toBe(400);
    expect((await pgRpc('reorder_schedule_slots', jwt, args([ids[0], ids[0], ids[1]]))).status, 'repeated').toBe(400);

    const r = await pgRpc('reorder_schedule_slots', jwt, args([ids[2], ids[0], ids[1]]));
    expect(r.status, r.error).toBe(200);
    expect((await slotsOf('performance_id', g)).map((s) => s.kind)).toEqual(['start', 'load_in', 'soundcheck']);

    const del = await pgRpc('delete_schedule_slot', jwt, { p_slot_id: ids[0] });
    expect(del.status, del.error).toBeLessThan(300);
    expect((await slotsOf('performance_id', g)).map((s) => [s.kind, s.sort])).toEqual([
      ['start', 1],
      ['soundcheck', 2],
    ]);
  });

  it('update REPLACES the slot: what is not sent is cleared, the place stays', async () => {
    const g = await gig();
    await add('performance', g, { p_at: '2031-04-10T14:00:00Z', p_kind: 'load_in' });
    const s = one(
      (await add('performance', g, { p_at: '2031-04-10T15:00:00Z', p_label: 'Dinner', p_notes: 'veggie' })).data,
    )!;
    const u = await pgRpc<SlotRow>('update_schedule_slot', jwt, {
      p_slot_id: s.id,
      p_at: '2031-04-10T16:00:00Z',
      p_kind: 'meal',
    });
    expect(u.status, u.error).toBe(200);
    expect(one(u.data)).toMatchObject({ kind: 'meal', label: null, notes: null, sort: 2 });
    expect(iso(one(u.data)!.at)).toBe(iso('2031-04-10T16:00:00Z'));
  });

  it('replace diffs by id: keeps, updates, creates with the given id, deletes the rest', async () => {
    const g = await gig();
    const keep = one((await add('performance', g, { p_at: '2031-04-10T15:00:00Z', p_kind: 'load_in' })).data)!;
    const move = one((await add('performance', g, { p_at: '2031-04-10T20:00:00Z', p_kind: 'start' })).data)!;
    const gone = one((await add('performance', g, { p_at: '2031-04-10T23:00:00Z', p_kind: 'wrap' })).data)!;
    const fresh = crypto.randomUUID();

    const r = await pgRpc<SlotRow[]>('replace_schedule_slots', jwt, {
      p_target_table: 'performance',
      p_target_id: g,
      p_slots: [
        { id: move.id, kind: 'start', at: '2031-04-10T21:00:00Z' },
        { id: fresh, label: 'Photo call', at: '2031-04-10T17:00:00Z' },
        { id: keep.id, kind: 'load_in', at: keep.at },
        { kind: 'loadout', at: '2031-04-10T22:30:00Z' },
      ],
    });
    expect(r.status, r.error).toBe(200);
    const rows = await slotsOf('performance_id', g);
    expect(rows.map((s) => [s.id === fresh ? 'fresh' : s.kind, s.sort])).toEqual([
      ['start', 1],
      ['fresh', 2],
      ['load_in', 3],
      ['loadout', 4],
    ]);
    expect(rows[0]!.id).toBe(move.id);
    expect(iso(rows[0]!.at)).toBe(iso('2031-04-10T21:00:00Z'));
    expect(rows.some((s) => s.id === gone.id)).toBe(false);
  });

  it('replace with nothing changed writes nothing', async () => {
    const g = await gig();
    const s = one((await add('performance', g, { p_at: '2031-04-10T15:00:00Z', p_kind: 'load_in' })).data)!;
    await new Promise((res) => setTimeout(res, 20));
    const r = await pgRpc('replace_schedule_slots', jwt, {
      p_target_table: 'performance',
      p_target_id: g,
      p_slots: [{ id: s.id, kind: 'load_in', at: s.at }],
    });
    expect(r.status, r.error).toBe(200);
    expect((await slotsOf('performance_id', g))[0]!.updated_at).toBe(s.updated_at);
  });

  it('replace does not steal a slot from another running order, nor take duplicates', async () => {
    const a = await gig();
    const b = await gig();
    const theirs = one((await add('performance', b, { p_at: '2031-04-10T15:00:00Z', p_kind: 'start' })).data)!;
    const steal = await pgRpc('replace_schedule_slots', jwt, {
      p_target_table: 'performance',
      p_target_id: a,
      p_slots: [{ id: theirs.id, kind: 'start', at: theirs.at }],
    });
    expect(steal.status).toBe(400);
    expect(await slotsOf('performance_id', b)).toHaveLength(1);

    const id = crypto.randomUUID();
    const dup = await pgRpc('replace_schedule_slots', jwt, {
      p_target_table: 'performance',
      p_target_id: a,
      p_slots: [
        { id, kind: 'start', at: '2031-04-10T20:00:00Z' },
        { id, kind: 'wrap', at: '2031-04-10T23:00:00Z' },
      ],
    });
    expect(dup.status).toBe(400);
  });

  it('no direct writes: the table only reads', async () => {
    const g = await gig();
    const r = await pgPost('schedule_slot', jwt, {
      workspace_id: NOWHERE,
      project_id: projectId,
      performance_id: g,
      label: 'x',
      at: '2031-04-10T15:00:00Z',
      sort: 9,
    });
    expect([401, 403]).toContain(r.status);
  });

  it('a parent that is not yours is the same answer as one that is not there', async () => {
    expect(
      (await add('performance', NOWHERE, { p_at: '2031-04-10T15:00:00Z', p_label: 'x' })).status,
      'no existence oracle',
    ).toBe(403);
    expect((await pgRpc('delete_schedule_slot', jwt, { p_slot_id: NOWHERE })).status).toBe(403);
  });

  it('a deleted parent takes its slots out of sight, and out of reach', async () => {
    const d = await rehearsal();
    const s = one((await add('date', d, { p_at: '2031-04-09T10:00:00Z', p_label: 'Warm up' })).data)!;
    expect(await slotsOf('date_id', d)).toHaveLength(1);
    const del = await pgRpc('delete_date', jwt, { p_date_id: d });
    expect(del.status, del.error).toBeLessThan(300);
    expect(await slotsOf('date_id', d)).toHaveLength(0);
    expect((await pgRpc('delete_schedule_slot', jwt, { p_slot_id: s.id })).status).toBe(403);
  });

  it('the public road sheet still says the five timeslots, now from the slots', async () => {
    const g = await gig();
    await add('performance', g, { p_at: '2031-04-10T15:00:00Z', p_kind: 'load_in' });
    await add('performance', g, { p_at: '2031-04-10T17:00:00Z', p_label: 'Photo call' });
    await add('performance', g, { p_at: '2031-04-10T20:00:00Z', p_kind: 'start' });
    const share = await pgRpc<{ id: string; token: string }>('create_roadsheet_share', jwt, {
      p_performance_id: g,
      p_role: 'tech_manager',
    });
    expect(share.status, share.error).toBe(200);
    try {
      const pub = await pgRpc<{ performance: Record<string, string | null> }>('get_public_roadsheet', null, {
        p_token: share.data!.token,
      });
      expect(pub.status).toBe(200);
      const p = pub.data!.performance;
      expect(iso(p.load_in_at!)).toBe(iso('2031-04-10T15:00:00Z'));
      expect(iso(p.start_at!)).toBe(iso('2031-04-10T20:00:00Z'));
      expect(p.soundcheck_at).toBeNull();
      expect(p.loadout_at).toBeNull();
      expect(p.wrap_at).toBeNull();
    } finally {
      await pgRpc('revoke_roadsheet_share', jwt, { p_share_id: share.data!.id });
    }
  });

  /**
   * § 17 P3 (20261010180000): el road sheet público lleva la escaleta ENTERA,
   * en su orden y con los momentos libres, igual que la hoja interna. Sin
   * `notes`: la proyección pública no las ha llevado nunca. Va rojo contra un
   * origen sin esa migración (no hay `schedule`).
   */
  it('the public road sheet carries the whole running order, in order, without notes', async () => {
    const g = await gig();
    const empty = await gig();
    await add('performance', g, { p_at: '2031-04-10T15:00:00Z', p_kind: 'load_in' });
    await add('performance', g, {
      p_at: '2031-04-10T17:00:00Z',
      p_label: 'Photo call',
      p_notes: 'ZZZ private note',
    });
    await add('performance', g, {
      p_at: '2031-04-10T20:00:00Z',
      p_ends_at: '2031-04-10T21:15:00Z',
      p_kind: 'start',
    });
    const shares: { id: string; token: string }[] = [];
    for (const id of [g, empty]) {
      const s = await pgRpc<{ id: string; token: string }>('create_roadsheet_share', jwt, {
        p_performance_id: id,
        p_role: 'venue',
      });
      expect(s.status, s.error).toBe(200);
      shares.push(s.data!);
    }
    type Moment = { kind: string | null; label: string | null; at: string; ends_at: string | null };
    try {
      const pub = await pgRpc<{ performance: { schedule?: Moment[] } }>('get_public_roadsheet', null, {
        p_token: shares[0].token,
      });
      expect(pub.status).toBe(200);
      const schedule = pub.data!.performance.schedule!;
      expect(schedule.map((m) => [m.kind, m.label, iso(m.at)])).toEqual([
        ['load_in', null, iso('2031-04-10T15:00:00Z')],
        [null, 'Photo call', iso('2031-04-10T17:00:00Z')],
        ['start', null, iso('2031-04-10T20:00:00Z')],
      ]);
      expect(iso(schedule[2].ends_at!)).toBe(iso('2031-04-10T21:15:00Z'));
      expect(JSON.stringify(pub.data)).not.toContain('ZZZ private note');
      for (const m of schedule) expect(Object.keys(m).sort()).toEqual(['at', 'ends_at', 'kind', 'label']);

      // Sin momentos, una lista vacía y no null: la vista no distingue casos.
      const bare = await pgRpc<{ performance: { schedule?: Moment[] } }>('get_public_roadsheet', null, {
        p_token: shares[1].token,
      });
      expect(bare.data!.performance.schedule).toEqual([]);
    } finally {
      for (const s of shares) await pgRpc('revoke_roadsheet_share', jwt, { p_share_id: s.id });
    }
  });

  describe.skipIf(!limitedEnvReady())('the limited performer', () => {
    let limitedJwt: string;

    beforeAll(async () => {
      const l = requireLimitedEnv();
      limitedJwt = await login(l.email, l.password);
    });

    /**
     * No se da por hecho qué puede el rol: se le pregunta a `has_permission`
     * y se exige que las puertas del momento contesten lo mismo que las del
     * padre, sea cual sea el rol de hoy.
     */
    it('reads and writes slots exactly as far as it reads and edits the parent', async () => {
      const g = await gig();
      expect((await add('performance', g, { p_at: '2031-04-10T15:00:00Z', p_kind: 'start' })).status).toBe(200);
      const can = async (perm: string) =>
        (await pgRpc<boolean>('has_permission', limitedJwt, { p_project_id: projectId, p_perm: perm })).data;
      const read = await can('read:performance');
      const edit = await can('edit:performance');

      const seen = await slotsOf('performance_id', g, limitedJwt);
      expect(seen.length > 0, `read:performance=${read}`).toBe(Boolean(read));

      const w = await pgRpc('create_schedule_slot', limitedJwt, {
        p_target_table: 'performance',
        p_target_id: g,
        p_at: '2031-04-10T16:00:00Z',
        p_label: 'x',
      });
      expect(w.status, `edit:performance=${edit}`).toBe(edit ? 200 : 403);
    });
  });
});
