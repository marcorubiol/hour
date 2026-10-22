/**
 * Fusionar dos fichas de persona del mismo espacio (plan
 * `build/plans/2026-10-22-person-merge.md`, fase 2): lo que la pantalla
 * decide sin la base. La fusión la hacen las RPC de la fase 1
 * (`preview_person_merge`, `merge_workspace_person`, `undo_person_merge`);
 * aquí solo: qué campos piden elegir, qué se manda en `p_fields`, qué
 * recuentos se dicen, qué email deja de traer correo y si aún se deshace.
 */

/** Un dossier tal como lo devuelve `preview_person_merge`. */
export interface MergeDossier {
  full_name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  slug: string;
  created_at: string;
  is_account: boolean;
}

/** Lo que quien llama puede leer de la ficha que desaparece (RLS). */
export interface MergeCounts {
  cast: number;
  overrides: number;
  crew: number;
  availability: number;
  commitments: number;
  conversations: number;
  mailouts: number;
  my_notes: number;
}

export interface MergePreview {
  keep_person_id: string;
  drop_person_id: string;
  /** La base dio la vuelta: la cuenta siempre se queda. */
  swapped: boolean;
  keep_is_account: boolean;
  /** NULL cuando la cuenta aún no tiene ficha en el espacio. */
  keep: MergeDossier | null;
  drop: MergeDossier;
  counts: MergeCounts;
  conflicts: Partial<Record<keyof MergeCounts, number>>;
}

/** Los campos que se eligen a mano (`p_fields` de la RPC). */
export const MERGE_FIELDS = ['full_name', 'email', 'phone'] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeSide = 'keep' | 'drop';
export type MergeChoices = Partial<Record<MergeField, MergeSide>>;

/** Los recuentos, en el orden en que se dicen. */
export const COUNT_ORDER = [
  'cast',
  'overrides',
  'crew',
  'commitments',
  'availability',
  'conversations',
  'mailouts',
  'my_notes',
] as const satisfies readonly (keyof MergeCounts)[];

/** Días que dura «Deshacer» (ADR del plan, pregunta 5). */
export const UNDO_DAYS = 30;

const blank = (v: string | null | undefined) => !v || !v.trim();
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Los campos con dos valores distintos: solo ahí hay radio. Si uno está
 * vacío gana el otro sin preguntar (la RPC rellena lo vacío de `keep`).
 */
export function fieldsToChoose(p: Pick<MergePreview, 'keep' | 'drop'>): MergeField[] {
  if (!p.keep) return [];
  return MERGE_FIELDS.filter((f) => {
    const k = p.keep![f];
    const d = p.drop[f];
    return !blank(k) && !blank(d) && !same(k!, d!);
  });
}

/** Lo que se queda en cada campo con estas elecciones (sin elegir: `keep`, y si está vacío, `drop`). */
export function resultingValue(
  p: Pick<MergePreview, 'keep' | 'drop'>,
  field: MergeField,
  choices: MergeChoices,
): string | null {
  const k = p.keep?.[field] ?? null;
  const d = p.drop[field];
  if (choices[field] === 'drop' && !blank(d)) return d;
  return blank(k) ? (blank(d) ? null : d) : k;
}

/** `p_fields`: cada campo elegido nombra a su persona por id (la base puede intercambiarlas). */
export function fieldsPayload(
  p: Pick<MergePreview, 'keep_person_id' | 'drop_person_id' | 'keep' | 'drop'>,
  choices: MergeChoices,
): Partial<Record<MergeField, string>> {
  const out: Partial<Record<MergeField, string>> = {};
  for (const f of fieldsToChoose(p)) {
    out[f] = choices[f] === 'drop' ? p.drop_person_id : p.keep_person_id;
  }
  return out;
}

/** El email que deja de traer correo a Hour (el buzón empareja por uno solo). */
export function lostEmail(p: Pick<MergePreview, 'keep' | 'drop'>, choices: MergeChoices): string | null {
  if (!p.keep || blank(p.keep.email) || blank(p.drop.email) || same(p.keep.email!, p.drop.email!)) {
    return null;
  }
  return choices.email === 'drop' ? p.keep.email : p.drop.email;
}

/** Los recuentos que no son cero, en su orden. */
export function countParts(counts: MergeCounts): Array<{ key: keyof MergeCounts; n: number }> {
  return COUNT_ORDER.filter((k) => (counts[k] ?? 0) > 0).map((k) => ({ key: k, n: counts[k] }));
}

/** Hay filas de las dos en lo mismo: se queda una. */
export function hasConflicts(p: Pick<MergePreview, 'conflicts'>): boolean {
  return Object.values(p.conflicts ?? {}).some((n) => (n ?? 0) > 0);
}

/**
 * ¿Hay que dar la vuelta a la vista previa? Se queda por defecto la que
 * tiene cuenta (eso lo hace ya la base); si ninguna, la más antigua.
 */
export function shouldFlip(p: Pick<MergePreview, 'keep' | 'drop' | 'keep_is_account' | 'swapped'>): boolean {
  if (p.swapped || p.keep_is_account || p.drop.is_account || !p.keep) return false;
  return Date.parse(p.drop.created_at) < Date.parse(p.keep.created_at);
}

/** ¿Se puede elegir cuál se queda? No si una es una cuenta. */
export function canChooseKeep(p: Pick<MergePreview, 'keep' | 'drop' | 'keep_is_account'>): boolean {
  return Boolean(p.keep) && !p.keep_is_account && !p.drop.is_account;
}

/** «Deshacer» aún vale (la RPC dice lo mismo: menos de 30 días). */
export function undoOpen(mergedAt: string, now: Date = new Date()): boolean {
  const t = Date.parse(mergedAt);
  return Number.isFinite(t) && now.getTime() - t < UNDO_DAYS * 86_400_000;
}

/** Las negativas 22023 de las RPC, por su mensaje (RAISE de la migración 20261022130000). */
export type MergeRefusal =
  | 'same_person'
  | 'both_accounts'
  | 'invalid_fields'
  | 'invitation_mismatch'
  | 'already_undone'
  | 'undo_expired'
  | 'later_merge'
  | 'invalid_input';

export function mergeRefusal(message: string | null | undefined): MergeRefusal {
  const m = (message ?? '').toLowerCase();
  if (m.includes('merged with itself')) return 'same_person';
  if (m.includes('both people are accounts')) return 'both_accounts';
  if (m.includes('fields must choose')) return 'invalid_fields';
  if (m.includes('invitation does not match')) return 'invitation_mismatch';
  if (m.includes('already undone')) return 'already_undone';
  if (m.includes('older than 30 days')) return 'undo_expired';
  if (m.includes('later merge')) return 'later_merge';
  return 'invalid_input';
}

/** Una fusión de la que esta ficha es la que se queda (`person_merge`, la lee el admin). */
export interface PersonMergeLine {
  id: string;
  drop_name: string | null;
  merged_at: string;
}
