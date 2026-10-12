import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeJwt,
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPost,
  pgRpc,
  requireEnv,
  requireLimitedEnv,
} from './_helpers';

/**
 * ADR-103: «quién va». Una persona dice «voy» o «no voy» sobre una función o
 * un día (`commitment_person`), y lo deducido deja de ser solo una deducción.
 *
 * Lo que fija este fichero:
 * - se escribe solo por `set_commitment_person`: «voy», «no voy», y `null`
 *   para borrar la palabra; una sola fila por persona y compromiso;
 * - se lee con el permiso con que se lee el padre, y un padre borrado se la
 *   lleva de la vista;
 * - sobre uno mismo basta poder leer; sobre otra persona hace falta
 *   `edit:performance` (Marco, 12-10, opción a);
 * - «no voy» no existe para quien está en el reparto explícito de una
 *   función (Marco, 12-10, opción a): eso es editar el reparto;
 * - solo gente del espacio.
 *
 * Va rojo contra un origen sin `20261012100000`. Autolimpiante: todo vive en
 * `zzz-e2e-collab` (espacio `playwright`) con el prefijo ZZZ y se borra al
 * final. Nunca toca `muk-cia`.
 */
const RUN = Date.now().toString(36);

interface CommitmentRow {
  id: string;
  performance_id: string | null;
  date_id: string | null;
  person_id: string;
  state: 'going' | 'not_going';
}

const one = <T>(data: T | T[] | null): T | undefined =>
  Array.isArray(data) ? data[0] : (data ?? undefined);

