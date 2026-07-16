/*
  Scope v2 preview — sample domain data + pure helpers.

  This is the "Hour Views · Scope v2" design (imported from claude.ai/design)
  ported faithfully into the app. It is a PREVIEW of the nav model (saved
  scopes + recents in the sidebar, ⌘K to browse/combine spaces·projects·lines,
  VIEW AS Desk·Calendar·Contacts·Money over one scoped set). The data here is
  the prototype's fixture set, NOT wired to Supabase yet — the point is to feel
  the navigation. Colours route through the design-system accents (tokens.css)
  so the page is theme-aware (light + dark) instead of the prototype's literals.

  Categories (philosophy.md): domain data (SP/PROJ/LINE/TASKS) vs pure
  operations (accentFor/labelFor/tokMatch/…). Never mix.
*/

export type SpaceId = 'muk' | 'demo' | 'marco';

export interface Space {
  name: string;
  /** A design-system accent var — the space's stable identifying colour. */
  accent: string;
}

/* Each space keeps a fixed identity colour (unlike the hash-based
   accentVar() used elsewhere) — this is a designed preview, the colours
   are chosen. muk→purple, demo→blue, marco→red, via the token accents. */
export const SP: Record<SpaceId, Space> = {
  muk: { name: 'MÜK Cia', accent: 'var(--accent-7)' },
  demo: { name: 'Demo (Hour)', accent: 'var(--accent-1)' },
  marco: { name: 'Marco Rubiol', accent: 'var(--accent-4)' },
};

export const SPORDER: SpaceId[] = ['muk', 'demo', 'marco'];

export interface Project {
  name: string;
  sp: SpaceId;
}

export const PROJ: Record<string, Project> = {
  mamemi: { name: 'MaMeMi', sp: 'muk' },
  circ: { name: "Circ d'hivern", sp: 'muk' },
  ultima: { name: 'Última órbita', sp: 'demo' },
  memorias: { name: 'Memorias del agua', sp: 'demo' },
  tres: { name: 'Tres voces', sp: 'demo' },
  ferran: { name: 'Cicle Ferran', sp: 'demo' },
  cuaderno: { name: 'Cuaderno cero', sp: 'marco' },
  retrat: { name: 'Retrats', sp: 'marco' },
};

export interface Line {
  name: string;
  proj: string;
}

export const LINE: Record<string, Line> = {
  gira2627: { name: 'Gira 26-27', proj: 'mamemi' },
  dif2627: { name: 'Difusión 26-27', proj: 'mamemi' },
  presup: { name: 'Presupuesto MaMeMi', proj: 'mamemi' },
  otono26: { name: 'Gira otoño 26', proj: 'ultima' },
  intl: { name: 'Circuito internacional', proj: 'ultima' },
  madrid26: { name: 'Temporada Madrid 26', proj: 'memorias' },
  residlce: { name: 'Residencia LCE', proj: 'tres' },
  compinv: { name: 'Composición invierno', proj: 'cuaderno' },
};

export type Verb = 'confirm' | 'chase' | 'prep';
export type Status = 'hold' | 'confirmed' | 'pending' | null;

export interface Task {
  verb: Verb;
  contact: string | null;
  role: string | null;
  org: string;
  sp: SpaceId;
  proj: string;
  line: string;
  /** Relative day: -1 overdue, 0 today (Mon Jul 13), … 5. */
  day: number;
  time: string | null;
  amount: number | null;
  status: Status;
}

