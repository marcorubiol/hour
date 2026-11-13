/**
 * Line templates + module registry (ADR-056) — single home for the module
 * vocabulary, the shipped templates, and the kind → modules map.
 *
 * ADR-166: a line's modules are its KIND's, in a fixed order. Nobody adds,
 * removes or moves one; `line.modules` stays in the database and is read by
 * nobody. A template picks a kind (and a name); the kind picks the modules.
 *
 * A module is a line-scoped view of an EXISTING entity/lens — never its own
 * data silo (anti-fragmentation rule: whatever a module shows must also
 * appear in its global lens). Templates compose modules and labels — never
 * custom fields, entities or states (the Airtable guardrail).
 *
 * Shipped templates are hardcoded here; a workspace-scoped `line_template`
 * table only arrives in Phase 1 when clients build their own.
 */

import type { Enums } from './db-types';
import { t, type Locale, type Voice } from './i18n';

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

/** `voice`: the trade of the line's space (tarea 142); without it, the screen's. */
export function moduleLabel(key: ModuleKey, locale: Locale, voice?: Voice): string {
  return t(MODULE_LABEL_KEYS[key], locale, undefined, voice);
}

type LineKind = Enums<'line_kind'>;

export interface LineTemplate {
  key: string;
  /** Dictionary key of the card title in the template picker. */
  nameKey: string;
  /** Dictionary key of the one-line card description. */
  descriptionKey: string;
  kind: LineKind;
}

/**
 * Creating a line = picking a template (ADR-056). The template fixes the
 * kind, and the kind the modules (ADR-166); kind stays as metadata (eyebrow/accent), the 10-kind
 * dropdown is gone. "Booking" is the difusión template — the project's own
 * English gloss for difusión (the old /booking route), not CRM vocabulary.
 */
export const LINE_TEMPLATES: LineTemplate[] = [
  {
    key: 'tour',
    nameKey: 'line.template_tour',
    descriptionKey: 'line.template_tour_desc',
    kind: 'tour',
  },
  {
    key: 'booking',
    nameKey: 'line.template_booking',
    descriptionKey: 'line.template_booking_desc',
    kind: 'campaign',
  },
  {
    key: 'creation',
    nameKey: 'line.template_creation',
    descriptionKey: 'line.template_creation_desc',
    kind: 'creation',
  },
  {
    key: 'press',
    nameKey: 'line.template_press',
    descriptionKey: 'line.template_press_desc',
    kind: 'comms',
  },
  {
    key: 'fair',
    nameKey: 'line.template_fair',
    descriptionKey: 'line.template_fair_desc',
    kind: 'campaign',
  },
  {
    key: 'blank',
    nameKey: 'line.template_blank',
    descriptionKey: 'line.template_blank_desc',
    kind: 'other',
  },
];

/**
 * THE MODULES OF EACH KIND, in the order the line page draws them (ADR-166).
 * Tour-like kinds get the tour stack, outreach kinds the booking stack. Tasks
 * sit after the Planner in all three working sets, where the templates put
 * them since ADR-071.
 */
const TOUR_SET: ModuleKey[] = ['planner', 'tasks', 'roadsheets', 'team', 'money', 'materials', 'notes'];
const BOOKING_SET: ModuleKey[] = ['conversations', 'planner', 'tasks', 'materials', 'notes'];
const CREATION_SET: ModuleKey[] = ['planner', 'tasks', 'notes', 'materials', 'money'];

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

/** A line's modules: its kind's (ADR-166). An unknown kind gets Notes. */
export function modulesForKind(kind: string): ModuleKey[] {
  return MODULES_BY_KIND[kind as LineKind] ?? ['notes'];
}
