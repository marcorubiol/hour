/**
 * Alta directa de una persona (136): lo que ⌘K abre sin conversación. Lo que
 * el diálogo manda a `POST /api/persons`.
 */

/** What the person dialog sends: empty fields leave, never travel as ''. */
export function personCreateBody(input: {
  workspaceId: string;
  fullName: string;
  title: string;
  email: string;
  phone: string;
}): Record<string, string> {
  const body: Record<string, string> = { workspace_id: input.workspaceId, full_name: input.fullName.trim() };
  const optional = { title: input.title, email: input.email, phone: input.phone };
  for (const [key, value] of Object.entries(optional)) if (value.trim()) body[key] = value.trim();
  return body;
}
