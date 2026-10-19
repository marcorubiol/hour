/**
 * Etiquetas de conversación en pantalla (ADR-138 § 1 y 2, fase 2 del plan
 * `build/plans/2026-10-19-conversations-tags.md`).
 *
 * La lente Conversaciones lleva una fila de chips: Todas · las etiquetas
 * activas del alcance en su orden (la de venta con su palabra de oficio) ·
 * Equipo. Selección única, en la URL (`?etiqueta=sales|press|…|team`; sin
 * parámetro, Todas). Equipo no es una etiqueta guardada: son los hilos.
 *
 * LA ETIQUETA NUNCA DECIDE PERMISOS: aquí solo se filtra y se nombra lo que
 * la RLS ya deja leer.
 *
 * Una conversación sin etiqueta se lee como Difusión (`sales`): las creadas
 * entre el esquema (fase 1) y esta pantalla no llevan ninguna.
 */

import { t, type Locale } from '$lib/i18n';

/** La etiqueta de venta: su panel es el de Difusión (ADR-117, 135). */
export const SALES = 'sales';
/** El chip de los hilos del equipo: no es una etiqueta, lo tienen todos los hilos. */
export const TEAM = 'team';
/** Todas: el chip sin parámetro. */
export const ALL = 'all';

/** La clave de una etiqueta, con el CHECK de `conversation_tag.key`. */
export const TAG_KEY_RE = /^[a-z][a-z0-9_]{1,31}$/;

/** El chip activo: `all`, `team` o la clave de una etiqueta. */
export type LensChip = string;

/** La palabra de las estándar; la de venta es la de ADR-134, con su `@music`. */
const STANDARD_LABEL: Record<string, string> = {
  sales: 'conversations.view_sales',
  press: 'conversations.tag_press',
  coproduction: 'conversations.tag_coproduction',
  distribution: 'conversations.tag_distribution',
};

/**
 * El chip de la URL. Quien no lee conversaciones (sin Converses, ADR-124)
 * solo tiene Equipo; sin parámetro, o con uno que no es una clave, Todas
 * (ADR-138 § 2).
 */
export function lensChip(params: URLSearchParams, canRead: boolean): LensChip {
  if (!canRead) return TEAM;
  const raw = params.get('etiqueta');
  if (!raw || raw === ALL) return ALL;
  if (raw === TEAM) return TEAM;
  return TAG_KEY_RE.test(raw) ? raw : ALL;
}

/**
 * Las vistas de ADR-134 pasan a chips: `?view=team` (y el viejo
 * `?view=threads`, ADR-116) van a `?etiqueta=team`. El resto de la query se
 * queda. Null si no hay nada que redirigir.
 */
export function legacyViewRedirect(params: URLSearchParams): URLSearchParams | null {
  const view = params.get('view');
  if (view !== 'team' && view !== 'threads') return null;
  const next = new URLSearchParams(params);
  next.delete('view');
  next.set('etiqueta', TEAM);
  return next;
}

/** Los filtros de bloque del panel: son del chip, y cambiar de chip los quita. */
const PANEL_PARAMS = ['turno', 'temp', 'temporada', 'linea', 'envio', 'r', 'relacion', 'view', 'etiqueta'];

/** El enlace de un chip: la query de hoy (el alcance) sin los filtros del panel. */
export function chipHref(chip: LensChip, params: URLSearchParams): string {
  const next = new URLSearchParams(params);
  for (const k of PANEL_PARAMS) next.delete(k);
  if (chip !== ALL) next.set('etiqueta', chip);
  const qs = next.toString();
  return `/h/conversations${qs ? `?${qs}` : ''}`;
}

/**
 * Un enlace del panel (`turno=nuestro#lista`) con el chip delante, para que
 * el bloque y su filtro cuenten lo mismo (ADR-118 § 7: el dominio es el chip).
 */
export function panelHref(chip: LensChip, qs: string): string {
  if (chip === ALL || chip === TEAM) return `?${qs}`;
  return `?etiqueta=${chip}${qs.startsWith('#') ? '' : '&'}${qs}`;
}

/** Qué panel lleva cada chip (plan § 3): el de Difusión, el común o el de los hilos. */
export type PanelKind = 'sales' | 'common' | 'team';

export function panelOf(chip: LensChip): PanelKind {
  if (chip === SALES) return 'sales';
  if (chip === TEAM) return 'team';
  return 'common';
}

/** El envío en bloque es un añadido de venta (ADR-138 § 7: a prensa, más adelante). */
export function canBulkSend(chip: LensChip): boolean {
  return chip === SALES;
}

/** La etiqueta con la que nace una conversación desde «Añadir»: la del chip, o Difusión. */
export function addTagKey(chip: LensChip): string {
  return chip === ALL || chip === TEAM ? SALES : chip;
}

// ── Lo que lleva cada conversación ─────────────────────────────────────────

/** El embebido `tagging:conversation_tagging(tag:conversation_tag(key))`. */
export type TaggingEmbed = { tag: { key: string } | null }[] | null | undefined;

/** El embebido de PostgREST para leer las claves de una conversación. */
export const TAGGING_EMBED = 'tagging:conversation_tagging(tag:conversation_tag(key))';

