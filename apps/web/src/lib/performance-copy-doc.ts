/**
 * The running order half of «Copiar de otra función» (ADR-169, punto 83):
 * the order lives in the performance's collab doc (ADR-090 P2), so the copy
 * is written there, like any edit of the editor, and the Durable Object
 * materializes it. The doc is shared with the open editor (`openCollabDoc`
 * counts its openers), so whoever has the record open sees the copy arrive.
 */
import { openCollabDoc } from './collab-doc';
import { mergeSchedule, type CopyMode } from './performance-copy';
import { readSchedule, writeSchedule } from './schedule-doc';
import type { ScheduleSlotInput } from './schedule-slot';

/** How long the doc may take to sync before the copy says it could not. */
const SYNC_WAIT_MS = 10_000;
/** The update leaves over the socket; a closing opener lets it go first. */
const FLUSH_WAIT_MS = 1_500;

/** Writes the copied order into the destination's doc. Resolves with what changed (false: nothing to add). */
export async function copyScheduleIntoDoc(
  performanceId: string,
  copied: readonly ScheduleSlotInput[],
  mode: CopyMode,
): Promise<boolean> {
  const collab = openCollabDoc('performance', performanceId);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('schedule_doc_unsynced')), SYNC_WAIT_MS);
      collab.onSynced(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    const next = mergeSchedule(readSchedule(collab.doc), copied, mode);
    if (!next) return false;
    writeSchedule(collab.doc, next);
    await new Promise((r) => setTimeout(r, FLUSH_WAIT_MS));
    return true;
  } finally {
    collab.close();
  }
}
