/**
 * The person axis — who a calendar row involves, and how sure we are.
 *
 * Hour has no date↔person table: a `performance` carries a real roster
 * (project cast − replaced + overrides + its crew, `rosterPersonIds` in
 * $lib/planner), and a `date` row carries nobody at all. So the only
 * honest way to say "this rehearsal is Laia's" is to INFER it from the
 * project's canonical cast (`cast_member`, which hangs off the project) —
 * and an inference that is allowed to say anything is worse than no
 * inference.
 *
 * Two rules govern this whole module, and they pull in opposite
 * directions on purpose:
 *
 * 1. **An explicit roster is never second-guessed.** If someone is cast on
 *    a gig and also away that day, that is a CLASH, and the conflict
 *    engine already reports it (`conflictsFor` → severity 'blackout').
 *    Filtering them out here would make the clash disappear from the one
 *    surface that exists to catch it.
 *
 * 2. **Inference stops at the door of an absence.** Somebody who is away
 *    is not a candidate for a night nobody was cast on. Without this gate
 *    one lane says both "she is away all day" and "she may be rehearsing
 *    at 10h" — the same row asserting two incompatible things.
 *
 * The two rules are the same idea seen from both ends: a fact outranks an
 * inference, and an inference must never overwrite a fact.
 *
 * Everything here is pure and day-precision (ISO `YYYY-MM-DD` string
 * compares), same contract as $lib/planner and $lib/carrils: the caller
 * buckets timestamps into days and supplies "today".
 */

/**
 * One member of a workspace's team, as `GET /api/team` returns them. The
 * canonical shape lives here because this module is what reasons about
 * people: it was declared three times (the endpoint, the planner feed and
 * the blackout dialog) with one of them carrying a comment admitting the
 * copy, which is how the three drift.
 */
export interface TeamItem {
  person_id: string;
  workspace_id: string;
  slug: string;
  full_name: string;
  /**
   * Projects this person is on file for — the pool an inference draws from.
   * Optional so a response from a Worker that predates the field reads as
   * "no projects known" rather than breaking the feed; the person axis then
   * degrades to `unknown`, which is its honest empty state.
   */
  project_ids?: string[];
}

/**
 * How an attribution was reached. The distinction is load-bearing and must
 * survive all the way to the paint: an inferred mark is drawn weaker than a
 * fact (and a count built on inference cannot claim somebody is free).
 */
export type PersonLink = 'explicit' | 'inferred' | 'unknown';

export interface PeopleOf {
  /** Person ids, deduped, in the order the inputs offered them. */
  personIds: string[];
  link: PersonLink;
}

const EMPTY_AWAY: ReadonlySet<string> = new Set<string>();

function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Who a calendar row involves.
 *
 * - A non-empty `roster` wins outright and comes back `explicit` — **never
 *   filtered by `awayPersonIds`** (rule 1 above).
 * - With no roster, the project's canonical cast minus whoever is away that
 *   day comes back `inferred` (rule 2).
 * - Nothing left to say: `unknown` with an empty list. That is not the same
 *   fact as "nobody is on it" — a caller must not print "free" off an
 *   `unknown`, which is why it has its own word.
 */
export function peopleOf(input: {
  /** The row's own roster, when it has one (a performance does). */
  roster?: readonly string[] | null;
  /** The project's canonical cast — the inference pool for a date row. */
  projectCast?: readonly string[] | null;
  /** Person ids unavailable on this row's day (see `awayPersonIdsOn`). */
  awayPersonIds?: ReadonlySet<string> | null;
}): PeopleOf {
  const roster = dedupe(input.roster ?? []);
  if (roster.length > 0) return { personIds: roster, link: 'explicit' };

  const away = input.awayPersonIds ?? EMPTY_AWAY;
  const candidates = dedupe(input.projectCast ?? []).filter((id) => !away.has(id));
  if (candidates.length > 0) return { personIds: candidates, link: 'inferred' };

  return { personIds: [], link: 'unknown' };
}

/** The verdict of narrowing a row by a set of pinned people. */
export type PersonMatch = 'explicit' | 'inferred' | 'no';

/**
 * Does this row involve any of the pinned people, and on what evidence?
 *
 * An EMPTY pin set does not narrow: the person axis simply is not in play,
 * so everything passes as `explicit`. That lets the predicate sit in a
 * filter chain unconditionally instead of making every caller remember to
 * skip it — and it is the honest answer, because with nobody pinned no row
 * is being included *because of* an inference.
 */
export function matchesPinnedPeople(
  people: PeopleOf,
  pinnedPersonIds: ReadonlySet<string>,
): PersonMatch {
  if (pinnedPersonIds.size === 0) return 'explicit';
  for (const id of people.personIds) {
    if (pinnedPersonIds.has(id)) return people.link === 'inferred' ? 'inferred' : 'explicit';
  }
  return 'no';
}

/** A person-level unavailability, as this module consumes it. */
export interface AwayInput {
  /** NULL = a company closure, which is not a person being away. */
  person_id: string | null;
  /** Inclusive ISO day. */
  starts_on: string;
  /** Inclusive ISO day. */
  ends_on: string;
}

