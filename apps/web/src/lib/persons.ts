/**
 * Somebody of the team who is not a conversation (ADR-107): the person
 * pickers' search and their «Añadir "nombre"».
 *
 * Every picker (the project cast, «quién va» on a performance or a date)
 * matches and creates through here, so they agree on when a typed name is
 * already somebody and refresh the same feeds after an add.
 */

import type { QueryClient } from '@tanstack/svelte-query';
import { mutateJSON } from '$lib/api';
import { normPlace } from '$lib/places';

/** The dossier `POST /api/persons` returns (`workspace_person`'s row). */
export interface CreatedPerson {
  workspace_id: string;
  person_id: string;
  slug: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
}

/** What a picker offers: a person id and the name it shows. */
export interface PersonOption {
  person_id: string;
  full_name: string;
}

/** Folding for names: case, accents and punctuation do not tell people apart. */
const fold = normPlace;

/**
 * The options whose name contains what was typed (every word, in any order),
 * and whether «Añadir "texto"» is offered: only for a non-empty text that is
 * not already exactly somebody's name. With nothing typed, all options.
 */
export function matchPeople<T extends PersonOption>(
  options: readonly T[],
  text: string,
): { matches: T[]; canAdd: boolean } {
  const want = fold(text);
  if (!want) return { matches: [...options], canAdd: false };
  const words = want.split(' ');
  const matches = options.filter((o) => {
    const name = fold(o.full_name);
    return words.every((w) => name.includes(w));
  });
  return { matches, canAdd: !options.some((o) => fold(o.full_name) === want) };
}

/** Feeds that list people: the cast panel, the team and the person axis. */
const FEEDS = ['project-cast', 'planner-team'] as const;

export async function createPerson(
  queryClient: QueryClient,
  workspaceId: string,
  fullName: string,
): Promise<CreatedPerson> {
  const body = await mutateJSON<{ person?: CreatedPerson }>('POST', '/api/persons', {
    workspace_id: workspaceId,
    full_name: fullName.trim(),
  });
  if (!body?.person) throw new Error('create_failed');
  await Promise.all(FEEDS.map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
  return body.person;
}
