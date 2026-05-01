/**
 * Reserved slugs — paths that cannot be used as workspace.slug or, in the
 * narrower lists, as project/entity slugs. Protects the root namespace from
 * collisions with current routes (api, login, ...) and future routes
 * (marketing site Phase 1: pricing, docs, blog, ...).
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

  // Hour product vocabulary
  'house', 'room', 'run', 'gig', 'desk', 'plaza',
  'roadsheet', 'engagement', 'person', 'venue', 'asset',
  'invoice', 'calendar', 'contacts', 'money', 'comms', 'archive',

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
  'room', 'run', 'gig', 'engagement', 'person',
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
