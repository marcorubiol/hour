/**
 * Las facetas del espacio en Ajustes (comms carril 2, fase 4; plan
 * `build/plans/2026-10-22-comms-threads-facets.md` § 3.5; ADR-099 añadido,
 * ADR-100 § 6, ADR-104, ADR-105).
 *
 * Tres cosas en una pantalla, con el molde de las etiquetas (ADR-138 fase 4):
 * - el vocabulario: las estándar de Hour y las propias, renombrar, apagar,
 *   ordenar, crear una propia con los niveles donde existe;
 * - qué da cada paquete (Mínim, Equip, Coordinació, Direcció): fijo de Hour,
 *   solo se lee;
 * - los ajustes por persona: la faceta que una membresía tiene de más o de
 *   menos que su paquete, dada a mano (`set_membership_facet`).
 *
 * APAGAR NO CAMBIA QUIÉN LEE LOS DATOS (structure-model § Facet): quita el
 * hilo y la palabra; la RLS de los datos no mira `workspace_facet_setting`.
 * Aquí no se borra nada: no hay DELETE en `facet`.
 */

import { t, type Locale } from '$lib/i18n';
import { facetName } from '$lib/threads';
import { tagKeyFromLabel } from '$lib/conversation-tags';

export type ContainerLevel = 'workspace' | 'project' | 'line' | 'bolo' | 'performance';
export type AccessVerb = 'view' | 'edit';
export type PresetKey = 'minim' | 'equip' | 'coordinacio' | 'direccio';

/** Los niveles por debajo del espacio, en el orden de la escalera. */
export const LEVELS: readonly ContainerLevel[] = ['workspace', 'project', 'line', 'bolo', 'performance'];

/**
 * Dónde puede existir una faceta propia. El espacio no: una faceta en el
 * espacio valdría en todos los proyectos, y eso no está decidido (ADR-104;
 * `set_membership_facet` lo rechaza con 0A000).
 */
export const OWN_LEVELS: readonly ContainerLevel[] = ['project', 'line', 'bolo', 'performance'];

/** El largo del nombre: el CHECK de `facet.label` y `workspace_facet_setting.label`. */
export const FACET_LABEL_MAX = 60;

// ── Las filas de la base ─────────────────────────────────────────────────────

export interface FacetRow {
  id: string;
  workspace_id: string | null;
  key: string;
  label: string | null;
  labels: Record<string, string> | null;
  sort: number;
  levels: { level: ContainerLevel }[] | null;
}

export interface FacetSettingRow {
  workspace_id: string;
  facet_id: string;
  label: string | null;
  labels: Record<string, string> | null;
  active: boolean;
  sort: number | null;
}

export interface PresetRow {
  key: PresetKey;
  sort: number;
  container_verb: AccessVerb;
  can_edit_meta: boolean;
}

export interface PresetFacetRow {
  preset_key: PresetKey;
  facet_key: string;
  verb: AccessVerb;
}

/** Una membresía bajo el espacio con sus facetas, como la lee un admin. */
export interface GrantRow {
  id: string;
  level: ContainerLevel;
  user_id: string;
  preset: string | null;
  /** El nombre de la persona (`list_workspace_access`) y del contenedor. */
  name: string | null;
  container: string | null;
  facets: { facet_id: string; verb: AccessVerb; source: string }[] | null;
}

/** `GET /api/workspaces/[id]/facets`. */
export interface FacetsPayload {
  can_edit: boolean;
  facets: FacetRow[];
  settings: FacetSettingRow[];
  presets: PresetRow[];
  preset_facets: PresetFacetRow[];
  /** Solo para un admin; vacío para los demás. */
  grants: GrantRow[];
}

// ── El vocabulario en Ajustes ───────────────────────────────────────────────

export interface SettingsFacet {
  id: string;
  key: string;
  /** De Hour (se renombra en el espacio) o propia (lleva su nombre). */
  standard: boolean;
  label: string | null;
  labels: Record<string, string>;
  active: boolean;
  sort: number;
  /** Dónde existe, en el orden de la escalera. */
  levels: ContainerLevel[];
}

/** Todas las facetas de un espacio para Ajustes, activas y no, en su orden. */
export function settingsFacets(
  rows: readonly FacetRow[],
  settings: readonly FacetSettingRow[],
  workspaceId: string,
): SettingsFacet[] {
  const setting = new Map(settings.filter((s) => s.workspace_id === workspaceId).map((s) => [s.facet_id, s]));
  return rows
    .filter((f) => f.workspace_id === null || f.workspace_id === workspaceId)
    .map((f) => {
      const s = setting.get(f.id);
      const levels = new Set((f.levels ?? []).map((l) => l.level));
      return {
        id: f.id,
        key: f.key,
        standard: f.workspace_id === null,
        label: s?.label ?? f.label,
        labels: { ...(f.labels ?? {}), ...(s?.labels ?? {}) },
        active: s?.active !== false,
        sort: s?.sort ?? f.sort,
        levels: LEVELS.filter((l) => levels.has(l)),
      };
    })
    .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
}

