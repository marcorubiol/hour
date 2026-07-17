/**
 * Line templates + module registry (ADR-056) — single home for the module
 * vocabulary, the shipped templates, and the kind → default-modules map.
 *
 * A module is a line-scoped view of an EXISTING entity/lens — never its own
 * data silo (anti-fragmentation rule: whatever a module shows must also
 * appear in its global lens). Templates compose modules and labels — never
 * custom fields, entities or states (the Airtable guardrail).
 *
 * Shipped templates are hardcoded here; a workspace-scoped `line_template`
 * table only arrives in Phase 1 when clients build their own.
 */

import * as v from 'valibot';
import type { Enums } from './db-types';

export const MODULE_KEYS = [
  'calendar',
  'conversations',
  'roadsheets',
  'notes',
  'materials',
  'money',
  'team',
  'tasks',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

// ADR-065: `conversations` = the line's booking conversations (the Conversations lens scoped to it —
// people AND organizations); `team` = its cast/crew. Keys, labels, components and the DB
// all agree — no legacy.
export const MODULE_LABELS: Record<ModuleKey, string> = {
  calendar: 'Calendar',
  conversations: 'Conversations',
  roadsheets: 'Road sheets',
  notes: 'Notes',
  materials: 'Materials',
  money: 'Money',
  team: 'Team',
  tasks: 'Tasks',
};

/** Shown in the "Add module" menu and module empty states. */
export const MODULE_DESCRIPTIONS: Record<ModuleKey, string> = {
  calendar: 'Performances and dates of this line',
  conversations: 'Conversations tied to this line',
  roadsheets: 'Road sheets of the line’s performances',
  notes: 'Collaborative notes',
  materials: 'Versioned assets — what was sent where',
  money: 'Fees, invoices and expenses of this line',
  team: 'Team on the road + venue conversations, per performance',
  tasks: 'To-dos of this line — they feed the Desk too',
};

/** `line.modules` API boundary — order matters, unknown keys rejected. */
export const LineModulesSchema = v.pipe(
  v.array(v.picklist(MODULE_KEYS)),
  v.maxLength(MODULE_KEYS.length),
  v.check(
    (mods) => new Set(mods).size === mods.length,
    'Duplicate module keys',
  ),
);

type LineKind = Enums<'line_kind'>;

export interface LineTemplate {
  key: string;
  /** Card title in the template picker. */
  name: string;
  /** One-line card description. */
  description: string;
  kind: LineKind;
  modules: ModuleKey[];
}

/**
 * Creating a line = picking a template (ADR-056). The template fixes kind +
 * default module set; kind stays as metadata (eyebrow/accent), the 10-kind
 * dropdown is gone. "Booking" is the difusión template — the project's own
 * English gloss for difusión (the old /booking route), not CRM vocabulary.
 */
export const LINE_TEMPLATES: LineTemplate[] = [
  {
    key: 'tour',
    name: 'Tour',
    description: 'Performances on the road — calendar, road sheets, team, money.',
    kind: 'tour',
    modules: ['calendar', 'tasks', 'roadsheets', 'team', 'money', 'materials', 'notes'],
  },
  {
    key: 'booking',
    name: 'Booking',
    description: 'A season of difusión — conversations, dates, materials.',
    kind: 'campaign',
    modules: ['conversations', 'calendar', 'tasks', 'materials', 'notes'],
  },
  {
    key: 'creation',
    name: 'Creation',
    description: 'Building a new piece — schedule, notes, costs.',
    kind: 'creation',
    modules: ['calendar', 'tasks', 'notes', 'materials', 'money'],
  },
  {
    key: 'press',
    name: 'Press & comms',
    description: 'Press conversations and communication materials.',
    kind: 'comms',
    modules: ['conversations', 'calendar', 'materials', 'notes'],
  },
  {
    key: 'fair',
    name: 'Fair',
    description: 'A fair or showcase — conversations, calendar, materials.',
    kind: 'campaign',
    modules: ['conversations', 'calendar', 'materials', 'notes'],
  },
  {
    key: 'blank',
    name: 'Blank',
    description: 'Just notes. Add modules as you go.',
    kind: 'other',
    modules: ['notes'],
  },
];

/**
 * Defaults for lines with `modules = NULL` (every line predating ADR-056 —
 * no backfill needed). Tour-like kinds get the tour stack, outreach kinds
 * the booking stack; the two real pre-ADR lines land right: the demo tour
 * line → tour set, difusion-2026-27 (campaign) → booking set.
 */
const TOUR_SET: ModuleKey[] = ['calendar', 'roadsheets', 'team', 'money', 'materials', 'notes'];
const BOOKING_SET: ModuleKey[] = ['conversations', 'calendar', 'materials', 'notes'];
const CREATION_SET: ModuleKey[] = ['calendar', 'notes', 'materials', 'money'];

export const MODULES_BY_KIND: Record<LineKind, ModuleKey[]> = {
  tour: TOUR_SET,
  season: TOUR_SET,
  circuit: TOUR_SET,
  residency: TOUR_SET,
  campaign: BOOKING_SET,
  comms: BOOKING_SET,
  creation: CREATION_SET,
  phase: CREATION_SET,
  other: ['notes'],
  misc: ['notes'],
};

/**
 * The resolved module stack for a line: explicit `modules` when set (unknown
 * keys dropped defensively — an old client may meet a future vocabulary),
 * kind defaults when NULL.
 */
export function modulesForLine(line: {
  kind: string;
  modules?: unknown;
}): ModuleKey[] {
  if (Array.isArray(line.modules)) {
    const known = line.modules.filter((m): m is ModuleKey =>
      (MODULE_KEYS as readonly string[]).includes(m as string),
    );
    return [...new Set(known)];
  }
  return MODULES_BY_KIND[line.kind as LineKind] ?? ['notes'];
}