export const TASKS: Task[] = [
  { verb: 'confirm', contact: 'Anna Prat', role: 'Programadora', org: "Teatre Principal d'Olot", sp: 'muk', proj: 'mamemi', line: 'gira2627', day: -1, time: null, amount: 4200, status: 'hold' },
  { verb: 'confirm', contact: 'Roser Grau', role: 'Dirección', org: 'Festival Grec', sp: 'muk', proj: 'mamemi', line: 'dif2627', day: 0, time: '10:30', amount: 3800, status: 'confirmed' },
  { verb: 'chase', contact: 'David Lainez', role: 'Ajuntament', org: 'Aj. de Balsareny', sp: 'demo', proj: 'ultima', line: 'otono26', day: 0, time: '12:00', amount: 2500, status: 'pending' },
  { verb: 'chase', contact: 'Mieke Vandecande', role: 'Agent · BE', org: 'CC Brugge', sp: 'demo', proj: 'ultima', line: 'intl', day: 1, time: null, amount: null, status: null },
  { verb: 'confirm', contact: 'Sergi Vallès', role: 'Dirección', org: "L'Horta Teatre", sp: 'muk', proj: 'mamemi', line: 'gira2627', day: 1, time: '09:00', amount: 5100, status: 'confirmed' },
  { verb: 'chase', contact: 'David Lainez', role: 'Ajuntament', org: 'Aj. de Balsareny', sp: 'marco', proj: 'cuaderno', line: 'compinv', day: 2, time: null, amount: null, status: null },
  { verb: 'chase', contact: 'Anna Prat', role: 'Programadora', org: "Teatre Principal d'Olot", sp: 'muk', proj: 'mamemi', line: 'gira2627', day: 2, time: null, amount: null, status: null },
  { verb: 'chase', contact: 'Luisa Cuttini', role: 'Festival · IT', org: 'Festival Aperto', sp: 'demo', proj: 'tres', line: 'residlce', day: 3, time: null, amount: 1900, status: 'pending' },
  { verb: 'chase', contact: 'Sergi Vallès', role: 'Dirección', org: "L'Horta Teatre", sp: 'muk', proj: 'mamemi', line: 'dif2627', day: 3, time: null, amount: null, status: null },
  { verb: 'prep', contact: null, role: null, org: 'Festival Sense Portes', sp: 'demo', proj: 'ultima', line: 'otono26', day: 4, time: null, amount: null, status: null },
  { verb: 'chase', contact: 'Marta Coll', role: 'Ajuntament', org: "Aj. d'Alcarràs", sp: 'muk', proj: 'mamemi', line: 'presup', day: 5, time: null, amount: 3300, status: 'pending' },
  { verb: 'confirm', contact: 'Roser Grau', role: 'Dirección', org: 'Festival Grec', sp: 'demo', proj: 'memorias', line: 'madrid26', day: 5, time: '16:00', amount: 2800, status: 'hold' },
];

export interface Scope {
  name: string;
  tokens: string[];
}

export interface SavedScope extends Scope {
  id: string;
}

export const INITIAL_SAVED: SavedScope[] = [
  { id: 'every', name: 'Everything', tokens: [] },
  { id: 'muk', name: 'MÜK Cia', tokens: ['space:muk'] },
  { id: 'gira', name: 'En gira ahora', tokens: ['line:gira2627', 'line:otono26'] },
];

export const INITIAL_RECENT: Scope[] = [
  { name: 'Última órbita', tokens: ['project:ultima'] },
  { name: 'Anna Prat · MÜK', tokens: ['space:muk', 'project:mamemi'] },
];

/* ── calendar labels ── */
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const NUMS = [13, 14, 15, 16, 17, 18, 19];

/* ── pure helpers (operations) ── */

export const eur = (n: number) => '€' + n.toLocaleString('es-ES');

export function dayLabel(d: number): [string, string] {
  if (d < 0) return ['Overdue', ''];
  if (d === 0) return ['Today', 'Mon · Jul 13'];
  if (d === 1) return ['Tomorrow', 'Tue · Jul 14'];
  return [`${DAYS[d]} · Jul ${NUMS[d]}`, ''];
}

export function initials(n: string): string {
  return n
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('');
}

type TokKind = 'space' | 'project' | 'line';

export function tokParts(tok: string): [TokKind, string] {
  const [ty, id] = tok.split(':');
  return [ty as TokKind, id];
}

export function accentFor(tok: string): string {
  const [ty, id] = tokParts(tok);
  if (ty === 'space') return SP[id as SpaceId].accent;
  if (ty === 'project') return SP[PROJ[id].sp].accent;
  return SP[PROJ[LINE[id].proj].sp].accent;
}

export function labelFor(tok: string): string {
  const [ty, id] = tokParts(tok);
  if (ty === 'space') return SP[id as SpaceId].name;
  if (ty === 'project') return PROJ[id].name;
  return LINE[id].name;
}

export function tokMatch(tok: string, task: Task): boolean {
  const [ty, id] = tokParts(tok);
  if (ty === 'space') return task.sp === id;
  if (ty === 'project') return task.proj === id;
  return task.line === id;
}

export function facetCount(tok: string): number {
  return TASKS.filter((task) => tokMatch(tok, task)).length;
}

export function scopeCount(tokens: string[]): number {
  if (tokens.length === 0) return TASKS.length;
  return TASKS.filter((task) => tokens.some((t) => tokMatch(t, task))).length;
}

export function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}
