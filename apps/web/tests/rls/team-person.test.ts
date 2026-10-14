/**
 * ADR-107 · dar de alta a alguien del equipo sin conversación.
 *
 * `create_workspace_person` (persona global anónima + dossier local, dedupe
 * por email en el espacio), `update_workspace_person` (la ficha) e
 * `invite_workspace_person` (la invitación nombra el dossier y aceptarla
 * enlaza la cuenta con él si la cuenta aún no es nadie).
 *
 * The fixtures' dossiers are left behind on purpose, with a `zzz-` prefix and
 * a random tail, in the test workspace `playwright`: there is no delete RPC
 * for a dossier, and leaving them is what a real company would see.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  decodeJwt,
  envReady,
  externalEnvReady,
  limitedEnvReady,
  login,
  pgGet,
  pgRpc,
  requireEnv,
  requireExternalEnv,
  requireLimitedEnv,
} from './_helpers';

type Dossier = {
  workspace_id: string;
  person_id: string;
  slug: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
};

const tail = () => Math.random().toString(16).slice(2, 10);

describe.skipIf(!envReady())('RLS — create_workspace_person (ADR-107)', () => {
  let adminJwt: string;
  let workspaceId: string;

  beforeAll(async () => {
    const admin = requireEnv();
    adminJwt = await login(admin.email, admin.password);
    const ws = await pgGet<{ id: string }>(
      'workspace',
      adminJwt,
      new URLSearchParams({ slug: 'eq.playwright', select: 'id' }),
    );
    workspaceId = ws.rows[0].id;
  });

  test('an admin creates a dossier with only a name; the global person is anonymous', async () => {
    const name = `Zzz Team ${tail()}`;
    const res = await pgRpc<Dossier>('create_workspace_person', adminJwt, {
      p_workspace_id: workspaceId,
      p_full_name: `  ${name}  `,
    });
    expect(res.status, res.error).toBe(200);
    expect(res.data).toMatchObject({
      workspace_id: workspaceId,
      full_name: name,
      email: null,
      phone: null,
      title: null,
    });
    expect(res.data!.slug).toMatch(/^zzz-team-[0-9a-f]+/);

    const person = await pgGet<{ full_name: string; email: string | null }>(
      'person',
      adminJwt,
      new URLSearchParams({ id: `eq.${res.data!.person_id}`, select: 'full_name,email' }),
    );
    // The global identity carries nothing the company typed (pattern of
    // add_conversation_contact): the name lives in the dossier.
    if (person.rows.length > 0) {
      expect(person.rows[0].full_name).toMatch(/^Person [0-9a-f]{8}$/);
      expect(person.rows[0].email).toBeNull();
    }
  });

  test('the same email in the workspace returns the existing dossier', async () => {
    const email = `zzz-team-${tail()}@hour.test`;
    const first = await pgRpc<Dossier>('create_workspace_person', adminJwt, {
      p_workspace_id: workspaceId,
      p_full_name: 'Zzz Dedupe One',
      p_email: email,
      p_phone: '+34 600 000 000',
      p_title: 'Técnica de luces',
    });
    expect(first.status, first.error).toBe(200);
    expect(first.data).toMatchObject({ email, phone: '+34 600 000 000', title: 'Técnica de luces' });

    const again = await pgRpc<Dossier>('create_workspace_person', adminJwt, {
      p_workspace_id: workspaceId,
      p_full_name: 'Zzz Dedupe Two',
      p_email: email.toUpperCase(),
    });
    expect(again.status, again.error).toBe(200);
    expect(again.data!.person_id).toBe(first.data!.person_id);
    expect(again.data!.full_name).toBe('Zzz Dedupe One');
  });

  test('a repeated name gets its own slug', async () => {
    const name = `Zzz Same ${tail()}`;
    const a = await pgRpc<Dossier>('create_workspace_person', adminJwt, {
      p_workspace_id: workspaceId,
      p_full_name: name,
    });
    const b = await pgRpc<Dossier>('create_workspace_person', adminJwt, {
      p_workspace_id: workspaceId,
      p_full_name: name,
    });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.data!.person_id).not.toBe(a.data!.person_id);
    expect(b.data!.slug).not.toBe(a.data!.slug);
  });

  test('an empty name and a bad email are 22023', async () => {
    const empty = await pgRpc('create_workspace_person', adminJwt, {
      p_workspace_id: workspaceId,
      p_full_name: '   ',
    });
    expect(empty.status).toBe(400);
    expect(empty.error).toContain('22023');
    const bad = await pgRpc('create_workspace_person', adminJwt, {
      p_workspace_id: workspaceId,
      p_full_name: 'Zzz Bad Email',
      p_email: 'not-an-email',
    });
    expect(bad.status).toBe(400);
    expect(bad.error).toContain('22023');
  });

  test.skipIf(!limitedEnvReady())(
    'a workspace member creates one (same rule as the dossier policies)',
    async () => {
      const limited = requireLimitedEnv();
      const jwt = await login(limited.email, limited.password);
      const res = await pgRpc<Dossier>('create_workspace_person', jwt, {
        p_workspace_id: workspaceId,
        p_full_name: `Zzz By Member ${tail()}`,
      });
      expect(res.status, res.error).toBe(200);
    },
  );

  test.skipIf(!externalEnvReady())('someone outside the workspace gets 42501', async () => {
    const external = requireExternalEnv();
    const jwt = await login(external.email, external.password);
    const res = await pgRpc('create_workspace_person', jwt, {
      p_workspace_id: workspaceId,
      p_full_name: 'Zzz Intruder',
    });
    expect(res.status).toBe(403);
    expect(res.error).toContain('42501');
    const upd = await pgRpc('update_workspace_person', jwt, {
      p_workspace_id: workspaceId,
      p_person_id: '00000000-0000-4000-8000-000000000000',
      p_full_name: 'Zzz Intruder',
    });
    expect(upd.status).toBe(403);
  });

  test('anon is refused', async () => {
    const res = await pgRpc('create_workspace_person', null, {
      p_workspace_id: workspaceId,
      p_full_name: 'Zzz Anon',
    });
    expect([401, 403, 404]).toContain(res.status);
  });

  test('the file edits name, email, phone and title; a taken email is 23505', async () => {
    const created = await pgRpc<Dossier>('create_workspace_person', adminJwt, {
      p_workspace_id: workspaceId,
      p_full_name: `Zzz Edit ${tail()}`,
    });
    const taken = await pgRpc<Dossier>('create_workspace_person', adminJwt, {
      p_workspace_id: workspaceId,
      p_full_name: 'Zzz Taken',
      p_email: `zzz-taken-${tail()}@hour.test`,
    });
    const email = `zzz-edit-${tail()}@hour.test`;
    const upd = await pgRpc<Dossier>('update_workspace_person', adminJwt, {
      p_workspace_id: workspaceId,
      p_person_id: created.data!.person_id,
      p_full_name: 'Zzz Edited',
      p_email: email,
      p_phone: '600 111 222',
      p_title: 'Regidora',
    });
    expect(upd.status, upd.error).toBe(200);
    expect(upd.data).toMatchObject({
      full_name: 'Zzz Edited',
      email,
      phone: '600 111 222',
      title: 'Regidora',
      slug: created.data!.slug,
    });

    const clash = await pgRpc('update_workspace_person', adminJwt, {
      p_workspace_id: workspaceId,
      p_person_id: created.data!.person_id,
      p_full_name: 'Zzz Edited',
      p_email: taken.data!.email,
    });
    expect(clash.status).toBe(409);
  });
});

describe.skipIf(!envReady() || !externalEnvReady())(
  'RLS — invite_workspace_person links the dossier on acceptance (ADR-107)',
  () => {
    let adminJwt: string;
    let externalJwt: string;
    let externalUserId: string;
    let workspaceId: string;
    const pending: string[] = [];

    async function removeExternalMembership() {
      const rows = await pgGet<{ id: string }>(
        'membership',
        adminJwt,
        new URLSearchParams({
          level: 'eq.workspace',
          workspace_id: `eq.${workspaceId}`,
          user_id: `eq.${externalUserId}`,
          select: 'id',
        }),
      );
      for (const row of rows.rows) {
        await pgRpc('revoke_workspace_member', adminJwt, { p_membership_id: row.id });
      }
    }

    async function myPersonId(): Promise<string | null> {
      const me = await pgGet<{ person_id: string | null }>(
        'user_profile',
        externalJwt,
        new URLSearchParams({ user_id: `eq.${externalUserId}`, select: 'person_id' }),
      );
      return me.rows[0]?.person_id ?? null;
    }

    beforeAll(async () => {
      const admin = requireEnv();
      const external = requireExternalEnv();
      adminJwt = await login(admin.email, admin.password);
      externalJwt = await login(external.email, external.password);
      externalUserId = String(decodeJwt(externalJwt).sub);
      const ws = await pgGet<{ id: string }>(
        'workspace',
        adminJwt,
        new URLSearchParams({ slug: 'eq.playwright', select: 'id' }),
      );
      workspaceId = ws.rows[0].id;
      await removeExternalMembership();
    });

    afterAll(async () => {
      await removeExternalMembership();
      for (const id of pending) {
        await pgRpc('revoke_workspace_invitation', adminJwt, { p_invitation_id: id });
      }
    });

    test('only an admin invites, with an email, a dossier without an account', async () => {
      const dossier = await pgRpc<Dossier>('create_workspace_person', adminJwt, {
        p_workspace_id: workspaceId,
        p_full_name: `Zzz Invitee ${tail()}`,
      });
      const noEmail = await pgRpc('invite_workspace_person', adminJwt, {
        p_workspace_id: workspaceId,
        p_person_id: dossier.data!.person_id,
        p_email: '',
      });
      expect(noEmail.status).toBe(400);

      if (limitedEnvReady()) {
        const limited = requireLimitedEnv();
        const jwt = await login(limited.email, limited.password);
        const res = await pgRpc('invite_workspace_person', jwt, {
          p_workspace_id: workspaceId,
          p_person_id: dossier.data!.person_id,
          p_email: `zzz-${tail()}@hour.test`,
        });
        expect(res.status).toBe(403);
      }
    });

    /** The account's address is free in the workspace: a previous run's
        dossier gives it up (an email is unique per workspace). */
    async function freeExternalEmail() {
      const holders = await pgGet<Dossier>(
        'workspace_person',
        adminJwt,
        new URLSearchParams({
          workspace_id: `eq.${workspaceId}`,
          email: `eq.${requireExternalEnv().email}`,
          select: 'person_id,full_name,phone,title',
        }),
      );
      for (const h of holders.rows) {
        await pgRpc('update_workspace_person', adminJwt, {
          p_workspace_id: workspaceId,
          p_person_id: h.person_id,
          p_full_name: h.full_name,
          p_email: null,
          p_phone: h.phone,
          p_title: h.title,
        });
      }
    }

    async function inviteAndAccept(personId: string) {
      await removeExternalMembership();
      await freeExternalEmail();
      const invited = await pgRpc<{ id: string; token: string }[]>(
        'invite_workspace_person',
        adminJwt,
        {
          p_workspace_id: workspaceId,
          p_person_id: personId,
          p_email: requireExternalEnv().email,
          p_role: 'guest',
        },
      );
      expect(invited.status, invited.error).toBe(200);
      pending.push(invited.data![0].id);
      const accepted = await pgRpc('accept_workspace_invitation', externalJwt, {
        p_token: invited.data![0].token,
      });
      expect(accepted.status, accepted.error).toBe(200);
      pending.pop();
    }

    test('accepting links the account to that dossier, never rewriting a person', async () => {
      const before = await myPersonId();

      const dossier = await pgRpc<Dossier>('create_workspace_person', adminJwt, {
        p_workspace_id: workspaceId,
        p_full_name: `Zzz Linked ${tail()}`,
      });
      expect(dossier.status, dossier.error).toBe(200);
      await inviteAndAccept(dossier.data!.person_id);

      // The dossier without an email took the invitation's.
      const filled = await pgGet<Dossier>(
        'workspace_person',
        adminJwt,
        new URLSearchParams({
          workspace_id: `eq.${workspaceId}`,
          person_id: `eq.${dossier.data!.person_id}`,
          select: 'email',
        }),
      );
      expect(filled.rows[0].email).toBe(requireExternalEnv().email);

      // An account that is nobody yet becomes this dossier. One that already
      // is somebody (a previous run against the same database) keeps it.
      const after = await myPersonId();
      expect(after).toBe(before ?? dossier.data!.person_id);

      // The open case (ADR-107 §4): a second dossier invited to an account
      // that is already a person. Accepted, not linked, nothing rewritten.
      const other = await pgRpc<Dossier>('create_workspace_person', adminJwt, {
        p_workspace_id: workspaceId,
        p_full_name: `Zzz Second ${tail()}`,
      });
      await inviteAndAccept(other.data!.person_id);
      expect(await myPersonId()).toBe(after);

      // A dossier already linked to an account is not invited again.
      const again = await pgRpc('invite_workspace_person', adminJwt, {
        p_workspace_id: workspaceId,
        p_person_id: after,
        p_email: `zzz-${tail()}@hour.test`,
      });
      expect(again.status).toBe(400);
    });
  },
);
