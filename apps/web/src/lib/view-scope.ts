/**
 * «LO MÍO / TODO» — what a space shows you (ADR-151).
 *
 * Each workspace membership carries a preference for the person's own
 * surfaces (Hoy, Ahora, the pulse in the rail) and the Planner:
 *
 *   mine — only the rows you are on: a roster that names you, or your «voy».
 *   all  — the whole company: every row of the space, the company dates
 *          nobody is named on (ADR-147) and the shows of the others.
 *
 * Conversaciones and Cuentas do not read it: they are the company's books.
 *
 * Unset (`view_scope` null), the access package decides: a technician on
 * Mínim or Equip sees theirs, Coordinació, Direcció and the owner see it all.
 * Without a package, the role: admin and member see it all (they run the
 * space), a viewer sees theirs. A GUEST (a bolo or project invitation,
 * ADR-142) sees it all: RLS already gives them only their bolo, so «todo» is
 * exactly what is theirs, and «lo mío» hid their own bolo, whose roster does
 * not name them (E2E `bolo-guest-frame`, 31-10). Like the lenses and the roles, a
 * workspace whose answer has not arrived reads as the generous side: «all».
 */
import type { PersonAttribution } from './people';

export type ViewScope = 'mine' | 'all';

const MINE_PRESETS: ReadonlySet<string> = new Set(['minim', 'equip']);
const ALL_PRESETS: ReadonlySet<string> = new Set(['coordinacio', 'direccio']);
const MINE_ROLES: ReadonlySet<string> = new Set(['viewer']);

/** The default a package (else a role) gives. The owner always sees it all. */
export function defaultViewScope(role: string | null | undefined, preset: string | null | undefined): ViewScope {
  // The owner sees the company; a guest sees all RLS lets them read: their bolo.
  if (role === 'owner' || role === 'guest') return 'all';
  if (preset && MINE_PRESETS.has(preset)) return 'mine';
  if (preset && ALL_PRESETS.has(preset)) return 'all';
  return role && MINE_ROLES.has(role) ? 'mine' : 'all';
}

export function isViewScope(v: unknown): v is ViewScope {
  return v === 'mine' || v === 'all';
}

/** What a workspace shows this person: their own choice, else the default. */
export interface WithViewScope {
  my_role?: string | null;
  my_preset?: string | null;
  view_scope?: string | null;
}

export function viewScopeOf(w: WithViewScope | null | undefined): ViewScope {
  if (!w) return 'all';
  return isViewScope(w.view_scope) ? w.view_scope : defaultViewScope(w.my_role, w.my_preset);
}

/** Whether the choice is the package's default (Ajustes says «por defecto»). */
export function viewScopeIsDefault(w: WithViewScope): boolean {
  return !isViewScope(w.view_scope);
}

/** One lookup for a whole view: workspace id → its scope; unknown → «all». */
export function viewScopeIndex(workspaces: readonly (WithViewScope & { id: string })[]): (workspaceId: string | null) => ViewScope {
  const byId = new Map(workspaces.map((w) => [w.id, viewScopeOf(w)]));
  return (id) => (id ? (byId.get(id) ?? 'all') : 'all');
}

/**
 * Does a row stay, by its person verdict and its space's scope? «Todo» keeps
 * every row; «lo mío» only the ones you are on. Without a scope (a person
 * pinned by hand in the Planner) the rule of ADR-147: everything but `no`.
 */
export function keepsVerdict(verdict: PersonAttribution, scope: ViewScope | null): boolean {
  if (scope === 'all') return true;
  if (scope === 'mine') return verdict === 'explicit';
  return verdict !== 'no';
}