/** El nombre de una faceta: el del espacio en tu idioma, el suyo, o la palabra de Hour. */
export function facetLabel(f: Pick<SettingsFacet, 'key' | 'label' | 'labels'>, locale: Locale): string {
  return facetName({ facet_key: f.key, label: f.label, labels: f.labels }, locale);
}

/** «proyecto · línea · bolo»: dónde existe. */
export function levelsText(levels: readonly ContainerLevel[], locale: Locale): string {
  return levels.map((l) => t(`facets.level_${l}`, locale)).join(' · ');
}

export type FacetKeyProblem = 'invalid' | 'taken';

/**
 * Por qué un nombre no sirve para una faceta nueva, o null. `taken` son las
 * claves que el espacio ya usa, estándar incluidas: una propia `tecnica` se
 * confundiría con Técnica en los paquetes, que van por clave.
 */
export function newFacetProblem(label: string, taken: Iterable<string>): FacetKeyProblem | null {
  const name = label.trim();
  if (!name || name.length > FACET_LABEL_MAX) return 'invalid';
  const key = tagKeyFromLabel(name);
  if (!key) return 'invalid';
  if (new Set(taken).has(key)) return 'taken';
  return null;
}

/** Los niveles de una propia tal como llegan: solo los permitidos, sin repetir, en orden. */
export function ownLevels(levels: Iterable<string>): ContainerLevel[] {
  const set = new Set(levels);
  return OWN_LEVELS.filter((l) => set.has(l));
}

/** Lo que hay que añadir y quitar en `facet_level` para pasar de unos niveles a otros. */
export function levelDiff(
  from: readonly ContainerLevel[],
  to: readonly ContainerLevel[],
): { add: ContainerLevel[]; remove: ContainerLevel[] } {
  return { add: to.filter((l) => !from.includes(l)), remove: from.filter((l) => !to.includes(l)) };
}

// ── Qué da cada paquete ─────────────────────────────────────────────────────

export interface PresetSummary {
  key: PresetKey;
  container_verb: AccessVerb;
  can_edit_meta: boolean;
  /** Las facetas que el paquete da, en el orden del espacio. Las apagadas también: el paquete no cambia. */
  facets: { facet: SettingsFacet; verb: AccessVerb }[];
}

/** Los paquetes de Hour sobre las facetas estándar del espacio, en su orden. */
export function presetSummaries(
  presets: readonly PresetRow[],
  presetFacets: readonly PresetFacetRow[],
  facets: readonly SettingsFacet[],
): PresetSummary[] {
  return [...presets]
    .sort((a, b) => a.sort - b.sort)
    .map((p) => {
      const verbs = new Map(presetFacets.filter((pf) => pf.preset_key === p.key).map((pf) => [pf.facet_key, pf.verb]));
      return {
        key: p.key,
        container_verb: p.container_verb,
        can_edit_meta: p.can_edit_meta,
        facets: facets
          .filter((f) => f.standard && verbs.has(f.key))
          .map((f) => ({ facet: f, verb: verbs.get(f.key)! })),
      };
    });
}

// ── Los ajustes por persona ─────────────────────────────────────────────────

/** Una faceta en una membresía: lo que tiene, lo que daría su paquete y si es a mano. */
export interface GrantFacet {
  facet: SettingsFacet;
  verb: AccessVerb | null;
  /** Lo que el paquete da en ese nivel (null: el paquete no la incluye). */
  presetVerb: AccessVerb | null;
  /** Distinta del paquete: dada, cambiada o quitada a mano. */
  adjusted: boolean;
}

export interface PersonGrant {
  membership_id: string;
  level: ContainerLevel;
  name: string;
  container: string | null;
  preset: string | null;
  facets: GrantFacet[];
  /** Cuántas facetas difieren de su paquete. */
  adjusted: number;
}

/**
 * Las membresías bajo el espacio con sus facetas posibles en su nivel. Solo
 * las facetas que existen en ese nivel: ausente no es denegado
 * (structure-model § Facet), y la pantalla no lo dibuja como «no».
 */
export function personGrants(
  grants: readonly GrantRow[],
  facets: readonly SettingsFacet[],
  presetFacets: readonly PresetFacetRow[],
  fallbackName: string,
): PersonGrant[] {
  return grants
    .filter((g) => g.level !== 'workspace')
    .map((g) => {
      const held = new Map((g.facets ?? []).map((f) => [f.facet_id, f]));
      const fromPreset = new Map(
        presetFacets.filter((pf) => pf.preset_key === g.preset).map((pf) => [pf.facet_key, pf.verb]),
      );
      const list: GrantFacet[] = facets
        .filter((f) => f.levels.includes(g.level))
        .map((f) => {
          const verb = held.get(f.id)?.verb ?? null;
          // The presets expand over the standard facets only (ADR-100 § 6).
          const presetVerb = f.standard ? (fromPreset.get(f.key) ?? null) : null;
          return { facet: f, verb, presetVerb, adjusted: verb !== presetVerb };
        });
      return {
        membership_id: g.id,
        level: g.level,
        name: g.name ?? fallbackName,
        container: g.container,
        preset: g.preset,
        facets: list,
        adjusted: list.filter((f) => f.adjusted).length,
      };
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) ||
        (a.container ?? '').localeCompare(b.container ?? ''),
    );
}
