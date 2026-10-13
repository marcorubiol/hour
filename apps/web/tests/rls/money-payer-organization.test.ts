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
 * ADR-102 fase 2b · el pagador es la organización
 * (20261012200000_invoice_payer_organization).
 *
 * Lo que fija este fichero:
 * - `list_money_payer_organizations` lista la organización de una conversación
 *   compartida a otro editor de dinero, pero no la de mi conversación privada;
 *   a mí, las dos;
 * - `create_invoice_from_bolo` infiere `payer_organization_id` de la
 *   conversación del bolo (no de una privada ajena), y la llamada del Worker
 *   anterior (11 parámetros con `p_payer_person_id`) sigue resolviendo;
 * - `set_organization_fiscal_identity` la escribe quien edita dinero, sin ser
 *   admin; la factura nueva la toma por defecto e `issue_invoice` la congela;
 * - `update_invoice` con `payer_organization_id`: la vuelve a tomar en un
 *   borrador; rechaza una organización que no es del espacio (42501) y
 *   cualquier cambio de pagador en una emitida (22023);
 * - `workspace_organization.fiscal_identity_id` no se escribe por PostgREST.
 * El guard (receptora viva del mismo espacio) no tiene camino por API: se
 * comprobó contra la base local al escribir la migración.
 *
 * Fixture: `playwright`, proyecto `zzz-e2e-collab`, organizaciones
 * `ZZZ 2B Payer …` propias (se quedan; sus conversaciones se borran y la pasada
 * siguiente las revive). La identidad fiscal creada se borra (soft) al final:
 * la siguiente pasada crea otra. Nunca toca `muk-cia`. Va rojo contra un
 * origen sin `20261012200000`.
 */
const ORG_SHARED = 'ZZZ 2B Payer Shared';
const ORG_PRIVATE = 'ZZZ 2B Payer Private';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const FOREIGN_ORG = '00000000-0000-4000-8000-0000000002b0';

interface ConversationRow {
  id: string;
  organization_id: string | null;
  private_to: string | null;
}

interface PayerOrgRow {
  id: string;
  name: string;
  has_fiscal_identity: boolean;
}

interface InvoiceRow {
  id: string;
  status: string;
  payer_organization_id: string | null;
  payer_fiscal_identity_id: string | null;
  payer_snapshot: { legal_name?: string } | null;
}

interface FiscalRow {
  id: string;
  kind: string;
  legal_name: string;
  workspace_id: string;
}

interface ProjectMembershipRow {
  id: string;
  roles: string[];
  permission_grants: string[];
  permission_revokes: string[];
}

const one = <T>(data: T | T[] | null): T | undefined =>
  Array.isArray(data) ? data[0] : (data ?? undefined);

