/**
 * Reserved slugs — paths that cannot be used as workspace.slug or, in the
 * narrower lists, as project/entity slugs. Protects the root namespace from
 * collisions with current routes (api, login, ...) and future routes
 * (marketing site Phase 1: pricing, docs, blog, ...).
 *
 * Since ADR-067 the workspace slug is a machine short-id, so what this list
 * really guards is the optional human-chosen *alias*.
 *
 * MIRROR: this list must equal `is_reserved_slug()` in the DB — the alias flow
 * checks both sides. They drifted apart until 2026-07-17 (`agenda` + `people`
 * lived only here); migration `2026-07-17_close_adr036_show_debt.sql` § 4
 * closed it. Change one, change the other.
 *
 * See build/url-architecture-dossier-2026-05-01.md § 5 for rationale.
 */

export const RESERVED_WORKSPACE_SLUGS = [
  // Router / system
  'h', 'public', 'api', 'auth', 'login', 'logout',
  'signup', 'signin', 'signout', 'oauth',

  // Marketing site (Phase 1)
  'www', 'app', 'home', 'about', 'pricing', 'docs', 'blog',
  'help', 'support', 'legal', 'terms', 'privacy', 'contact',
  'careers', 'status', 'changelog',

  // Conventions
  'admin', 'settings', 'account', 'profile', 'billing',
  'dashboard', 'new', 'edit', 'delete', 'search',
  'explore', 'discover',

  // Hour product vocabulary — the lens routes (desk home + planner ·
  // conversations · money), the entity segments, and `agenda`: ADR-076 makes it
  // a first-class projection reachable by its own alias route, so it cannot be
  // claimable. `calendar` (pre-Planner rename) and `people` (ADR-065 chose
  // Conversations over "People") are reserved-but-rejected — held so the names
  // can never be taken from under a revisit.
  'house', 'room', 'run', 'gig', 'desk', 'plaza',
  'roadsheet', 'conversation', 'conversations', 'person', 'venue', 'asset',
  'invoice', 'calendar', 'planner', 'agenda', 'money', 'comms', 'archive', 'people',

  // Operational
  'staging', 'dev', 'playground', 'booking',
  'assets', 'static', 'cdn',
] as const;

const WORKSPACE_SET = new Set<string>(RESERVED_WORKSPACE_SLUGS);

/**
 * Recognised entity segment for /h/[workspace]/[entity]/[slug] routing.
 * SvelteKit folder structure already enforces this (only these directories
 * exist), but we expose the list for client-side validation and tooling.
 */
export const KNOWN_ENTITY_TYPES = [
  'room', 'run', 'gig', 'conversation', 'person',
  'venue', 'asset', 'invoice',
] as const;

export type EntityType = (typeof KNOWN_ENTITY_TYPES)[number];

const ENTITY_SET = new Set<string>(KNOWN_ENTITY_TYPES);

/** True if `slug` cannot be used as a workspace slug. */
export function isReservedWorkspaceSlug(slug: string): boolean {
  return WORKSPACE_SET.has(slug.toLowerCase());
}

/** True if `entity` is a recognised entity type. */
export function isKnownEntity(entity: string): entity is EntityType {
  return ENTITY_SET.has(entity.toLowerCase());
}
