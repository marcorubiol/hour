import { afterAll, beforeAll, describe, expect, test } from 'vitest';
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

/**
 * ADR-099 §4 · el pagador no sale de una conversación privada ajena
 * (20261011700000_money_payers_private), puesto al día con ADR-102 fase 4
 * (20261013100000_conversation_with_organization_contract): ya no hay pagador
 * persona (`list_money_payers` e `invoice.payer_person_id` fuera); el pagador
 * es la organización.
 *
 * El caso general (organización de una privada mía: la lista y la inferencia
 * son solo mías) lo fija `money-payer-organization.test.ts`. Aquí queda lo que
 * aquel no cubre:
 * - la conversación privada nacida solo con una persona: su organización (la
 *   del dossier o una con el nombre de la persona, que la delata) no sale en
 *   `list_money_payer_organizations` de otro editor de dinero ni se infiere
 *   como pagadora cuando factura otro; a mí, las dos cosas;
 * - lo retirado no vuelve: `list_money_payers` no existe (PGRST202) y la
 *   factura no tiene `payer_person_id`.
 *
 * Fixture: `playwright`, proyecto `zzz-e2e-collab`, persona `zzz-rls-payer-*`.
 * Deja las filas como las encontró. Va rojo contra un origen sin
 * `20261013100000`.
 */
const PAYER_EMAIL = 'zzz-rls-payer-private@hour.test';
const PAYER_NAME = 'ZZZ RLS Payer Private';

interface ConversationRow {
  id: string;
  organization_id: string;
  private_to: string | null;
}

interface PayerOrgRow {
  id: string;
}

interface InvoiceRow {
  id: string;
  payer_organization_id: string | null;
}

interface ProjectMembershipRow {
  id: string;
  roles: string[];
  permission_grants: string[];
  permission_revokes: string[];
}

const one = <T>(data: T | T[] | null): T | undefined =>
  Array.isArray(data) ? data[0] : (data ?? undefined);

describe.skipIf(!envReady() || !limitedEnvReady())(
  "a private conversation's organization is not someone else's payer (ADR-099 §4)",
  () => {
    let jwt: string;
    let other: string;
    let me: string;
    let workspaceId: string;
    let projectId: string;
    let originalSetting: boolean | undefined;
    let membership: ProjectMembershipRow | undefined;
    let conversation: ConversationRow | undefined;
    let boloId: string | undefined;
    const invoices: string[] = [];

    async function setSetting(value: boolean) {
      const r = await pgPatch<{ new_conversations_private: boolean }>(
        'workspace',
        jwt,
        { new_conversations_private: value },
        new URLSearchParams({ id: `eq.${workspaceId}` }),
      );
      expect(r.rows[0]?.new_conversations_private).toBe(value);
    }

    async function payers(as: string): Promise<string[]> {
      const r = await pgRpc<PayerOrgRow[]>('list_money_payer_organizations', as, { p_project_ids: [projectId] });
      expect(r.status, r.error).toBe(200);
      return (r.data ?? []).map((p) => p.id);
    }

    async function invoice(as: string): Promise<InvoiceRow> {
      const r = await pgRpc<InvoiceRow>('create_invoice_from_bolo', as, { p_bolo_id: boloId });
      expect(r.status, r.error).toBe(200);
      const row = one(r.data)!;
      invoices.push(row.id);
      return row;
    }

    beforeAll(async () => {
      const env = requireEnv();
      const limited = requireLimitedEnv();
      jwt = await login(env.email, env.password);
      other = await login(limited.email, limited.password);
      me = String(decodeJwt(jwt).sub);
      const otherSub = String(decodeJwt(other).sub);

      const p = await pgGet<{ id: string; workspace_id: string }>(
        'project',
        jwt,
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

      const ws = await pgGet<{ new_conversations_private: boolean }>(
        'workspace',
        jwt,
        new URLSearchParams({ id: `eq.${workspaceId}`, select: 'new_conversations_private' }),
      );
      originalSetting = ws.rows[0]?.new_conversations_private;

      // La otra persona edita dinero en el proyecto (y no ve conversaciones
      // privadas ajenas, como nadie).
      const m = await pgGet<ProjectMembershipRow>(
        'project_membership',
        jwt,
        new URLSearchParams({
          project_id: `eq.${projectId}`,
          user_id: `eq.${otherSub}`,
          select: 'id,roles,permission_grants,permission_revokes',
        }),
      );
      expect(m.rows).toHaveLength(1);
      membership = m.rows[0]!;
      const granted = await pgPatch(
        'project_membership',
        jwt,
        {
          permission_grants: [
            ...new Set([...membership.permission_grants, 'read:money', 'edit:money']),
          ],
          permission_revokes: membership.permission_revokes.filter(
            (perm) => perm !== 'read:money' && perm !== 'edit:money',
          ),
        },
        new URLSearchParams({ id: `eq.${membership.id}` }),
      );
      expect(granted.rows).toHaveLength(1);

      await setSetting(true);
      const c = await pgRpc<ConversationRow>('create_conversation', jwt, {
        p_project_id: projectId,
        p_full_name: PAYER_NAME,
        p_email: PAYER_EMAIL,
      });
      expect(c.status, c.error).toBe(200);
      conversation = one(c.data)!;
      expect(conversation.private_to).toBe(me);
      expect(conversation.organization_id).toBeTruthy();

      const b = await pgRpc<{ id: string }>('create_bolo', jwt, {
        p_project_id: projectId,
        p_venue_name: 'ZZZ RLS Payer Venue',
        p_fee_amount: 1000,
        p_conversation_id: conversation.id,
      });
      expect(b.status, b.error).toBe(200);
      boloId = one(b.data)!.id;
    });

    afterAll(async () => {
      for (const id of invoices) {
        await pgRpc('delete_invoice', jwt, { p_invoice_id: id }).catch(() => undefined);
      }
      if (boloId) await pgRpc('delete_bolo', jwt, { p_bolo_id: boloId }).catch(() => undefined);
      if (conversation) {
        await pgRpc('delete_conversation', jwt, { p_conversation_id: conversation.id }).catch(
          () => undefined,
        );
      }
      if (originalSetting !== undefined) await setSetting(originalSetting);
      if (membership) {
        await pgPatch(
          'project_membership',
          jwt,
          {
            roles: membership.roles,
            permission_grants: membership.permission_grants,
            permission_revokes: membership.permission_revokes,
          },
          new URLSearchParams({ id: `eq.${membership.id}` }),
        );
      }
    });

    test('list_money_payer_organizations: the owner sees the organization, another money editor does not', async () => {
      expect(await payers(jwt)).toContain(conversation!.organization_id);
      expect(await payers(other)).not.toContain(conversation!.organization_id);
    });

    test('create_invoice_from_bolo: the payer organization is inferred for the owner only', async () => {
      const theirs = await invoice(other);
      expect(theirs.payer_organization_id).toBeNull();
      const mine = await invoice(jwt);
      expect(mine.payer_organization_id).toBe(conversation!.organization_id);
      // Ya no hay pagador persona.
      expect(mine).not.toHaveProperty('payer_person_id');
    });

    test('list_money_payers (persons) is gone', async () => {
      const r = await pgRpc('list_money_payers', jwt, { p_project_ids: [projectId] });
      expect(r.status).toBe(404);
      expect(JSON.parse(r.error!).code).toBe('PGRST202');
    });
  },
);
