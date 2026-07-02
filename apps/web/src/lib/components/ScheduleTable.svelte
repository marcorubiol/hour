<script module lang="ts">
  /** The five performance timeslots, in stage order (ADR-023). */
  export interface ScheduleSlots {
    load_in_at: string | null;
    soundcheck_at: string | null;
    start_at: string | null;
    loadout_at: string | null;
    wrap_at: string | null;
  }
</script>

<script lang="ts">
  /**
   * ScheduleTable — the 5-timeslot table with dual-timezone display
   * (D-PRE-10): venue wall time first, viewer time alongside when it
   * differs. Shared by ProductionStub (performance detail) and the road
   * sheet.
   */

  import { dualTime } from '$lib/datetime';

  interface Props {
    slots: ScheduleSlots;
    venueTz: string | null;
    viewerTz: string;
  }

  let { slots, venueTz, viewerTz }: Props = $props();

  const LABELS: ReadonlyArray<[string, keyof ScheduleSlots]> = [
    ['load in', 'load_in_at'],
    ['soundcheck', 'soundcheck_at'],
    ['start', 'start_at'],
    ['load out', 'loadout_at'],
    ['wrap', 'wrap_at'],
  ];

  let rows = $derived(
    LABELS.map(([label, key]) => ({ label, at: slots[key] })).filter((r) => r.at),
  );
</script>

{#if rows.length > 0}
  <table class="schedule" aria-label="Schedule">
    <tbody>
      {#each rows as row (row.label)}
        {@const t = dualTime(row.at!, venueTz, viewerTz)}
        <tr>
          <th scope="row">{row.label}</th>
          <td>
            <span class="schedule__time">{t.primary}</span>
            {#if t.secondary}
              <span class="schedule__time-alt">({t.secondary} yours)</span>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{:else}
  <p class="schedule__empty">No schedule yet.</p>
{/if}

<style>
  @layer components {
    .schedule {
      inline-size: auto;
      border-collapse: collapse;
    }

    .schedule th {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
      font-weight: 400;
      text-align: start;
      padding-block: var(--space-2xs);
      padding-inline-end: var(--space-l);
      text-transform: lowercase;
    }

    .schedule td {
      padding-block: var(--space-2xs);
    }

    .schedule__time {
      font-size: var(--text-l);
      color: var(--text-color);
      font-variant-numeric: tabular-nums;
    }

    .schedule__time-alt {
      margin-inline-start: var(--space-xs);
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .schedule__empty {
      font-size: var(--text-s);
      color: var(--text-faint);
    }
  }
</style>
