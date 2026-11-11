/**
 * Alta directa de una persona y de una organización (136): lo que ⌘K abre
 * sin conversación. Los esquemas que leen `POST /api/persons` y
 * `POST /api/organizations`, la forma que devuelven y lo que el diálogo
 * manda: los dos lados leen lo mismo.
 */

import * as v from 'valibot';
import { fetchJSON } from '$lib/api';
import { ORGANIZATION_KINDS } from '$lib/organization-record';

/**
 * Whether the database makes an organization on its own yet (migration
 * 20261111130000). Until it does, nothing offers it: no ⌘K row, no
 * organization field on a new person. Any doubt reads as «not yet».
 */
export function organizationCreateQueryOptions(enabled = true) {
  return {
    queryKey: ['organization-can-create'] as const,
    enabled,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ available: boolean }>('/api/organizations/can-create', signal),
    staleTime: 10 * 60_000,
    retry: false,
  };
}

const optionalEmail = v.nullish(
  v.union([v.literal(''), v.pipe(v.string(), v.trim(), v.email(), v.maxLength(320))]),
);

/** `POST /api/organizations`: the name, and what the file shows first. */
export const OrganizationCreateSchema = v.object({
  workspace_id: v.pipe(v.string(), v.uuid()),
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
  kind: v.nullish(v.union([v.literal(''), v.picklist(ORGANIZATION_KINDS)])),
  city: v.nullish(v.pipe(v.string(), v.trim(), v.maxLength(120))),
  email: optionalEmail,
});

/** What `POST /api/organizations` answers: enough to open its file. */
export interface CreatedOrganization {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
}

/**
 * A PostgREST `ilike` value that matches the text whole, case aside: its
 * wildcards (`%`, `_`, and `*`, which PostgREST reads as `%`) are escaped.
 */
export function ilikeExact(text: string): string {
  return text.replace(/[\\%_*]/g, (c) => `\\${c}`);
}

/** What the person dialog sends: empty fields leave, never travel as ''. */
export function personCreateBody(input: {
  workspaceId: string;
  fullName: string;
  title: string;
  email: string;
  phone: string;
  organizationId: string | null;
}): Record<string, string> {
  const body: Record<string, string> = { workspace_id: input.workspaceId, full_name: input.fullName.trim() };
  const optional = { title: input.title, email: input.email, phone: input.phone };
  for (const [key, value] of Object.entries(optional)) if (value.trim()) body[key] = value.trim();
  if (input.organizationId) body.organization_id = input.organizationId;
  return body;
}

/** What the organization dialog sends. */
export function organizationCreateBody(input: {
  workspaceId: string;
  name: string;
  kind: string;
  city: string;
  email: string;
}): Record<string, string> {
  const body: Record<string, string> = { workspace_id: input.workspaceId, name: input.name.trim() };
  const optional = { kind: input.kind, city: input.city, email: input.email };
  for (const [key, value] of Object.entries(optional)) if (value.trim()) body[key] = value.trim();
  return body;
}

/**
 * The organization a typed name names in that space: the same name, case and
 * surrounding spaces aside (the rule `create_workspace_organization` refuses
 * a second one by). None for an empty text or a name nobody has yet.
 */
export function matchOrganization<T extends { id: string; workspace_id: string; name: string }>(
  items: readonly T[],
  workspaceId: string,
  text: string,
): T | null {
  const want = text.trim().toLowerCase();
  if (!want) return null;
  return items.find((o) => o.workspace_id === workspaceId && o.name.trim().toLowerCase() === want) ?? null;
}
