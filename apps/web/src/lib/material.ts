/**
 * Materials domain helpers (ADR-056) — the versioned-assets registry.
 * "Materials" is the UI word; the schema entity is `asset_version`
 * (research 99-patterns §1.1: knowing which version went where is the
 * sector's universal pain #1).
 */

import * as v from 'valibot';
import { Constants, type Enums, type Tables } from './db-types';

export type AssetKind = Enums<'asset_kind'>;
export type AssetDirection = Enums<'asset_direction'>;

/** All kinds in schema enum order (runtime mirror of the DB enum). */
export const ASSET_KINDS = Constants.public.Enums.asset_kind;

export const KIND_LABELS: Record<AssetKind, string> = {
  rider: 'Rider',
  stage_plot: 'Stage plot',
  tech_sheet: 'Tech sheet',
  bar_plot: 'Bar plot',
  dossier: 'Dossier',
  roadsheet_snapshot: 'Road sheet snapshot',
  photo: 'Photo',
  video: 'Video',
  other: 'Other',
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind as AssetKind] ?? kind.replace(/_/g, ' ');
}

/**
 * POST /api/lines/:id/materials body. Direction is fixed 'outbound' at
 * line scope in v1 (the table CHECK forbids 'inbound' without a
 * performance; 'adapted' needs a source) — so it is not in the schema.
 */
export const MaterialCreateSchema = v.object({
  kind: v.picklist(ASSET_KINDS),
  url: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2000), v.url()),
  notes: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500)))),
});

export type MaterialCreate = v.InferOutput<typeof MaterialCreateSchema>;

export type MaterialItem = Pick<
  Tables<'asset_version'>,
  'id' | 'kind' | 'direction' | 'url' | 'notes' | 'uploaded_at' | 'uploaded_by'
>;
