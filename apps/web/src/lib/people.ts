/**
 * The person axis: who a calendar row involves, and on what evidence.
 *
 * A person is on a row by a fact or not at all (ADR-147, amending ADR-092
 * and ADR-103):
 *
 * - **A roster.** A `performance` carries one (project cast − replaced +
 *   overrides + its crew, `rosterPersonIds` in $lib/planner).
 * - **Their own word.** «Voy» on a row (`commitment_person`) puts that one
 *   person on it; «no voy» takes them off.
 * - **Nothing.** A `date` nobody gave their word on involves nobody in
 *   particular: it is the company's date (`unknown`). It is shown to whoever
 *   it may concern and claimed for nobody.
 *
 * Hour used to INFER a date's people from the project's canonical cast and
 * then ask each of them «¿vas?». That made one person's train everybody's
 * question. The project's cast still answers WHOSE PROJECT a row is (a
 * company date of a project you are not on is not yours to read), never WHO
 * GOES.
 *
 * An explicit roster is never second-guessed: somebody cast on a gig and
 * away that day is a CLASH, which the conflict engine reports
 * (`conflictsFor` → severity 'blackout'). Filtering them out here would
 * hide it from the one surface built to catch it.
 *
 * Everything here is pure and day-precision, same contract as $lib/planner
 * and $lib/carrils.
 */

import { keepsVerdict, type ViewScope } from './view-scope';

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
   * Projects this person is on file for: whose projects a company date
   * concerns (never who goes on it, ADR-147). Optional so a response from a
   * Worker that predates the field reads as "no projects known"; a company
   * date then concerns everybody, which is the side that costs nothing.
   */
  project_ids?: string[];
}

/**
 * How a row's people were reached: `explicit` when somebody is on it by a
 * roster or their own «voy», `unknown` when nobody is. The two must survive
 * to the paint: a caller must not print «free» off an `unknown`.
 */
export type PersonLink = 'explicit' | 'unknown';

interface PeopleOf {
  /** Person ids, deduped: the roster first, then whoever said «voy». */
  personIds: string[];
  link: PersonLink;
  /** True when the row carries a roster: then the list is closed, and
      somebody not on it is not going. A date's «voy» list is open. */
  rostered: boolean;
  /** Who said «no voy» (ADR-103): a «no» for them on this row. */
  withdrawnIds: string[];
}

/** One person's word on a commitment (ADR-103, `commitment_person`). */
export type CommitmentState = 'going' | 'not_going';

export interface Commitment {
  person_id: string;
  state: CommitmentState;
}

/** The PostgREST embed every feed of performances or dates selects, so the
    attribution can read each person's word (ADR-103). */
export const COMMITMENTS_EMBED = 'commitments:commitment_person(person_id,state)';

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
 * Who a calendar row involves: its roster plus whoever said «voy» (a «no
 * voy» wins over a «voy» of the same person). Nobody → `unknown`, which is
 * not the same fact as «nobody is on it».
 *
 * A roster is never filtered by a «no voy»: the roster is the record (Quién
 * va), and a disagreement there is the record's to show.
 */
export function peopleOf(input: {
  /** The row's own roster, when it has one (a performance does). */
  roster?: readonly string[] | null;
  /** Each person's word on this row (ADR-103). */
  commitments?: readonly Commitment[] | null;
}): PeopleOf {
  const roster = dedupe(input.roster ?? []);
  const commitments = input.commitments ?? [];
  const withdrawnIds = dedupe(
    commitments.filter((c) => c.state === 'not_going').map((c) => c.person_id),
  );
  const withdrawn = new Set(withdrawnIds);
  const going = commitments
    .filter((c) => c.state === 'going' && !withdrawn.has(c.person_id))
    .map((c) => c.person_id);
  const personIds = dedupe([...roster, ...going]);
  return {
    personIds,
    link: personIds.length > 0 ? 'explicit' : 'unknown',
    rostered: roster.length > 0,
    withdrawnIds,
  };
}

/**
 * How a row reaches the pinned people:
 *
 *   explicit      — one of them is on it (roster or «voy»).
 *   unattributed  — nobody named, and it is a date of their project (or of a
 *                   project with nobody on file): the company's date. Shown,
 *                   claimed for nobody, never asked about.
 *   no            — a roster without them, their own «no voy», or a
 *                   project they are not on.
 *
 * An EMPTY pin set does not narrow: everything passes as `explicit`, so the
 * predicate can sit in a filter chain unconditionally.
 */
export type PersonAttribution = 'explicit' | 'unattributed' | 'no';