describe.skipIf(!envReady())('commitment_person (ADR-103)', () => {
  let jwt: string;
  let projectId: string;
  let workspaceId: string;
  /** Two people of the workspace who are NOT cast on the project. */
  let laia: string;
  let pau: string;
  const performances: string[] = [];
  const dates: string[] = [];
  const castRows: string[] = [];

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const p = await pgGet<{ id: string; workspace_id: string }>(
      'project?select=id,workspace_id&slug=eq.zzz-e2e-collab',
      jwt,
    );
    expect(p.status).toBe(200);
    projectId = p.rows[0]!.id;
    workspaceId = p.rows[0]!.workspace_id;

    const cast = await pgGet<{ person_id: string }>(
      'cast_member',
      jwt,
      new URLSearchParams({ project_id: `eq.${projectId}`, deleted_at: 'is.null', select: 'person_id' }),
    );
    const casted = new Set(cast.rows.map((r) => r.person_id));
    const people = await pgGet<{ person_id: string }>(
      'workspace_person',
      jwt,
      new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        deleted_at: 'is.null',
        select: 'person_id',
        order: 'person_id',
      }),
    );
    const free = people.rows.map((r) => r.person_id).filter((id) => !casted.has(id));
    expect(free.length, 'the fixture needs two uncast people').toBeGreaterThanOrEqual(2);
    [laia, pau] = free as [string, string];
  });

  afterAll(async () => {
    for (const id of castRows) await pgRpc('remove_cast_member', jwt, { p_cast_member_id: id });
    for (const id of performances) await pgRpc('delete_performance', jwt, { p_performance_id: id });
    for (const id of dates) await pgRpc('delete_date', jwt, { p_date_id: id });
  });

  const gig = async () => {
    const r = await pgRpc<{ id: string }>('create_performance', jwt, {
      p_project_id: projectId,
      p_performed_at: '2031-05-10',
      p_venue_name: `ZZZ RLS Who ${RUN}`,
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
      p_starts_at: '2031-05-09T10:00:00Z',
      p_title: `ZZZ RLS Who ${RUN} rehearsal`,
    });
    expect(r.status, r.error).toBe(200);
    const id = one(r.data)!.id;
    dates.push(id);
    return id;
  };

  const say = (
    table: 'performance' | 'date',
    id: string,
    person: string,
    state: 'going' | 'not_going' | null,
    as = jwt,
  ) =>
    pgRpc<CommitmentRow[]>('set_commitment_person', as, {
      p_target_table: table,
      p_target_id: id,
      p_person_id: person,
      p_state: state,
    });

  const wordsOn = async (column: 'performance_id' | 'date_id', id: string, as = jwt) =>
    (
      await pgGet<CommitmentRow>(
        'commitment_person',
        as,
        new URLSearchParams({ [column]: `eq.${id}`, select: '*', order: 'person_id' }),
      )
    ).rows;

  it('says, changes and clears a word — one row per person', async () => {
    const d = await rehearsal();
    const first = await say('date', d, laia, 'going');
    expect(first.status, first.error).toBe(200);
    expect(one(first.data)?.state).toBe('going');

    expect((await say('date', d, laia, 'not_going')).status).toBe(200);
    expect((await say('date', d, pau, 'going')).status).toBe(200);
    const words = await wordsOn('date_id', d);
    expect(words.map((w) => [w.person_id, w.state])).toEqual(
      [
        [laia, 'not_going'],
        [pau, 'going'],
      ].sort((a, b) => a[0]!.localeCompare(b[0]!)),
    );

    expect((await say('date', d, laia, null)).status).toBe(200);
    expect((await wordsOn('date_id', d)).map((w) => w.person_id)).toEqual([pau]);
  });

  it('is never written directly', async () => {
    const d = await rehearsal();
    const r = await pgPost('commitment_person', jwt, {
      workspace_id: workspaceId,
      project_id: projectId,
      date_id: d,
      person_id: laia,
      state: 'going',
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('leaves the view with its parent', async () => {
    const d = await rehearsal();
    expect((await say('date', d, laia, 'going')).status).toBe(200);
    expect(await wordsOn('date_id', d)).toHaveLength(1);
    expect((await pgRpc('delete_date', jwt, { p_date_id: d })).status).toBe(200);
    expect(await wordsOn('date_id', d)).toHaveLength(0);
  });

  it('refuses «no voy» on a performance\'s explicit roster, not «voy»', async () => {
    const g = await gig();
    const add = await pgRpc<{ id: string }>('add_cast_member', jwt, {
      p_project_id: projectId,
      p_person_id: laia,
      p_role: `ZZZ ${RUN}`,
    });
    expect(add.status, add.error).toBe(200);
    castRows.push(one(add.data)!.id);

    const no = await say('performance', g, laia, 'not_going');
    expect(no.status).toBe(400);
    expect((await say('performance', g, pau, 'not_going')).status).toBe(200);
    expect((await say('performance', g, laia, 'going')).status).toBe(200);
  });

  it('only takes people of the workspace', async () => {
    const d = await rehearsal();
    const r = await say('date', d, '00000000-0000-4000-8000-000000000000', 'going');
    expect(r.status).toBe(400);
  });

  describe.skipIf(!limitedEnvReady())('the limited performer', () => {
    let limitedJwt: string;
    let self: string | null = null;

    beforeAll(async () => {
      const l = requireLimitedEnv();
      limitedJwt = await login(l.email, l.password);
      const sub = decodeJwt(limitedJwt).sub as string;
      const me = await pgGet<{ person_id: string | null }>(
        'user_profile',
        limitedJwt,
        new URLSearchParams({ user_id: `eq.${sub}`, select: 'person_id' }),
      );
      const mine = me.rows[0]?.person_id ?? null;
      // Only a person of this workspace can give a word here.
      const inWs = mine
        ? await pgGet<{ person_id: string }>(
            'workspace_person',
            jwt,
            new URLSearchParams({
              workspace_id: `eq.${workspaceId}`,
              person_id: `eq.${mine}`,
              deleted_at: 'is.null',
              select: 'person_id',
            }),
          )
        : null;
      self = inWs && inWs.rows.length > 0 ? mine : null;
    });

    /**
     * No se da por hecho qué puede el rol: se le pregunta a `has_permission`.
     * Sobre otra persona, la puerta es la de editar; sobre sí mismo, la de leer.
     */
    it('answers for itself with read, for others only with edit', async () => {
      const d = await rehearsal();
      const can = async (perm: string) =>
        (await pgRpc<boolean>('has_permission', limitedJwt, { p_project_id: projectId, p_perm: perm })).data;
      const read = Boolean(await can('read:performance'));
      const edit = Boolean(await can('edit:performance'));

      const other = await say('date', d, pau === self ? laia : pau, 'going', limitedJwt);
      expect(other.status, `edit:performance=${edit}`).toBe(edit ? 200 : 403);

      if (self) {
        const mine = await say('date', d, self, 'not_going', limitedJwt);
        expect(mine.status, `read:performance=${read}`).toBe(read ? 200 : 403);
      }
    });
  });
});
