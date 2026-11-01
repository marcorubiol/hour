<script module lang="ts">
  export interface PerformanceRowItem {
    id: string;
    day: string;
    title: string;
    href: string | null;
    note?: string | null;
    status: string;
  }
</script>

<script lang="ts">
  /**
   * The row of a performance inside a record (ADR-162 § 1): its day in mono,
   * what names it (a link to its record), a quiet note, and its state as the
   * mono word of every head (`fact-word`). One list, one treatment: a record
   * that lists performances draws this, it does not paste the row.
   */
  import { dayLabel } from '$lib/datetime';
  import { performanceStatusFamily, performanceStatusLabel } from '$lib/performance';
  import type { Locale } from '$lib/i18n';

  interface Props {
    rows: PerformanceRowItem[];
    locale: Locale;
    testid?: string;
  }

  let { rows, locale, testid }: Props = $props();
</script>

<ul class="perf-rows" role="list" data-testid={testid}>
  {#each rows as r (r.id)}
    <li class="perf-rows__row">
      <span class="perf-rows__day">{dayLabel(r.day)}</span>
      <span class="perf-rows__main">
        {#if r.href}<a class="perf-rows__link" href={r.href}>{r.title}</a>{:else}{r.title}{/if}
        {#if r.note}<span class="perf-rows__note"> · {r.note}</span>{/if}
      </span>
      <span class="fact-word" data-family={performanceStatusFamily(r.status)}>{performanceStatusLabel(r.status, locale)}</span>
    </li>
  {/each}
</ul>

<style>
  @layer components {
    .perf-rows__row {
      display: flex;
      gap: var(--space-m);
      align-items: baseline;
      padding-block: var(--space-xs);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }

    .perf-rows__day {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-s);
      color: var(--text-muted);
      min-inline-size: var(--record-label-inline);
    }

    .perf-rows__main {
      flex: 1;
      min-inline-size: 0;
      font-size: var(--text-s);
      color: var(--text-color);
    }

    .perf-rows__link {
      color: inherit;
      text-decoration: none;
    }
    .perf-rows__link:hover,
    .perf-rows__link:focus-visible {
      text-decoration: underline;
    }

    .perf-rows__note {
      color: var(--text-faint);
    }

    /* Narrow (the phone, the vistazo): the name takes its own line. */
    @container record (max-width: 47.999rem) {
      .perf-rows__row {
        flex-wrap: wrap;
        gap: 0 var(--space-s);
      }
      .perf-rows__main {
        flex-basis: 100%;
        order: 2;
      }
    }
  }
</style>
