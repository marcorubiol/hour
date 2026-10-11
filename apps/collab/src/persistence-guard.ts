export type CollabTargetTable = 'performance' | 'project' | 'line' | 'date';

/**
 * What each kind of doc holds and materializes. The notes (ADR-025) are the
 * doc's on a performance, a project and a line. The running order (ADR-090)
 * is the doc's on a performance and on a day; a day's NOTES are not: they are
 * written by its form (task 15), so its doc never seeds nor writes them.
 */
export const DOC_FIELDS: Readonly<
  Record<CollabTargetTable, { notes: boolean; schedule: boolean }>
> = {
  performance: { notes: true, schedule: true },
  date: { notes: false, schedule: true },
  project: { notes: true, schedule: false },
  line: { notes: true, schedule: false },
};

export function isCollabTargetTable(table: string): table is CollabTargetTable {
  return Object.hasOwn(DOC_FIELDS, table);
}

export interface CollabTarget {
  table: CollabTargetTable;
  id: string;
}

export interface HydratedMarker extends CollabTarget {
  state: 'hydrated';
  version: number;
}

export function createHydratedMarker(
  target: CollabTarget,
  version: number,
): HydratedMarker {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new Error(`Invalid collab snapshot version: ${version}`);
  }
  return { ...target, state: 'hydrated', version };
}

/**
 * Storage is an untyped serialization boundary. A save may proceed only
 * when the durable marker belongs to this exact document and contains a
 * valid snapshot version.
 */
export function isHydratedFor(
  value: unknown,
  target: CollabTarget,
): value is HydratedMarker {
  if (typeof value !== 'object' || value === null) return false;
  const marker = value as Partial<HydratedMarker>;
  return (
    marker.state === 'hydrated' &&
    marker.table === target.table &&
    marker.id === target.id &&
    typeof marker.version === 'number' &&
    Number.isSafeInteger(marker.version) &&
    marker.version >= 0
  );
}

/**
 * A previously committed durable version is a lower bound for external
 * hydration. Treat a missing or older Postgres snapshot as an unavailable
 * source, not as a fresh document.
 */
export function assertSnapshotDidNotRegress(
  previous: unknown,
  target: CollabTarget,
  loadedVersion: number | null,
): void {
  if (!isHydratedFor(previous, target)) return;

  if (loadedVersion === null) {
    if (previous.version > 0) {
      throw new Error(
        `Snapshot regression for ${target.table}/${target.id}: expected at least version ${previous.version}, received none`,
      );
    }
    return;
  }

  if (!Number.isSafeInteger(loadedVersion) || loadedVersion < previous.version) {
    throw new Error(
      `Snapshot regression for ${target.table}/${target.id}: expected at least version ${previous.version}, received ${loadedVersion}`,
    );
  }
}

/**
 * Fetch both inputs needed to initialize a collaborative document. Errors
 * intentionally propagate: callers must not replace a failed load with an
 * empty Y.Doc.
 */
export async function loadHydrationInputs<TMeta, TSnapshot>(
  target: CollabTarget,
  fetchMeta: () => Promise<TMeta | null>,
  fetchSnapshot: () => Promise<TSnapshot | null>,
): Promise<{ meta: TMeta; snapshot: TSnapshot | null }> {
  const meta = await fetchMeta();
  if (meta === null) {
    throw new Error(`Cannot hydrate missing ${target.table}/${target.id}`);
  }

  const snapshot = await fetchSnapshot();
  return { meta, snapshot };
}

interface SaveActions {
  persistSnapshot: (version: number) => Promise<void>;
  persistHydration: (marker: HydratedMarker) => Promise<void>;
  materialize: () => Promise<void>;
}

/**
 * Preserve the only safe write order: immutable snapshot first, durable
 * version marker second, the denormalized projections last (the notes column,
 * the running order's rows). If either of the first two operations fails,
 * nothing is materialized.
 */
export async function commitSnapshotThenMaterialize(
  current: HydratedMarker,
  actions: SaveActions,
): Promise<HydratedMarker> {
  const next = createHydratedMarker(current, current.version + 1);
  await actions.persistSnapshot(next.version);
  await actions.persistHydration(next);
  await actions.materialize();
  return next;
}