export function attributionFor(
  people: PeopleOf,
  pinnedPersonIds: ReadonlySet<string>,
  /** Who is on file for the row's project: whose date it is, not who goes. */
  projectPeople?: readonly string[] | null,
): PersonAttribution {
  if (pinnedPersonIds.size === 0) return 'explicit';
  if (people.personIds.some((id) => pinnedPersonIds.has(id))) return 'explicit';
  if (people.rostered) return 'no';
  if (people.withdrawnIds.some((id) => pinnedPersonIds.has(id))) return 'no';
  const onFile = projectPeople ?? [];
  if (onFile.length > 0 && !onFile.some((id) => pinnedPersonIds.has(id))) return 'no';
  return 'unattributed';
}

/**
 * The synthetic row key for a project's company dates: the rows nobody is
 * named on (ADR-147).
 *
 * A row that resolves to nobody is a row the view loses. It gets a lane of its own, named for
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
 * WHO GOES, as a drawing says it (styles/cast.css): the names of the roster on
 * file, in its order. Data only: never the project's team as an inference
 * (design law: four people affirmed at a radio at 10h). [] is «nobody on
 * file», which the drawing says in its quieter voice. One rule for the
 * Planner's Day and the Desk's card.
 */
export function castNames(personIds: readonly string[] | null | undefined, names: ReadonlyMap<string, string>): string[] {
  return (personIds ?? []).map((id) => names.get(id)).filter((n): n is string => Boolean(n));
}

/** The person axis, resolved once for a whole view. `active` is false
    when nobody is pinned; a caller may skip the work then. */
export interface PersonAttributionScope {
  active: boolean;
  attribute(row: {
    projectId: string | null;
    roster?: readonly string[] | null;
    commitments?: readonly Commitment[] | null;
  }): PersonAttribution;
  /**
   * Does a row with this verdict stay on screen, in its space? The space's
   * «lo mío / todo» (ADR-151) when the view reads it; absent, ADR-147's rule:
   * everything but `no`.
   */
  keeps?(verdict: PersonAttribution, workspaceId: string | null): boolean;
}

/** A scope's verdict on keeping a row: its own rule, else ADR-147's. */
export function keepsRow(
  axis: PersonAttributionScope | null | undefined,
  verdict: PersonAttribution,
  workspaceId: string | null,
): boolean {
  if (!axis?.active) return true;
  return axis.keeps ? axis.keeps(verdict, workspaceId) : verdict !== 'no';
}

/**
 * Resolve the person axis for a whole view: the pinned set and, inverted out
 * of the team feed, who is on file for each project. One reading for every
 * view: the Planner keeps what is not `no`, and so do the pulse and Ahora.
 */
export function buildPersonAttribution(input: {
  pinnedPersonIds: readonly string[];
  /** GET /api/team: `project_ids` says whose project a row is. */
  team: readonly TeamItem[];
  /** The space's «lo mío / todo» (ADR-151): for the viewer's own surfaces and
      the Planner without a pin. Absent: ADR-147 (everything but `no`). */
  viewScope?: (workspaceId: string | null) => ViewScope;
}): PersonAttributionScope {
  const pinned = new Set(input.pinnedPersonIds);
  if (pinned.size === 0) {
    return { active: false, attribute: () => 'explicit' };
  }

  // project → the people on file for it. Inverted from the team feed, which
  // is keyed the other way (one row per person per workspace).
  const onFileByProject = new Map<string, string[]>();
  for (const member of input.team) {
    for (const projectId of member.project_ids ?? []) {
      const list = onFileByProject.get(projectId);
      if (list) {
        if (!list.includes(member.person_id)) list.push(member.person_id);
      } else {
        onFileByProject.set(projectId, [member.person_id]);
      }
    }
  }

  const viewScope = input.viewScope;
  return {
    active: true,
    attribute(row) {
      const people = peopleOf({ roster: row.roster, commitments: row.commitments });
      return attributionFor(people, pinned, row.projectId ? onFileByProject.get(row.projectId) : null);
    },
    keeps: viewScope ? (verdict, workspaceId) => keepsVerdict(verdict, viewScope(workspaceId)) : undefined,
  };
}

/**
 * The row keys a calendar row belongs to on the person axis: its people,
 * or, with nobody on it, its project's `no cast` row (a company date). This
 * is the function a lane view calls.
 */
export function personRowKeys(
  people: PeopleOf,
  projectId: string | null,
): { keys: string[]; link: PersonLink } {
  if (people.personIds.length > 0) return { keys: people.personIds, link: people.link };
  return { keys: projectId ? [noCastKey(projectId)] : [], link: 'unknown' };
}
