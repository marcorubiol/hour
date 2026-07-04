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

const LABELS: Record<string, string> = {
  tour: 'tour',
  season: 'season',
  phase: 'phase',
  circuit: 'circuit',
  residency: 'residency',
  creation: 'creation',
  campaign: 'campaign',
  comms: 'press',
  misc: 'misc',
  other: 'other',
  oneoff: 'one-offs',
};

export function lineKindGlyph(kind: string | null | undefined): string {
  return (kind && GLYPHS[kind]) || '·';
}

export function lineKindLabel(kind: string | null | undefined): string {
  return (kind && LABELS[kind]) || (kind ?? 'line');
}