describe.skipIf(!envReady() || !limitedEnvReady())('the payer is the organization (ADR-102 fase 2b)', () => {
  let jwt: string;
  let other: string;
  let me: string;
  let workspaceId: string;
  let projectId: string;
  let originalSetting: boolean | undefined;
  let membership: ProjectMembershipRow | undefined;
  let shared: ConversationRow | undefined;
  let mine: ConversationRow | undefined;
  let sharedBolo: string | undefined;
  let privateBolo: string | undefined;
  const invoices: string[] = [];
  const fiscalIds = new Set<string>();

  async function setSetting(value: boolean) {
    const r = await pgPatch<{ new_conversations_private: boolean }>(
      'workspace',
      jwt,
      { new_conversations_private: value },
      new URLSearchParams({ id: `eq.${workspaceId}` }),
    );
    expect(r.rows[0]?.new_conversations_private).toBe(value);
  }

  async function payerOrgs(as: string): Promise<PayerOrgRow[]> {
    const r = await pgRpc<PayerOrgRow[]>('list_money_payer_organizations', as, { p_project_ids: [projectId] });
    expect(r.status, r.error).toBe(200);
    return r.data ?? [];
  }

  async function invoice(as: string, bolo: string, extra: Record<string, unknown> = {}): Promise<InvoiceRow> {
    const r = await pgRpc<InvoiceRow>('create_invoice_from_bolo', as, {
      p_bolo_id: bolo,
      p_doc_type: 'proforma',
      ...extra,
    });
    expect(r.status, r.error).toBe(200);
    const row = one(r.data)!;
    invoices.push(row.id);
    return row;
  }

  async function conversation(organization: string): Promise<ConversationRow> {
    const c = await pgRpc<ConversationRow>('create_conversation', jwt, {
      p_project_id: projectId,
      p_organization_name: organization,
    });
    expect(c.status, c.error).toBe(200);
    return one(c.data)!;
  }

  async function bolo(conversationId: string, venue: string): Promise<string> {
    const b = await pgRpc<{ id: string }>('create_bolo', jwt, {
      p_project_id: projectId,
      p_venue_name: venue,
      p_fee_amount: 1000,
      p_conversation_id: conversationId,
    });
    expect(b.status, b.error).toBe(200);
    return one(b.data)!.id;
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

    // The other person edits money in the project, without being an admin.
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
        permission_grants: [...new Set([...membership.permission_grants, 'read:money', 'edit:money'])],
        permission_revokes: membership.permission_revokes.filter(
          (perm) => perm !== 'read:money' && perm !== 'edit:money',
        ),
      },
      new URLSearchParams({ id: `eq.${membership.id}` }),
    );
    expect(granted.rows).toHaveLength(1);

    await setSetting(false);
    shared = await conversation(ORG_SHARED);
    expect(shared.private_to).toBeNull();
    await setSetting(true);
    mine = await conversation(ORG_PRIVATE);
    expect(mine.private_to).toBe(me);

    sharedBolo = await bolo(shared.id, `ZZZ 2B Shared ${RUN}`);
    privateBolo = await bolo(mine.id, `ZZZ 2B Private ${RUN}`);
  });

  afterAll(async () => {
    for (const id of invoices) {
      // Issued ones go back to draft first: delete_invoice only takes drafts.
      await pgRpc('update_invoice', jwt, { p_invoice_id: id, p_patch: { status: 'draft' } }).catch(() => undefined);
      await pgRpc('delete_invoice', jwt, { p_invoice_id: id }).catch(() => undefined);
    }
    for (const id of [sharedBolo, privateBolo]) {
      if (id) await pgRpc('delete_bolo', jwt, { p_bolo_id: id }).catch(() => undefined);
    }
    for (const c of [shared, mine]) {
      if (c) await pgRpc('delete_conversation', jwt, { p_conversation_id: c.id }).catch(() => undefined);
    }
    for (const id of fiscalIds) {
      await pgPatch('fiscal_identity', jwt, { deleted_at: new Date().toISOString() }, new URLSearchParams({ id: `eq.${id}` }));
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

  test('list_money_payer_organizations: a private conversation\'s organization is only its owner\'s', async () => {
    const theirs = (await payerOrgs(other)).map((o) => o.id);
    expect(theirs).toContain(shared!.organization_id);
    expect(theirs).not.toContain(mine!.organization_id);
    const ours = (await payerOrgs(jwt)).map((o) => o.id);
    expect(ours).toEqual(expect.arrayContaining([shared!.organization_id, mine!.organization_id]));
  });

  test('create_invoice_from_bolo: the payer is the conversation\'s organization, not from a private one of someone else', async () => {
    expect((await invoice(other, sharedBolo!)).payer_organization_id).toBe(shared!.organization_id);
    expect((await invoice(other, privateBolo!)).payer_organization_id).toBeNull();
    expect((await invoice(jwt, privateBolo!)).payer_organization_id).toBe(mine!.organization_id);
  });

  test('the deployed Worker\'s call (11 named parameters) still resolves', async () => {
    const row = await invoice(other, sharedBolo!, {
      p_tax_lines: [],
      p_number: null,
      p_due_on: null,
      p_notes: null,
      p_expected_on: null,
      p_payment_condition: null,
      p_payer_person_id: null,
      p_payer_fiscal_identity_id: null,
      p_country: null,
    });
    expect(row.payer_organization_id).toBe(shared!.organization_id);
  });

  test('fiscal data: a money editor sets them; a new draft takes them; a stale draft picks them up; issue freezes them', async () => {
    const before = await invoice(other, sharedBolo!);

    const legal = `ZZZ 2B Sala SL ${RUN}`;
    const set = await pgRpc<FiscalRow>('set_organization_fiscal_identity', other, {
      p_organization_id: shared!.organization_id,
      p_fiscal: { legal_name: legal, tax_id: 'B12345678', city: 'Girona', country: 'es' },
    });
    expect(set.status, set.error).toBe(200);
    const fiscal = one(set.data)!;
    fiscalIds.add(fiscal.id);
    expect(fiscal.kind).toBe('receiver');
    expect(fiscal.workspace_id).toBe(workspaceId);

    // Editing again keeps the same identity.
    const again = await pgRpc<FiscalRow>('set_organization_fiscal_identity', other, {
      p_organization_id: shared!.organization_id,
      p_fiscal: { legal_name: legal, tax_id: 'B12345678', city: 'Girona', country: 'ES' },
    });
    expect(again.status, again.error).toBe(200);
    expect(one(again.data)!.id).toBe(fiscal.id);

    const listed = (await payerOrgs(other)).find((o) => o.id === shared!.organization_id);
    expect(listed?.has_fiscal_identity).toBe(true);

    // The draft made before has none; setting its payer again picks them up.
    expect(before.payer_fiscal_identity_id).toBeNull();
    const synced = await pgRpc<InvoiceRow>('update_invoice', other, {
      p_invoice_id: before.id,
      p_patch: { payer_organization_id: shared!.organization_id },
    });
    expect(synced.status, synced.error).toBe(200);
    expect(one(synced.data)!.payer_fiscal_identity_id).toBe(fiscal.id);

    const after = await invoice(other, sharedBolo!);
    expect(after.payer_fiscal_identity_id).toBe(fiscal.id);
    const issued = await pgRpc<InvoiceRow>('issue_invoice', other, { p_invoice_id: after.id });
    expect(issued.status, issued.error).toBe(200);
    expect(one(issued.data)!.payer_snapshot?.legal_name).toBe(legal);

    // An issued invoice keeps its payer.
    const locked = await pgRpc('update_invoice', other, {
      p_invoice_id: after.id,
      p_patch: { payer_organization_id: null },
    });
    expect(locked.status).toBe(400);
  });

  test('update_invoice: an organization outside the workspace is refused', async () => {
    const draft = await invoice(other, sharedBolo!);
    const r = await pgRpc('update_invoice', other, {
      p_invoice_id: draft.id,
      p_patch: { payer_organization_id: FOREIGN_ORG },
    });
    expect(r.status).toBe(403);
    const c = await pgRpc('create_invoice_from_bolo', other, {
      p_bolo_id: sharedBolo,
      p_doc_type: 'proforma',
      p_payer_organization_id: FOREIGN_ORG,
    });
    expect(c.status).toBe(403);
  });

  test('fiscal_identity_id on an organization is not writable through PostgREST', async () => {
    const r = await pgPatch(
      'workspace_organization',
      jwt,
      { fiscal_identity_id: null },
      new URLSearchParams({ id: `eq.${shared!.organization_id}` }),
    );
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});
