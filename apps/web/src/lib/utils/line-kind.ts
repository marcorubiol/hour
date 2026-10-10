/**
 * Line-kind vocabulary — glyph + human label for the 10 `line_kind` enum
 * values (ADR-035). A line is the workbench unit inside a project: a tour,
 * a season, a distribution/press campaign, a creation. The glyph gives each
 * kind a stable typeable mark (no icon fonts — philosophy: typeable symbols,
 * never pictographs); the label is what the UI prints.
 *
 * Schema enum: tour | season | phase | circuit | residency | creation |
 *              campaign | comms | misc | other
 */

import { appLocale, t, type Locale } from '$lib/i18n';

export type LineKind =
  | 'tour'
  | 'season'
  | 'phase'
  | 'circuit'
  | 'residency'
  | 'creation'
  | 'campaign'
  | 'comms'
  | 'misc'
  | 'other';

const GLYPHS: Record<string, string> = {
  tour: '→',
  season: '❍',
  phase: '◑',
  circuit: '◇',
  residency: '⌂',
  creation: '✳',
  campaign: '◈',
  comms: '◌',
  misc: '·',
  other: '·',
  oneoff: '·',
};

/** Dictionary keys of the label (English: tour, season, … comms → press,
    oneoff → one-offs). */
const LABELS: Record<string, string> = {
  tour: 'ui.line_kind_tour',
  season: 'ui.line_kind_season',
  phase: 'ui.line_kind_phase',
  circuit: 'ui.line_kind_circuit',
  residency: 'ui.line_kind_residency',
  creation: 'ui.line_kind_creation',
  campaign: 'ui.line_kind_campaign',
  comms: 'ui.line_kind_comms',
  misc: 'ui.line_kind_misc',
  other: 'ui.line_kind_other',
  oneoff: 'ui.line_kind_oneoff',
};

export function lineKindGlyph(kind: string | null | undefined): string {
  return (kind && GLYPHS[kind]) || '·';
}

export function lineKindLabel(kind: string | null | undefined, locale: Locale = appLocale()): string {
  if (kind && LABELS[kind]) return t(LABELS[kind], locale);
  return kind ?? t('picker.kind_line', locale);
}
