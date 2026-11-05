/**
 * RLS: «Llego tarde» from a personal road sheet link (121 B, ADR-180;
 * `20261106100000_roadsheet_late_notice`).
 *
 * `report_roadsheet_late` runs as anon with the token and the public anon
 * key, straight against PostgREST: what passes here passes for anyone with
 * a link, Worker or not. It must:
 *   - accept a live personal link on the performance's day (venue's zone,
 *     else the space's), and say it on the public sheet;
 *   - refuse a role-only link, another day, a revoked link, an expired link,
 *     a person not in the team, bad minutes, and a fourth notice in an hour;
 *   - never let anon read `roadsheet_late_notice` or call production's RPCs.
 *
 * In `zzz-e2e-collab` (`playwright`): performances it creates (today, 2031
 * and three days ago, no venue, so the day is the space's), a `zzz-` team
 * dossier (there is no delete RPC for a dossier, as in team-person.test.ts),
 * its crew rows and links. Revokes and deletes what it can. The notices stay
 * on the deleted performances (the RPCs never delete them).
 *
 * The «expired» case is a performance three days ago: its link is born
 * expired (`roadsheet_share_default_expiry`), and it is not its day either.
 * Without service_role the suite cannot expire a link of today's performance.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { envReady, login, pgGet, pgPatch, pgPost, pgRpc, requireEnv } from './_helpers';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

type Share = { id: string; token: string; role: string; person_id: string | null };
type Notice = { id: string; minutes: number | null; note: string | null; milestone: { kind: string | null; at: string } | null };
type Public = {
  holder?: { name: string | null; role: string | null };
  late?: { open: boolean; recipients: string[]; last: { minutes: number | null; seen_at: string | null } | null };
  late_moves?: unknown[];
};

function dayIn(tz: string, offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: tz });
}

describe.skipIf(!envReady())('RLS: «llego tarde» from a personal road sheet link (121 B)', () => {
  let jwt: string;
  let workspaceId: string;
  let projectId: string;
  let personId: string;
  let strangerId: string;
  const perfs: Record<'today' | 'later' | 'past', string> = { today: '', later: '', past: '' };
  const crew: string[] = [];
  const shares: string[] = [];
  let personal: Share;
  let roleOnly: Share;

  const createPerf = async (day: string, label: string) => {
    const r = await pgRpc<{ id: string }>('create_performance', jwt, {
      p_project_id: projectId,
      p_performed_at: day,
      p_status: 'hold_1',
      p_venue_name: `ZZZ Tarde ${label} ${RUN}`,
    });
    expect(r.status, r.error).toBe(200);
    return one(r.data)!.id;
  };

  const addCrew = async (performanceId: string) => {
    const r = await pgPost<{ id: string }>('crew_assignment', jwt, {
      workspace_id: workspaceId,
      performance_id: performanceId,
      person_id: personId,
      role: 'luces',
    });
    expect(r.status).toBeLessThan(300);
    crew.push(r.rows[0]!.id);
  };

  const personalLink = async (performanceId: string) => {
    const r = await pgRpc<Share>('create_roadsheet_share_for_person', jwt, {
      p_performance_id: performanceId,
      p_person_id: personId,
    });
    expect(r.status, r.error).toBe(200);
    const s = one(r.data)!;
    shares.push(s.id);
    return s;
  };

  const report = (token: string, minutes: number | null = 20, note: string | null = null) =>
    pgRpc<Notice>('report_roadsheet_late', null, { p_token: token, p_minutes: minutes, p_note: note });

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const p = await pgGet<{ id: string; workspace_id: string; workspace: { timezone: string } }>(
      'project',
      jwt,
      new URLSearchParams({
        select: 'id,workspace_id,workspace:workspace_id!inner(slug,timezone)',
        'workspace.slug': 'eq.playwright',
        slug: 'eq.zzz-e2e-collab',
        deleted_at: 'is.null',
        limit: '1',
      }),
    );
    if (p.rows.length === 0) throw new Error('zzz-e2e-collab missing in playwright');
    projectId = p.rows[0]!.id;
    workspaceId = p.rows[0]!.workspace_id;
    const tz = p.rows[0]!.workspace.timezone || 'UTC';

    const dossier = await pgRpc<{ person_id: string }>('create_workspace_person', jwt, {
      p_workspace_id: workspaceId,
      p_full_name: `Zzz Tarde ${RUN}`,
    });
    expect(dossier.status, dossier.error).toBe(200);
    personId = one(dossier.data)!.person_id;
    const stranger = await pgRpc<{ person_id: string }>('create_workspace_person', jwt, {
      p_workspace_id: workspaceId,
      p_full_name: `Zzz Ajena ${RUN}`,
    });
    strangerId = one(stranger.data)!.person_id;

    perfs.today = await createPerf(dayIn(tz), 'hoy');
    perfs.later = await createPerf('2031-03-14', '2031');
    perfs.past = await createPerf(dayIn(tz, -3), 'pasada');
    for (const id of Object.values(perfs)) await addCrew(id);

    // A moment ahead, so the notice has a moment to be late to.
    const slot = await pgRpc('create_schedule_slot', jwt, {
      p_target_table: 'performance',
      p_target_id: perfs.today,
      p_kind: 'load_in',
      p_at: new Date(Date.now() + 2 * 3_600_000).toISOString(),
    });
    expect(slot.status, slot.error).toBe(200);

    personal = await personalLink(perfs.today);
    const role = await pgRpc<Share>('create_roadsheet_share', jwt, { p_performance_id: perfs.today, p_role: 'tech_manager' });
    expect(role.status, role.error).toBe(200);
    roleOnly = one(role.data)!;
    shares.push(roleOnly.id);
  });

  afterAll(async () => {
    if (!jwt) return;
    for (const id of shares) await pgRpc('revoke_roadsheet_share', jwt, { p_share_id: id });
    for (const id of crew) {
      await pgPatch('crew_assignment', jwt, { deleted_at: new Date().toISOString() }, new URLSearchParams({ id: `eq.${id}` }));
    }
    for (const id of Object.values(perfs)) if (id) await pgRpc('delete_performance', jwt, { p_performance_id: id });
  });

  test('a personal link gets the crew role from the team; a person outside it, none', async () => {
    expect(personal.role).toBe('tech_manager');
    expect(personal.person_id).toBe(personId);
    const outside = await pgRpc('create_roadsheet_share_for_person', jwt, {
      p_performance_id: perfs.today,
      p_person_id: strangerId,
    });
    expect(outside.status).toBe(400);
  });

  test('anon cannot create a personal link', async () => {
    const r = await pgRpc('create_roadsheet_share_for_person', null, { p_performance_id: perfs.today, p_person_id: personId });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  test('a valid personal link, on the day: accepted, and the sheet says it', async () => {
    const r = await report(personal.token, 20, `zzz-note-${RUN}`);
    expect(r.status, r.error).toBe(200);
    const notice = one(r.data)!;
    expect(notice.minutes).toBe(20);
    expect(notice.note).toBe(`zzz-note-${RUN}`);
    expect(notice.milestone?.kind).toBe('load_in');

    const pub = await pgRpc<Public>('get_public_roadsheet', null, { p_token: personal.token });
    const b = one(pub.data)!;
    expect(b.holder?.name).toBe(`Zzz Tarde ${RUN}`);
    expect(b.holder?.role).toBe('luces');
    expect(b.late?.open).toBe(true);
    expect(b.late?.last?.minutes).toBe(20);
    expect(Array.isArray(b.late?.recipients)).toBe(true);
  });

  test('a role-only link: refused, and its sheet has no «llego tarde»', async () => {
    const r = await report(roleOnly.token);
    expect(r.status).toBeGreaterThanOrEqual(400);
    const pub = one((await pgRpc<Public>('get_public_roadsheet', null, { p_token: roleOnly.token })).data)!;
    expect(pub.holder).toBeUndefined();
    expect(pub.late).toBeUndefined();
    expect(Array.isArray(pub.late_moves)).toBe(true);
  });

  test('another day: refused', async () => {
    const s = await personalLink(perfs.later);
    const r = await report(s.token);
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/only on the day/);
    const pub = one((await pgRpc<Public>('get_public_roadsheet', null, { p_token: s.token })).data)!;
    expect(pub.late?.open).toBe(false);
  });

  test('a revoked link: refused', async () => {
    const s = await personalLink(perfs.today);
    expect((await pgRpc('revoke_roadsheet_share', jwt, { p_share_id: s.id })).status).toBeLessThan(300);
    const r = await report(s.token);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).not.toBe(400);
  });

  test('an expired link: refused', async () => {
    const s = await personalLink(perfs.past);
    const r = await report(s.token);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).not.toBe(400);
  });

  test('a made-up token: refused', async () => {
    expect((await report('f'.repeat(64))).status).toBeGreaterThanOrEqual(400);
    expect((await report('not-a-token')).status).toBeGreaterThanOrEqual(400);
  });

  test('bad minutes or a note over 280: refused', async () => {
    expect((await report(personal.token, 15)).status).toBe(400);
    expect((await report(personal.token, 10, 'x'.repeat(281))).status).toBe(400);
  });

  test('a flood: the fourth notice in an hour is refused', async () => {
    // One already sent above; two more fit, the next does not.
    expect((await report(personal.token, null)).status).toBe(200);
    expect((await report(personal.token, 45)).status).toBe(200);
    const fourth = await report(personal.token, 10);
    expect(fourth.status).toBeGreaterThanOrEqual(400);
    expect(fourth.error).toMatch(/too many/);
  });

  test('anon cannot read the notices, nor call production’s RPCs', async () => {
    const direct = await pgGet('roadsheet_late_notice', null, new URLSearchParams({ select: 'id', limit: '1' }));
    expect(direct.rows).toEqual([]);
    expect(direct.status).toBeGreaterThanOrEqual(400);
    expect((await pgRpc('roadsheet_late_notices', null, {})).status).toBeGreaterThanOrEqual(400);
    const any = '00000000-0000-4000-8000-000000000000';
    expect((await pgRpc('mark_roadsheet_late_seen', null, { p_notice_id: any })).status).toBeGreaterThanOrEqual(400);
    expect((await pgRpc('roadsheet_late_move_plan', null, { p_notice_id: any })).status).toBeGreaterThanOrEqual(400);
  });

  test('production sees the last notice, marks it seen, and the sheet says who', async () => {
    const open = await pgRpc<Array<{ id: string; person_name: string; minutes: number | null; can_edit: boolean }>>(
      'roadsheet_late_notices',
      jwt,
      {},
    );
    expect(open.status, open.error).toBe(200);
    const mine = (open.data ?? []).filter((n) => n.person_name === `Zzz Tarde ${RUN}`);
    // Only the last notice of the link: the 45 of the flood test.
    expect(mine).toHaveLength(1);
    expect(mine[0]!.minutes).toBe(45);
    expect(mine[0]!.can_edit).toBe(true);

    const direct = await pgGet<{ id: string }>(
      'roadsheet_late_notice',
      jwt,
      new URLSearchParams({ select: 'id', performance_id: `eq.${perfs.today}` }),
    );
    expect(direct.rows.length).toBe(3);

    expect((await pgRpc('mark_roadsheet_late_seen', jwt, { p_notice_id: mine[0]!.id })).status).toBeLessThan(300);
    const pub = one((await pgRpc<Public>('get_public_roadsheet', null, { p_token: personal.token })).data)!;
    expect(pub.late?.last?.seen_at).toBeTruthy();
    const after = await pgRpc<Array<{ person_name: string }>>('roadsheet_late_notices', jwt, {});
    expect((after.data ?? []).filter((n) => n.person_name === `Zzz Tarde ${RUN}`)).toHaveLength(0);
  });

  test('a move that is not the proposed one is refused', async () => {
    const direct = await pgGet<{ id: string; milestone_at: string; minutes: number | null }>(
      'roadsheet_late_notice',
      jwt,
      new URLSearchParams({ select: 'id,milestone_at,minutes', performance_id: `eq.${perfs.today}`, minutes: 'eq.20' }),
    );
    const n = direct.rows[0]!;
    const plan = await pgRpc<{ from: string; to: string }>('roadsheet_late_move_plan', jwt, { p_notice_id: n.id });
    expect(plan.status, plan.error).toBe(200);
    expect(Date.parse(one(plan.data)!.to) - Date.parse(one(plan.data)!.from)).toBe(20 * 60_000);
    const bad = await pgRpc('record_roadsheet_late_move', jwt, {
      p_notice_id: n.id,
      p_from: one(plan.data)!.from,
      p_to: new Date(Date.parse(one(plan.data)!.to) + 3_600_000).toISOString(),
    });
    expect(bad.status).toBe(400);
  });
});
