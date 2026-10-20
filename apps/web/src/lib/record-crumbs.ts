/**
 * The address a record's page writes in its head (`RecordHead`, ADR-139 § 4):
 * where it hangs (space › project › line) and, last, what kind of thing it
 * is («Función», «Persona»), never its own name, which is the title right
 * under it. The page owns the address because it has the ancestry loaded.
 */

import { accentVar } from '$lib/utils/accent';
import { spaceName } from '$lib/utils/identity';

export type Crumb = {
  label: string;
  /** Omitted on the last crumb, which names the kind and is not a link. */
  href?: string;
  /** The space's identity dot (its accent var). Only the space crumb has one. */
  accent?: string;
};

/** The first crumb of every record inside a space: its name, lowercase, with its dot. */
export function spaceCrumb(name: string | null | undefined, slug: string): Crumb {
  return { label: spaceName(name || slug), href: `/h/${slug}/`, accent: accentVar(slug) };
}
