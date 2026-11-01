/**
 * Fusionar dos organizaciones del mismo espacio (84, ADR-171): lo que la
 * pantalla decide sin la base. La fusión la hacen las RPC de
 * `20261102140000_organization_merge` (`preview_organization_merge`,
 * `merge_workspace_organization`, `undo_organization_merge`); aquí solo: qué
 * recuentos se dicen, cuál se queda por defecto, qué conversaciones chocan y
 * por qué dijo que no.
 *
 * Mismo flujo que la fusión de persona (`$lib/person-merge`): deshacer dura
 * los mismos 30 días y se mira con el mismo `undoOpen`.
 */

export { UNDO_DAYS, undoOpen } from './person-merge';

/** Una organización tal como la devuelve `preview_organization_merge`. */
export interface OrgMergeSide {
  name: string;
  slug: string;
  kind: string | null;
  email: string | null;
  city: string | null;
  created_at: string;
}

/** Lo que quien llama puede leer de la que desaparece (RLS). */
export interface OrgMergeCounts {
  conversations: number;
  bolos: number;
  contacts: number;
  invoices: number;
  venues: number;
}

/** Una conversación de cada una en el mismo proyecto: la fusión se rechaza. */
export interface OrgMergeClash {
  project_id: string;
  project_name: string;
  keep_conversation_id: string;
  drop_conversation_id: string;
}

export interface OrgMergePreview {
  keep_organization_id: string;
  drop_organization_id: string;
  keep: OrgMergeSide;
  drop: OrgMergeSide;
  counts: OrgMergeCounts;
  conflicts: { conversations: number };
  /** Las que chocan y quien llama ve (la ruta las añade a la RPC). */
  clashes: OrgMergeClash[];
}

/** Los recuentos, en el orden en que se dicen. */
export const ORG_COUNT_ORDER = [
  'conversations',
  'bolos',
  'contacts',
  'venues',
  'invoices',
] as const satisfies readonly (keyof OrgMergeCounts)[];

/** Los recuentos que no son cero, en su orden. */
export function orgCountParts(counts: OrgMergeCounts): Array<{ key: keyof OrgMergeCounts; n: number }> {
  return ORG_COUNT_ORDER.filter((k) => (counts[k] ?? 0) > 0).map((k) => ({ key: k, n: counts[k] }));
}

/** ¿Hay que dar la vuelta a la vista previa? Se queda por defecto la más antigua. */
export function orgShouldFlip(p: Pick<OrgMergePreview, 'keep' | 'drop'>): boolean {
  return Date.parse(p.drop.created_at) < Date.parse(p.keep.created_at);
}

/** Una conversación viva de una de las dos, con lo justo para cruzarlas. */
export interface ClashRow {
  id: string;
  organization_id: string;
  project_id: string;
  private_to: string | null;
  project: { name: string | null } | null;
}

/**
 * Las parejas que chocan: una de cada en el mismo proyecto y con la misma
 * privacidad (los índices únicos `conversation_project_organization_*`). La
 * misma cuenta que `preview_organization_merge`, sobre lo que quien llama ve.
 */
export function orgClashes(rows: readonly ClashRow[], keepId: string, dropId: string): OrgMergeClash[] {
  const keepBy = new Map<string, ClashRow>();
  for (const r of rows) {
    if (r.organization_id === keepId) keepBy.set(`${r.project_id}|${r.private_to ?? ''}`, r);
  }
  const out: OrgMergeClash[] = [];
  for (const d of rows) {
    if (d.organization_id !== dropId) continue;
    const k = keepBy.get(`${d.project_id}|${d.private_to ?? ''}`);
    if (!k) continue;
    out.push({
      project_id: d.project_id,
      project_name: d.project?.name ?? k.project?.name ?? '',
      keep_conversation_id: k.id,
      drop_conversation_id: d.id,
    });
  }
  return out.sort((a, b) => a.project_name.localeCompare(b.project_name));
}

/** La organización del espacio con ese nombre, sin mayúsculas ni espacios de más. */
export function orgByName<T extends { id: string; workspace_id: string; name: string }>(
  items: readonly T[],
  workspaceId: string,
  name: string,
  exceptId: string,
): T | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  return (
    items.find((o) => o.workspace_id === workspaceId && o.id !== exceptId && o.name.trim().toLowerCase() === want) ??
    null
  );
}

/** Las negativas 22023 de las RPC, por su mensaje (RAISE de la migración 20261102140000). */
export type OrgMergeRefusal =
  | 'same_organization'
  | 'project_clash'
  | 'already_undone'
  | 'undo_expired'
  | 'later_merge'
  | 'invalid_input';

export function orgMergeRefusal(message: string | null | undefined): OrgMergeRefusal {
  const m = (message ?? '').toLowerCase();
  if (m.includes('merged with itself')) return 'same_organization';
  if (m.includes('conversation in the same project')) return 'project_clash';
  if (m.includes('already undone')) return 'already_undone';
  if (m.includes('older than 30 days')) return 'undo_expired';
  if (m.includes('later merge')) return 'later_merge';
  return 'invalid_input';
}

/** Una fusión que esta organización absorbió, sin deshacer (`organization_merge`, la lee el admin). */
export interface OrgMergeLine {
  id: string;
  drop_name: string | null;
  merged_at: string;
}

/** Una fusión reciente del espacio, para Ajustes. */
export interface RecentOrgMerge {
  id: string;
  merged_at: string;
  keep_organization_id: string;
  drop_name: string | null;
  /** La que se quedó, si sigue viva. */
  keep_name: string | null;
  keep_slug: string | null;
}
