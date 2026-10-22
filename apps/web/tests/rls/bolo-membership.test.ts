/**
 * RLS regression: el equipo de una noche (comms carril 2, fase 1; migración
 * 20261022100000_bolo_membership; plan build/plans/2026-10-22-comms-threads-facets.md
 * § 2 a, § 4 y § 5).
 *
 * En `playwright`, en `zzz-rls-foreign-project`, donde la fixture limitada no
 * tiene membresía: todo lo que lea allí lo lee por una membresía de bolo. El
 * fichero crea sus bolos y funciones y los borra al final, y quita las
 * membresías de bolo que haya dado.
 *
 * Lo que prueba:
 *   - la membresía de bolo deja leer las funciones de ESE bolo por PostgREST,
 *     no las de otro bolo ni la función sin bolo del mismo proyecto; el bolo
 *     (dinero) y `performance.bolo_id` siguen cerrados;
 *   - caducidad: acortada a mano al pasado no da nada (ni tablón); sin fecha
 *     vuelve; la de una invitación sigue al bolo;
 *   - invitación de bolo: la crea quien puede dar el paquete (techo del
 *     delegante), solo Mínim o Equip; se ve, se acepta y deja una membresía de
 *     bolo que caduca con el bolo; quien la dio la revoca;
 *   - bolo_access: solo a quien está en el bolo;
 *   - membership_facet tiene id;
 *   - anon no llama a nada nuevo.
 * La sala por la cadena y el guest que no edita salas se prueban en local
 * (la fixture limitada es `member`, ya lee todo el directorio).
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgRpc,
  requireEnv,
  requireLimitedEnv,
} from './_helpers';

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const NOWHERE = '00000000-0000-4000-8000-000000000000';

const one = <T>(data: T | T[] | null): T | undefined => (Array.isArray(data) ? data[0] : (data ?? undefined));

interface Access {
  bolo_id: string;
  ends_at: string | null;
  can_invite: { minim: boolean; equip: boolean };
  members: {
    membership_id: string;
    user_id: string;
    preset: string | null;
    ends_at: string | null;
    expires_with_bolo: boolean;
    live: boolean;
    can_manage: boolean;
  }[];
  invitations: { id: string; email: string; preset: string }[];
}

interface Invitation {
  id: string;
  token: string;
  bolo_id: string;
  bolo_preset: string;
}

describe.skipIf(!envReady() || !limitedEnvReady())('RLS: el equipo de una noche (membresía de bolo)', () => {
  let adminJwt: string;
  let limitedJwt: string;
  let limitedUserId: string;
  let limitedEmail: string;
  let projectId: string;
  let boloA: string;
  let boloB: string;
  let perfA1: string;
  let perfA2: string;
  let perfB: string;
  let perfLoose: string;

  async function visiblePerformances(jwt: string): Promise<string[]> {
    const res = await pgGet<{ id: string }>(
      'performance',
      jwt,
      new URLSearchParams({ id: `in.(${[perfA1, perfA2, perfB, perfLoose].join(',')})`, select: 'id' }),
    );
    expect(res.status).toBe(200);
    return res.rows.map((r) => r.id).sort();
  }

  async function grant(bolo: string, preset: string): Promise<string> {
    const res = await pgRpc<string>('grant_container_preset', adminJwt, {
      p_level: 'bolo',
      p_container_id: bolo,
      p_user_id: limitedUserId,
      p_preset: preset,
    });
    expect(res.status, res.error).toBe(200);
    return res.data!;
  }

  async function revokeBoloMemberships() {
    for (const bolo of [boloA, boloB]) {
      if (!bolo) continue;
      const access = await pgRpc<Access>('bolo_access', adminJwt, { p_bolo_id: bolo });
      for (const m of access.data?.members ?? []) {
        if (m.user_id === limitedUserId) await pgRpc('revoke_membership', adminJwt, { p_membership_id: m.membership_id });
      }
      for (const inv of access.data?.invitations ?? []) {
        await pgRpc('revoke_workspace_invitation', adminJwt, { p_invitation_id: inv.id });
      }
    }
  }

  beforeAll(async () => {
    const admin = requireEnv();
    adminJwt = await login(admin.email, admin.password);
    const limited = requireLimitedEnv();
    limitedEmail = limited.email;
    limitedJwt = await login(limited.email, limited.password);
    limitedUserId = String(decodeJwt(limitedJwt).sub);

    const projects = await pgGet<{ id: string }>(
      'project',
      adminJwt,
      new URLSearchParams({ slug: 'eq.zzz-rls-foreign-project', select: 'id' }),
    );
    projectId = projects.rows[0]!.id;

    const bolo = async (label: string) => {
      const res = await pgRpc<{ id: string }>('create_bolo', adminJwt, {
        p_project_id: projectId,
        p_venue_name: `RLS noche ${label} ${RUN}`,
        p_fee_amount: 4321,
        p_status: 'proposed',
      });
      expect(res.status, res.error).toBe(200);
      return one(res.data)!.id;
    };
    const performance = async (date: string, boloRef: string | null) => {
      const res = await pgRpc<{ id: string }>('create_performance', adminJwt, {
        p_project_id: projectId,
        p_performed_at: date,
        p_venue_name: `RLS noche ${RUN}`,
        ...(boloRef ? { p_bolo_id: boloRef } : {}),
      });
      expect(res.status, res.error).toBe(200);
      return one(res.data)!.id;
    };

    boloA = await bolo('A');
    boloB = await bolo('B');
    perfA1 = await performance('2027-04-10', boloA);
    perfA2 = await performance('2027-04-11', boloA);
    perfB = await performance('2027-04-20', boloB);
    perfLoose = await performance('2027-04-25', null);
  });

  afterAll(async () => {
    await revokeBoloMemberships();
    for (const id of [perfA1, perfA2, perfB, perfLoose]) {
      if (id) await pgRpc('delete_performance', adminJwt, { p_performance_id: id });
    }
    for (const id of [boloA, boloB]) {
      if (id) await pgRpc('delete_bolo', adminJwt, { p_bolo_id: id });
    }
  });

  test('sin membresía no lee ninguna función del proyecto ajeno', async () => {
    expect(await visiblePerformances(limitedJwt)).toEqual([]);
    expect((await pgRpc('bolo_access', limitedJwt, { p_bolo_id: boloA })).status).toBe(403);
  });

  test('la membresía de bolo lee las funciones de su bolo y nada más, sin dinero', async () => {
    await grant(boloA, 'equip');
    try {
      expect(await visiblePerformances(limitedJwt)).toEqual([perfA1, perfA2].sort());
      // El bolo es dinero: por la API, cerrado.
      expect((await pgGet('bolo', limitedJwt, new URLSearchParams({ id: `eq.${boloA}`, select: 'id' }))).rows).toHaveLength(0);
      // bolo_id sigue fuera del grant por columnas.
      const col = await pgGet('performance', limitedJwt, new URLSearchParams({ id: `eq.${perfA1}`, select: 'id,bolo_id' }));
      expect(col.status).toBeGreaterThanOrEqual(400);
      // El tablón, por la cadena.
      expect((await pgRpc('bolo_board', limitedJwt, { p_performance_id: perfA1 })).status).toBe(200);
      expect((await pgRpc('bolo_board', limitedJwt, { p_performance_id: perfB })).status).toBe(403);
    } finally {
      await revokeBoloMemberships();
    }
    expect(await visiblePerformances(limitedJwt)).toEqual([]);
  });

  test('caducidad a mano: en el pasado no da nada; sin fecha, vuelve', async () => {
    const membershipId = await grant(boloA, 'minim');
    try {
      const past = new Date(Date.now() - 60_000).toISOString();
      const cut = await pgRpc('set_membership_expiry', adminJwt, { p_membership_id: membershipId, p_expires_at: past });
      expect(cut.status, cut.error).toBeLessThan(300);
      expect(await visiblePerformances(limitedJwt)).toEqual([]);
      expect((await pgRpc('bolo_board', limitedJwt, { p_performance_id: perfA1 })).status).toBe(403);
      expect((await pgRpc('bolo_access', limitedJwt, { p_bolo_id: boloA })).status).toBe(403);

      const open = await pgRpc('set_membership_expiry', adminJwt, { p_membership_id: membershipId, p_expires_at: null });
      expect(open.status, open.error).toBeLessThan(300);
      expect(await visiblePerformances(limitedJwt)).toEqual([perfA1, perfA2].sort());

      // Una membresía que no es de bolo no caduca.
      const ws = await pgGet<{ id: string }>(
        'membership',
        limitedJwt,
        new URLSearchParams({ user_id: `eq.${limitedUserId}`, level: 'eq.workspace', select: 'id', limit: '1' }),
      );
      const wrong = await pgRpc('set_membership_expiry', adminJwt, { p_membership_id: ws.rows[0]!.id, p_expires_at: past });
      expect(wrong.status).toBe(400);
      // La fixture no puede tocar su propia membresía (no podría haberla dado).
      const self = await pgRpc('set_membership_expiry', limitedJwt, { p_membership_id: membershipId, p_expires_at: null });
      expect(self.status).toBe(403);
    } finally {
      await revokeBoloMemberships();
    }
  });

  test('invitación de bolo: se crea, se ve, se acepta y caduca con el bolo', async () => {
    const created = await pgRpc<Invitation[]>('create_bolo_invitation', adminJwt, {
      p_bolo_id: boloA,
      p_email: limitedEmail.toUpperCase(),
      p_preset: 'equip',
    });
    expect(created.status, created.error).toBe(200);
    const inv = one(created.data)!;
    expect(inv).toMatchObject({ bolo_id: boloA, bolo_preset: 'equip' });
    try {
      const pending = await pgRpc<Access>('bolo_access', adminJwt, { p_bolo_id: boloA });
      expect(pending.data!.invitations.map((i) => i.id)).toContain(inv.id);

      const preview = await pgRpc<{ bolo_id: string; landing_performance_id: string; role: string; project_id: string | null }[]>(
        'preview_workspace_invitation',
        limitedJwt,
        { p_token: inv.token },
      );
      expect(preview.status, preview.error).toBe(200);
      expect(one(preview.data)).toMatchObject({ bolo_id: boloA, landing_performance_id: perfA1, role: 'guest', project_id: null });

      const accepted = await pgRpc<{ role: string }[]>('accept_workspace_invitation', limitedJwt, { p_token: inv.token });
      expect(accepted.status, accepted.error).toBe(200);
      // La fixture ya era member: aceptar un bolo no le cambia el rol del espacio.
      expect(one(accepted.data)!.role).toBe('member');

      expect(await visiblePerformances(limitedJwt)).toEqual([perfA1, perfA2].sort());
      const access = await pgRpc<Access>('bolo_access', limitedJwt, { p_bolo_id: boloA });
      expect(access.status, access.error).toBe(200);
      const me = access.data!.members.find((m) => m.user_id === limitedUserId)!;
      expect(me).toMatchObject({ preset: 'equip', expires_with_bolo: true, live: true });
      // Último día de acceso: el siguiente a la última función (2027-04-11).
      expect(me.ends_at!.slice(0, 10)).toMatch(/^2027-04-1[23]$/);
      expect(access.data!.ends_at).toBe(me.ends_at);
      // Gastada: no se acepta dos veces.
      expect((await pgRpc('accept_workspace_invitation', limitedJwt, { p_token: inv.token })).status).toBe(403);
    } finally {
      await revokeBoloMemberships();
    }
  });

  test('techo del delegante: con Mínim en el bolo invita con Mínim y no con Equip; en otro bolo, nada', async () => {
    await grant(boloA, 'minim');
    try {
      const equip = await pgRpc('create_bolo_invitation', limitedJwt, {
        p_bolo_id: boloA,
        p_email: `rls-noche-${RUN}@example.test`,
        p_preset: 'equip',
      });
      expect(equip.status).toBe(403);
      const elsewhere = await pgRpc('create_bolo_invitation', limitedJwt, {
        p_bolo_id: boloB,
        p_email: `rls-noche-${RUN}@example.test`,
        p_preset: 'minim',
      });
      expect(elsewhere.status).toBe(403);

      const minim = await pgRpc<Invitation[]>('create_bolo_invitation', limitedJwt, {
        p_bolo_id: boloA,
        p_email: `rls-noche-${RUN}@example.test`,
        p_preset: 'minim',
      });
      expect(minim.status, minim.error).toBe(200);
      const access = await pgRpc<Access>('bolo_access', limitedJwt, { p_bolo_id: boloA });
      expect(access.data!.can_invite).toEqual({ minim: true, equip: false });
      expect(access.data!.invitations.map((i) => i.id)).toContain(one(minim.data)!.id);
      // Quien podría haberla dado la revoca.
      const revoked = await pgRpc('revoke_workspace_invitation', limitedJwt, { p_invitation_id: one(minim.data)!.id });
      expect(revoked.status, revoked.error).toBeLessThan(300);
      expect((await pgRpc<Access>('bolo_access', limitedJwt, { p_bolo_id: boloA })).data!.invitations).toHaveLength(0);
    } finally {
      await revokeBoloMemberships();
    }
  });

  test('una invitación de bolo es Mínim o Equip, con un email válido', async () => {
    for (const preset of ['coordinacio', 'direccio', 'nada']) {
      const res = await pgRpc('create_bolo_invitation', adminJwt, {
        p_bolo_id: boloA,
        p_email: `rls-noche-${RUN}@example.test`,
        p_preset: preset,
      });
      expect(res.status, preset).toBe(400);
    }
    const bad = await pgRpc('create_bolo_invitation', adminJwt, { p_bolo_id: boloA, p_email: 'sin-arroba', p_preset: 'minim' });
    expect(bad.status).toBe(400);
    const missing = await pgRpc('create_bolo_invitation', adminJwt, { p_bolo_id: NOWHERE, p_email: 'a@example.test' });
    expect(missing.status).toBe(403);
  });

  test('membership_facet lleva id', async () => {
    const res = await pgGet<{ id: string }>('membership_facet', adminJwt, new URLSearchParams({ select: 'id', limit: '1' }));
    expect(res.status).toBe(200);
    expect(res.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('anon no llama a nada nuevo', async () => {
    const calls: [string, Record<string, unknown>][] = [
      ['create_bolo_invitation', { p_bolo_id: boloA, p_email: 'anon@example.test' }],
      ['bolo_access', { p_bolo_id: boloA }],
      ['set_membership_expiry', { p_membership_id: NOWHERE, p_expires_at: null }],
    ];
    for (const [fn, args] of calls) {
      expect((await pgRpc(fn, null, args)).status, fn).toBeGreaterThanOrEqual(400);
    }
  });
});
