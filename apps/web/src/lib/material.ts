/**
 * Materials domain helpers (ADR-056) — the versioned-assets registry.
 * "Materials" is the UI word; the schema entity is `asset_version`
 * (research 99-patterns §1.1: knowing which version went where is the
 * sector's universal pain #1).
 */

import * as v from 'valibot';
import { Constants, type Enums, type Tables } from './db-types';
import { t, type Locale } from './i18n';

export type AssetKind = Enums<'asset_kind'>;
export type AssetDirection = Enums<'asset_direction'>;

/** All kinds in schema enum order (runtime mirror of the DB enum). */
export const ASSET_KINDS = Constants.public.Enums.asset_kind;

/** Dictionary key of each kind label (lib/i18n). */
export const KIND_KEYS: Record<AssetKind, string> = {
  rider: 'line.material_rider',
  stage_plot: 'line.material_stage_plot',
  tech_sheet: 'line.material_tech_sheet',
  bar_plot: 'line.material_bar_plot',
  dossier: 'line.material_dossier',
  roadsheet_snapshot: 'line.material_roadsheet_snapshot',
  photo: 'line.material_photo',
  video: 'line.material_video',
  other: 'line.material_other',
};

export function kindLabel(kind: string, locale: Locale): string {
  const key = KIND_KEYS[kind as AssetKind];
  return key ? t(key, locale) : kind.replace(/_/g, ' ');
}

const DIRECTION_KEYS: Record<AssetDirection, string> = {
  outbound: 'line.material_dir_outbound',
  inbound: 'line.material_dir_inbound',
  adapted: 'line.material_dir_adapted',
};

export function directionLabel(direction: string, locale: Locale): string {
  const key = DIRECTION_KEYS[direction as AssetDirection];
  return key ? t(key, locale) : direction;
}

/**
 * POST /api/lines/:id/materials body. Direction is fixed 'outbound' at
 * line scope in v1 (the table CHECK forbids 'inbound' without a
 * performance; 'adapted' needs a source) — so it is not in the schema.
 */
export const MaterialCreateSchema = v.object({
  kind: v.picklist(ASSET_KINDS),
  // `v.url()` alone accepts `javascript:`/`data:` (it only runs `new URL()`).
  // A material link is a where-the-file-lives pointer, so pin it to http(s)
  // at the write boundary; the render side also guards via safeHref().
  url: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1),
    v.maxLength(2000),
    v.url(),
    v.regex(/^https?:\/\//i, 'must be an http(s) URL'),
  ),
  notes: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500)))),
});

export type MaterialCreate = v.InferOutput<typeof MaterialCreateSchema>;

export type MaterialItem = Pick<
  Tables<'asset_version'>,
  'id' | 'kind' | 'direction' | 'url' | 'notes' | 'uploaded_at' | 'uploaded_by'
>;
