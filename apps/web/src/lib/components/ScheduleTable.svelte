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
   * ScheduleTable — the running order with dual-timezone display
   * (D-PRE-10): venue wall time first, viewer time alongside when it
   * differs. Shared by ProductionStub (performance detail) and the road
   * sheet.
   *
   * ADR-090 P3: when the caller has the whole running order (`moments`), it
   * draws every moment in its order, free ones included («photo call»).
   * Without it (the public sheet, whose SQL projection still serializes the
   * five) it draws the five fields, as it always did.
   */

  import { dualTime } from '$lib/datetime';
  import { appLocale, t, type Locale } from '$lib/i18n';
  import { KIND_WORD_KEYS } from '$lib/running-order';
  import type { ScheduleMoment } from '$lib/schedule-slot';

  interface Props {
    slots: ScheduleSlots;
    moments?: ScheduleMoment[] | null;
    venueTz: string | null;
    viewerTz: string;
    /** The word for one of the five kinds. Defaults to the reader's
        language, with the words the running order and Desk use. */
    kindWord?: (kind: string) => string;
    /** The reader's language; defaults to the session's. */
    locale?: Locale;
  }

  let {
    slots,
    moments = null,
    venueTz,
    viewerTz,
    locale = appLocale(),
    kindWord = (k) => (KIND_WORD_KEYS[k] ? t(KIND_WORD_KEYS[k], locale) : k.replace(/_/g, ' ')),
  }: Props = $props();

  const FIELDS: ReadonlyArray<[string, keyof ScheduleSlots]> = [
    ['load_in', 'load_in_at'],
    ['soundcheck', 'soundcheck_at'],
    ['start', 'start_at'],
    ['loadout', 'loadout_at'],
    ['wrap', 'wrap_at'],
  ];

  let rows = $derived(
    moments
      ? moments.map((m) => ({ label: m.label ?? (m.kind ? kindWord(m.kind) : ''), at: m.at }))
      : FIELDS.map(([kind, key]) => ({ label: kindWord(kind), at: slots[key] })).filter((r) => r.at),
  );
</script>

{#if rows.length > 0}
  <table class="schedule" aria-label={t('perf.schedule', locale)}>
    <tbody>
      {#each rows as row, i (i)}
        {@const time = dualTime(row.at!, venueTz, viewerTz)}
        <tr>
          <th scope="row">{row.label}</th>
          <td>
            <span class="schedule__time">{time.primary}</span>
            {#if time.secondary}
              <span class="schedule__time-alt">{t('roadsheet.time_yours', locale, { time: time.secondary })}</span>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{:else}
  <p class="schedule__empty">{t('perf.no_schedule', locale)}</p>
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