/** Las claves de una conversación; sin ninguna, Difusión. */
export function tagKeysOf(embed: TaggingEmbed): string[] {
  const keys = [...new Set((embed ?? []).map((g) => g.tag?.key).filter((k): k is string => Boolean(k)))];
  return keys.length > 0 ? keys : [SALES];
}

/** Las filas de un chip: Todas no filtra; una etiqueta, las que la llevan. */
export function filterByChip<R extends { tags?: readonly string[] }>(rows: readonly R[], chip: LensChip): R[] {
  if (chip === ALL || chip === TEAM) return [...rows];
  return rows.filter((r) => (r.tags && r.tags.length > 0 ? r.tags : [SALES]).includes(chip));
}

// ── El vocabulario ─────────────────────────────────────────────────────────

export interface TagRow {
  id: string;
  workspace_id: string | null;
  key: string;
  label: string | null;
  labels: Record<string, string> | null;
  sort: number;
}

export interface TagSettingRow {
  workspace_id: string;
  tag_id: string;
  label: string | null;
  labels: Record<string, string> | null;
  active: boolean;
  sort: number | null;
}

/** `GET /api/conversation-tags`: lo que la RLS deja leer (estándar, y las de tus espacios). */
export interface TagVocabulary {
  tags: TagRow[];
  settings: TagSettingRow[];
}

/** Una etiqueta como la usa un espacio: su id, su clave, su nombre y su orden. */
export interface WorkspaceTag {
  id: string;
  key: string;
  /** El nombre puesto por el espacio, o null para la palabra de Hour. */
  label: string | null;
  labels: Record<string, string>;
  sort: number;
}

/** Las etiquetas activas de un espacio, en su orden. */
export function workspaceTags(vocab: TagVocabulary, workspaceId: string): WorkspaceTag[] {
  const setting = new Map(vocab.settings.filter((s) => s.workspace_id === workspaceId).map((s) => [s.tag_id, s]));
  return vocab.tags
    .filter((tag) => tag.workspace_id === null || tag.workspace_id === workspaceId)
    .filter((tag) => setting.get(tag.id)?.active !== false)
    .map((tag) => {
      const s = setting.get(tag.id);
      return {
        id: tag.id,
        key: tag.key,
        label: s?.label ?? tag.label,
        labels: { ...(tag.labels ?? {}), ...(s?.labels ?? {}) },
        sort: s?.sort ?? tag.sort,
      };
    })
    .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
}

/**
 * Las etiquetas de los chips para unos espacios: las activas en alguno, por
 * clave, en orden. El nombre del espacio solo si todos los que la usan dicen
 * lo mismo; si no, la palabra de Hour (como el oficio, `tradeOf`).
 */
export function scopeTags(vocab: TagVocabulary, workspaceIds: readonly string[]): WorkspaceTag[] {
  const byKey = new Map<string, WorkspaceTag[]>();
  for (const ws of workspaceIds) {
    for (const tag of workspaceTags(vocab, ws)) byKey.set(tag.key, [...(byKey.get(tag.key) ?? []), tag]);
  }
  return [...byKey.values()]
    .map((list) => {
      const same = list.every((x) => x.label === list[0].label && JSON.stringify(x.labels) === JSON.stringify(list[0].labels));
      return same ? list[0] : { ...list[0], label: null, labels: {} };
    })
    .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
}

/** El id de una clave en un espacio, o null si allí no está activa. */
export function tagIdIn(vocab: TagVocabulary, workspaceId: string, key: string): string | null {
  return workspaceTags(vocab, workspaceId).find((x) => x.key === key)?.id ?? null;
}

/** El nombre de una etiqueta: el del espacio en tu idioma, el suyo, o la palabra de Hour. */
export function tagLabel(tag: Pick<WorkspaceTag, 'key' | 'label' | 'labels'>, locale: Locale): string {
  return tag.labels?.[locale] || tag.label || (STANDARD_LABEL[tag.key] ? t(STANDARD_LABEL[tag.key], locale) : tag.key);
}

/** El nombre de una clave a secas (una fila de la lista), buscándola en las del alcance. */
export function keyLabel(key: string, known: readonly WorkspaceTag[], locale: Locale): string {
  const tag = known.find((x) => x.key === key);
  return tag ? tagLabel(tag, locale) : tagLabel({ key, label: null, labels: {} }, locale);
}

/** Un chip de la fila: su valor y su nombre. */
export interface ChipOption {
  chip: LensChip;
  label: string;
}

/**
 * La fila de chips (ADR-138 § 1 y 2): Todas, las etiquetas, Equipo al final.
 * Sin Converses no hay conversación que leer: solo Equipo (ADR-134 § 4).
 */
export function lensChips(canRead: boolean, tags: readonly WorkspaceTag[], locale: Locale): ChipOption[] {
  const team = { chip: TEAM, label: t('conversations.view_team', locale) };
  if (!canRead) return [team];
  return [
    { chip: ALL, label: t('conversations.tag_all', locale) },
    ...tags.map((tag) => ({ chip: tag.key, label: tagLabel(tag, locale) })),
    team,
  ];
}
