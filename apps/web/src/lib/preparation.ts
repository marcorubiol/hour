/**
 * «Qué preparamos para una función»: the list of a project (ADR-221, fase 2).
 *
 * The list is decided once, in the project's settings, and holds for all its
 * performances. Phase 2 has the four things the app knows by itself (it closes
 * them when the data exists: confirmed, an hour, who goes, a shared road
 * sheet): each can be turned off and the order is the project's. Phase 3 adds
 * the things written by hand.
 *
 * Stored in `project.custom_fields.preparation` (JSON, no schema change),
 * written through `update_project`:
 *
 *   { "items": [ { "id": "status", "on": true }, … ] }
 *
 * No list (or a damaged one) is the default: the four, in this order, on.
 * Reading is forgiving: an unknown id is dropped, a repeated one counts once,
 * and an app thing the list lacks (the app grew one) is appended on, so an old
 * list never hides a thing it did not know about.
 *
 * Pure, without network or clock.
 */

/** The things the app knows by itself, in the default order. */
export const APP_THINGS = ['status', 'hours', 'team', 'sheet'] as const;
export type AppThing = (typeof APP_THINGS)[number];

export interface PreparationThing {
  id: AppThing;
  on: boolean;
}

export type Preparation = readonly PreparationThing[];

export const DEFAULT_PREPARATION: Preparation = APP_THINGS.map((id) => ({ id, on: true }));

const isAppThing = (id: unknown): id is AppThing => typeof id === 'string' && (APP_THINGS as readonly string[]).includes(id);

/** The list a project's `custom_fields` (or the API's `preparation`) says. */
export function readPreparation(raw: unknown): Preparation {
  const items = (raw as { items?: unknown } | null | undefined)?.items;
  if (!Array.isArray(items)) return DEFAULT_PREPARATION;
  const seen = new Set<AppThing>();
  const out: PreparationThing[] = [];
  for (const it of items) {
    const id = (it as { id?: unknown } | null)?.id;
    if (!isAppThing(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, on: (it as { on?: unknown }).on !== false });
  }
  for (const id of APP_THINGS) if (!seen.has(id)) out.push({ id, on: true });
  return out;
}

/** Whether a thing of the app is asked for (everything is, with no list). */
export function thingOn(list: Preparation | null | undefined, id: AppThing): boolean {
  return (list ?? DEFAULT_PREPARATION).find((x) => x.id === id)?.on !== false;
}

/** The position of a thing in the list (the order of the pass). */
export function thingRank(list: Preparation | null | undefined, id: AppThing): number {
  const i = (list ?? DEFAULT_PREPARATION).findIndex((x) => x.id === id);
  return i < 0 ? APP_THINGS.length : i;
}

/** What goes to `update_project`: the list as stored. */
export function preparationPatch(list: Preparation): { items: PreparationThing[] } {
  return { items: list.map((x) => ({ id: x.id, on: x.on })) };
}

/** A list moved: the thing at `from` goes to `to` (clamped); the list is unchanged if either is out. */
export function moveThing(list: Preparation, from: number, to: number): Preparation {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}