/**
 * The person ids unavailable on one ISO day — the inference gate.
 *
 * Company-wide closures (`person_id === null`) are deliberately NOT
 * included: only a person can be away, a workspace does not go on holiday.
 * A row that lands inside a closure is a conflict the engine reports; it is
 * not an attribution question, and folding it in here would make every
 * member of the company un-inferable for a fortnight in August.
 *
 * Certainty is deliberately ignored too: a tentative absence is still a
 * reason not to *guess* that somebody is working. The certainty axis
 * belongs to what gets drawn, not to who is a candidate.
 */
export function awayPersonIdsOn(blocks: readonly AwayInput[], isoDay: string): Set<string> {
  const out = new Set<string>();
  for (const b of blocks) {
    if (b.person_id === null) continue;
    if (isoDay >= b.starts_on && isoDay <= b.ends_on) out.add(b.person_id);
  }
  return out;
}

/**
 * Same answer, indexed for a whole window — one pass over the blocks
 * instead of one pass per day. The grid asks 42 times and the agenda book
 * asks once per day of a multi-month span, so the index is the shape those
 * callers want; `awayPersonIdsOn` stays for a single lookup.
 */
export function awayIndex(
  blocks: readonly AwayInput[],
  days: readonly string[],
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const day of days) index.set(day, new Set<string>());
  for (const b of blocks) {
    if (b.person_id === null) continue;
    for (const day of days) {
      if (day >= b.starts_on && day <= b.ends_on) index.get(day)!.add(b.person_id);
    }
  }
  return index;
}

/**
 * The synthetic row key for a project whose people are unknown.
 *
 * A project with nobody on file still has nights, and a row that resolves
 * to nobody is a row the view loses. It gets a lane of its own, named for
 * what it is, so its dates are never homeless. Prefixed so it can never
 * collide with a person id (uuids have no `:`).
 */
const NO_CAST = 'nocast:';

export function noCastKey(projectId: string): string {
  return `${NO_CAST}${projectId}`;
}

export function noCastProjectId(key: string): string | null {
  return key.startsWith(NO_CAST) ? key.slice(NO_CAST.length) : null;
}

/**
 * A narrowed person axis, ready to judge calendar rows — everything the
 * predicate needs resolved once instead of per row.
 *
 * `active` is false when nobody is pinned; a caller should skip the whole
 * filter then rather than trust a pass-through.
 */
export interface PersonScope {
  active: boolean;
  /**
   * Does this row involve the pinned people, and on what evidence? A
   * performance passes its own `roster`; a date passes none and gets the
   * inference (its project's cast, minus whoever is away that day).
   */
  verdict(row: {
    projectId: string | null;
    /** ISO day the row is bucketed into — the away gate is per day. */
    day: string;
    roster?: readonly string[] | null;
  }): PersonMatch;
}

/**
 * Resolve the person axis for a whole view: the pinned set, the per-project
 * cast pool inverted out of the team feed, and a lazily-built away index.
 *
 * The away index is per day and memoised because the month asks 42 times and
 * the agenda book once per day of a multi-month span; scanning every block per
 * row would be quadratic for no reason.
 */
export function buildPersonScope(input: {
  pinnedPersonIds: readonly string[];
  /** GET /api/team — `project_ids` is the inference pool. */
  team: readonly TeamItem[];
  /** Availability rows; company closures are ignored (see `awayPersonIdsOn`). */
  blocks: readonly AwayInput[];
}): PersonScope {
  const pinned = new Set(input.pinnedPersonIds);
  if (pinned.size === 0) {
    return { active: false, verdict: () => 'explicit' };
  }

  // project → the people on file for it. Inverted from the team feed, which
  // is keyed the other way (one row per person per workspace).
  const castByProject = new Map<string, string[]>();
  for (const member of input.team) {
    for (const projectId of member.project_ids ?? []) {
      const list = castByProject.get(projectId);
      if (list) {
        if (!list.includes(member.person_id)) list.push(member.person_id);
      } else {
        castByProject.set(projectId, [member.person_id]);
      }
    }
  }

  const awayCache = new Map<string, Set<string>>();
  const awayOn = (day: string): Set<string> => {
    const hit = awayCache.get(day);
    if (hit) return hit;
    const built = awayPersonIdsOn(input.blocks, day);
    awayCache.set(day, built);
    return built;
  };

  return {
    active: true,
    verdict(row) {
      const people = peopleOf({
        roster: row.roster,
        projectCast: row.projectId ? castByProject.get(row.projectId) : null,
        awayPersonIds: awayOn(row.day),
      });
      return matchesPinnedPeople(people, pinned);
    },
  };
}

/**
 * The row keys a calendar row belongs to on the person axis — the
 * attribution above, with the homeless case resolved to its project's
 * `no cast` row. This is the function a lane view calls; a scope filter
 * calls `matchesPinnedPeople` instead, because a synthetic row is not
 * somebody you can pin.
 */
export function personRowKeys(
  people: PeopleOf,
  projectId: string | null,
): { keys: string[]; link: PersonLink } {
  if (people.personIds.length > 0) return { keys: people.personIds, link: people.link };
  return { keys: projectId ? [noCastKey(projectId)] : [], link: 'unknown' };
}
