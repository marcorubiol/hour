import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  envReady,
  limitedEnvReady,
  login,
  pgGet,
  pgPatch,
  pgRpc,
  requireEnv,
  requireLimitedEnv,
} from './_helpers';

/**
 * ADR-099, añadido (firma): la firma es de la persona en cada compañía
 * (20261011400000_mail_signature_person).
 *
 * Lo que fija este fichero:
 * - `my_mail_signature` devuelve solo lo de quien llama, y solo si es
 *   miembro; `set_my_mail_signature` escribe solo la propia, y vacía vuelve
 *   a la propuesta (NULL);
 * - `workspace_membership.mail_signature` no se escribe por PostgREST, y otro
 *   miembro no lee la tuya;
 * - la firma, la web y el teléfono de la compañía: los lee cualquier miembro y
 *   los escribe solo un admin.
 *
 * Fixture: `playwright`. Deja todo como lo encontró. Va rojo contra un origen
 * sin `20261011400000`.
 */
const NOWHERE = '00000000-0000-4000-8000-000000000000';

type Parts = {
  full_name: string | null;
  title: string | null;
  company_name: string | null;
  company_website: string | null;
  company_phone: string | null;
  signature: string | null;
  company_signature: string | null;
};

describe.skipIf(!envReady())('mail signature per person and company (ADR-099)', () => {
  let jwt: string;
  let workspaceId: string;
  let original: Parts | undefined;
  const ws = () => new URLSearchParams({ id: `eq.${workspaceId}`, select: 'website,phone,mail_signature' });

  beforeAll(async () => {
    const env = requireEnv();
    jwt = await login(env.email, env.password);
    const w = await pgGet<{ id: string }>('workspace', jwt, new URLSearchParams({ select: 'id', slug: 'eq.playwright' }));
    if (w.rows.length === 0) throw new Error('playwright workspace missing');
    workspaceId = w.rows[0]!.id;
    const r = await pgRpc<Parts[]>('my_mail_signature', jwt, { p_workspace_id: workspaceId });
    original = r.data?.[0];
  });

  afterAll(async () => {
    if (!original) return;
    await pgRpc('set_my_mail_signature', jwt, { p_workspace_id: workspaceId, p_signature: original.signature });
    await pgPatch(
      'workspace',
      jwt,
      { website: original.company_website, phone: original.company_phone, mail_signature: original.company_signature },
      ws(),
    );
  });

  test('anon gets nothing and writes nothing', async () => {
    const r = await pgRpc('my_mail_signature', null, { p_workspace_id: workspaceId });
    expect(r.status).toBeGreaterThanOrEqual(400);
    const s = await pgRpc('set_my_mail_signature', null, { p_workspace_id: workspaceId, p_signature: 'x' });
    expect(s.status).toBeGreaterThanOrEqual(400);
  });

  test('a member reads their own parts, with the company name', () => {
    expect(original).toBeDefined();
    expect(original?.company_name).toBeTruthy();
  });

  test('a member sets their own signature, trimmed; empty goes back to the proposal', async () => {
    const set = await pgRpc('set_my_mail_signature', jwt, { p_workspace_id: workspaceId, p_signature: '  ZZZ firma  ' });
    expect(set.status).toBeLessThan(300);
    const r = await pgRpc<Parts[]>('my_mail_signature', jwt, { p_workspace_id: workspaceId });
    expect(r.data?.[0]?.signature).toBe('ZZZ firma');
    await pgRpc('set_my_mail_signature', jwt, { p_workspace_id: workspaceId, p_signature: '  ' });
    const back = await pgRpc<Parts[]>('my_mail_signature', jwt, { p_workspace_id: workspaceId });
    expect(back.data?.[0]?.signature).toBeNull();
  });

  test('outside the workspace: no parts, no write, no oracle', async () => {
    const r = await pgRpc<Parts[]>('my_mail_signature', jwt, { p_workspace_id: NOWHERE });
    expect(r.data ?? []).toHaveLength(0);
    const s = await pgRpc('set_my_mail_signature', jwt, { p_workspace_id: NOWHERE, p_signature: 'x' });
    expect(s.status).toBe(403);
  });

  test('the membership column is not writable through PostgREST', async () => {
    const upd = await pgPatch(
      'workspace_membership',
      jwt,
      { mail_signature: 'ZZZ direct' },
      new URLSearchParams({ workspace_id: `eq.${workspaceId}` }),
    );
    expect(upd.status === 401 || upd.status === 403 || upd.rows.length === 0).toBe(true);
  });

  test('an admin sets the company signature, website and phone', async () => {
    const set = await pgPatch<{ website: string; phone: string; mail_signature: string }>(
      'workspace',
      jwt,
      { website: 'https://zzz.example', phone: '+34 000', mail_signature: 'ZZZ compañía' },
      ws(),
    );
    expect(set.rows[0]).toMatchObject({ website: 'https://zzz.example', phone: '+34 000', mail_signature: 'ZZZ compañía' });
    const r = await pgRpc<Parts[]>('my_mail_signature', jwt, { p_workspace_id: workspaceId });
    expect(r.data?.[0]).toMatchObject({ company_website: 'https://zzz.example', company_signature: 'ZZZ compañía' });
  });

  test.skipIf(!limitedEnvReady())(
    'another member: reads the company signature, cannot change it, and never sees mine',
    async () => {
      const limited = requireLimitedEnv();
      const other = await login(limited.email, limited.password);
      await pgRpc('set_my_mail_signature', jwt, { p_workspace_id: workspaceId, p_signature: 'ZZZ solo mía' });

      const read = await pgGet<{ mail_signature: string }>('workspace', other, ws());
      expect(read.rows[0]?.mail_signature).toBe('ZZZ compañía');
      const denied = await pgPatch('workspace', other, { mail_signature: 'ZZZ intruso' }, ws());
      expect(denied.rows).toHaveLength(0);

      const theirs = await pgRpc<Parts[]>('my_mail_signature', other, { p_workspace_id: workspaceId });
      expect(theirs.data?.[0]?.signature ?? null).not.toBe('ZZZ solo mía');
      const rows = await pgGet<{ mail_signature: string | null }>(
        'workspace_membership',
        other,
        new URLSearchParams({ select: 'mail_signature', workspace_id: `eq.${workspaceId}`, mail_signature: 'eq.ZZZ solo mía' }),
      );
      expect(rows.rows).toHaveLength(0);
    },
  );
});
