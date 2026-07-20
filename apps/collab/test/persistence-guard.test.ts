import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertSnapshotDidNotRegress,
  commitSnapshotThenMaterialize,
  createHydratedMarker,
  isHydratedFor,
  loadHydrationInputs,
  type CollabTarget,
} from '../src/persistence-guard.ts';

const target: CollabTarget = { table: 'performance', id: 'performance-1' };

test('a durable hydration marker must match the exact document', () => {
  const marker = createHydratedMarker(target, 3);

  assert.equal(isHydratedFor(marker, target), true);
  assert.equal(
    isHydratedFor(marker, { table: 'performance', id: 'performance-2' }),
    false,
  );
  assert.equal(isHydratedFor({ ...target, state: 'loading' }, target), false);
  assert.equal(isHydratedFor({ ...marker, version: -1 }, target), false);
  assert.equal(isHydratedFor({ ...marker, version: 1.5 }, target), false);
});

test('a durable version prevents hydration from an empty or older snapshot set', () => {
  const marker = createHydratedMarker(target, 4);

  assert.throws(
    () => assertSnapshotDidNotRegress(marker, target, null),
    /expected at least version 4, received none/,
  );
  assert.throws(
    () => assertSnapshotDidNotRegress(marker, target, 3),
    /expected at least version 4, received 3/,
  );
  assert.doesNotThrow(() => assertSnapshotDidNotRegress(marker, target, 4));
  assert.doesNotThrow(() => assertSnapshotDidNotRegress(marker, target, 5));
});

test('hydration fails closed when the target does not exist', async () => {
  let snapshotRequested = false;

  await assert.rejects(
    loadHydrationInputs(
      target,
      async () => null,
      async () => {
        snapshotRequested = true;
        return null;
      },
    ),
    /Cannot hydrate missing performance\/performance-1/,
  );
  assert.equal(snapshotRequested, false);
});

test('hydration propagates snapshot-load failures instead of returning empty state', async () => {
  await assert.rejects(
    loadHydrationInputs(
      target,
      async () => ({ workspace_id: 'workspace-1', notes: 'real notes' }),
      async () => {
        throw new Error('snapshot service unavailable');
      },
    ),
    /snapshot service unavailable/,
  );
});

test('failed snapshot persistence never updates the marker or notes column', async () => {
  const calls: string[] = [];

  await assert.rejects(
    commitSnapshotThenMaterialize(createHydratedMarker(target, 7), {
      persistSnapshot: async (version) => {
        calls.push(`snapshot:${version}`);
        throw new Error('database unavailable');
      },
      persistHydration: async () => {
        calls.push('marker');
      },
      materializeNotes: async () => {
        calls.push('notes');
      },
    }),
    /database unavailable/,
  );

  assert.deepEqual(calls, ['snapshot:8']);
});

test('failed marker persistence never materializes notes', async () => {
  const calls: string[] = [];

  await assert.rejects(
    commitSnapshotThenMaterialize(createHydratedMarker(target, 2), {
      persistSnapshot: async (version) => {
        calls.push(`snapshot:${version}`);
      },
      persistHydration: async () => {
        calls.push('marker');
        throw new Error('durable storage unavailable');
      },
      materializeNotes: async () => {
        calls.push('notes');
      },
    }),
    /durable storage unavailable/,
  );

  assert.deepEqual(calls, ['snapshot:3', 'marker']);
});

test('successful saves preserve snapshot, marker, notes ordering', async () => {
  const calls: string[] = [];

  const committed = await commitSnapshotThenMaterialize(
    createHydratedMarker(target, 10),
    {
      persistSnapshot: async (version) => {
        calls.push(`snapshot:${version}`);
      },
      persistHydration: async (marker) => {
        calls.push(`marker:${marker.version}`);
      },
      materializeNotes: async () => {
        calls.push('notes');
      },
    },
  );

  assert.deepEqual(calls, ['snapshot:11', 'marker:11', 'notes']);
  assert.deepEqual(committed, createHydratedMarker(target, 11));
});
