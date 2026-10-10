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
import { t, type Locale } from './i18n';

export const MODULE_KEYS = [
  'planner',
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
// Labels live in the dictionaries (lib/i18n), one explicit key per module.
const MODULE_LABEL_KEYS: Record<ModuleKey, string> = {
  planner: 'line.module_planner',
  conversations: 'line.module_conversations',
  roadsheets: 'line.module_roadsheets',
  notes: 'line.module_notes',
  materials: 'line.module_materials',
  money: 'line.module_money',
  team: 'line.module_team',
  tasks: 'line.module_tasks',
};

/** Shown in the "Add module" menu and module empty states. */
const MODULE_DESCRIPTION_KEYS: Record<ModuleKey, string> = {
  planner: 'line.module_planner_desc',
  conversations: 'line.module_conversations_desc',
  roadsheets: 'line.module_roadsheets_desc',
  notes: 'line.module_notes_desc',
  materials: 'line.module_materials_desc',
  money: 'line.module_money_desc',
  team: 'line.module_team_desc',
  tasks: 'line.module_tasks_desc',
};

export function moduleLabel(key: ModuleKey, locale: Locale): string {
  return t(MODULE_LABEL_KEYS[key], locale);
}

export function moduleDescription(key: ModuleKey, locale: Locale): string {
  return t(MODULE_DESCRIPTION_KEYS[key], locale);
}

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
  /** Dictionary key of the card title in the template picker. */
  nameKey: string;
  /** Dictionary key of the one-line card description. */
  descriptionKey: string;
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
    nameKey: 'line.template_tour',
    descriptionKey: 'line.template_tour_desc',
    kind: 'tour',
    modules: ['planner', 'tasks', 'roadsheets', 'team', 'money', 'materials', 'notes'],
  },
  {
    key: 'booking',
    nameKey: 'line.template_booking',
    descriptionKey: 'line.template_booking_desc',
    kind: 'campaign',
    modules: ['conversations', 'planner', 'tasks', 'materials', 'notes'],
  },
  {
    key: 'creation',
    nameKey: 'line.template_creation',
    descriptionKey: 'line.template_creation_desc',
    kind: 'creation',
    modules: ['planner', 'tasks', 'notes', 'materials', 'money'],
  },
  {
    key: 'press',
    nameKey: 'line.template_press',
    descriptionKey: 'line.template_press_desc',
    kind: 'comms',
    modules: ['conversations', 'planner', 'materials', 'notes'],
  },
  {
    key: 'fair',
    nameKey: 'line.template_fair',
    descriptionKey: 'line.template_fair_desc',
    kind: 'campaign',
    modules: ['conversations', 'planner', 'materials', 'notes'],
  },
  {
    key: 'blank',
    nameKey: 'line.template_blank',
    descriptionKey: 'line.template_blank_desc',
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
const TOUR_SET: ModuleKey[] = ['planner', 'roadsheets', 'team', 'money', 'materials', 'notes'];
const BOOKING_SET: ModuleKey[] = ['conversations', 'planner', 'materials', 'notes'];
const CREATION_SET: ModuleKey[] = ['planner', 'notes', 'materials', 'money'];

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
