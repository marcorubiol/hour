<script lang="ts">
  /**
   * Road sheet document — the render body shared by the operator page
   * (role preview, ADR-041) and the public token page (ADR-047). Pure
   * presentation over an already-filtered projection: the server decides
   * what `sheet` contains, this only draws non-null sections. Mobile-first
   * (read on a phone in a van), print-friendly (pinned to a dressing-room
   * door).
   */

  import type { Snippet } from 'svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import JsonKV, { hasJsonContent } from '$lib/components/JsonKV.svelte';
  import RecordHead from '$lib/components/RecordHead.svelte';
  import type { Crumb } from '$lib/record-crumbs';
  import ScheduleTable from '$lib/components/ScheduleTable.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import { dayLabel, viewerTimeZone } from '$lib/datetime';
  import { LOCALE_TAG, appLocale, t, type Locale } from '$lib/i18n';
  import { performanceStatusLabel, performanceStatusTone } from '$lib/performance';
  import type { Roadsheet } from '$lib/roadsheet';

  let {
    sheet,
    venueTz = null,
    crumbs = null,
    tools,
    locale = appLocale(),
  }: {
    sheet: Roadsheet;
    venueTz?: string | null;
    /** Where the sheet hangs (the operator page: space › project › Función).
        The public page has no way back, so it names the project and the kind. */
    crumbs?: Crumb[] | null;
    /** What acts on the sheet (the operator's «view as»), at the end of the title row. */
    tools?: Snippet;
    /** The reader's language. Internal sheet: whoever is looking; public
        sheet: the browser's if Hour speaks it, else English. Both are
        `appLocale()`, the default. */
    locale?: Locale;
  } = $props();

  /** The word for a DB enum value; the raw value with spaces when the
      dictionary has none. */
  function enumWord(prefix: string, value: string): string {
    const key = prefix + value;
    const word = t(key, locale);
    return word === key ? value.replace(/_/g, ' ') : word;
  }

  const viewerTz = viewerTimeZone();

  let address = $derived<Crumb[]>(
    crumbs ?? [...(sheet.project ? [{ label: sheet.project.name }] : []), { label: t('roadsheet.title', locale) }],
  );
</script>

<div class="record rsv">
  <RecordHead crumbs={address} title={sheet.title} actions={tools}>
    {#snippet facts()}
      <StateBadge label={performanceStatusLabel(sheet.status, locale)} tone={performanceStatusTone(sheet.status)} />
      <span>{dayLabel(sheet.performed_at, 'long', LOCALE_TAG[locale])}</span>
      {#if sheet.city}<span>{[sheet.city, sheet.country].filter(Boolean).join(', ')}</span>{/if}
    {/snippet}
  </RecordHead>

  {#if sheet.schedule}
    <section class="rsv__section" aria-label={t('perf.schedule', locale)}>
      <BlockHead title={t('perf.schedule', locale)} />
      <ScheduleTable slots={sheet.schedule} moments={sheet.schedule.moments ?? null} {venueTz} {viewerTz} {locale} />
    </section>
  {/if}

  {#if sheet.venue || sheet.venue_name}
    <section class="rsv__section" aria-label={t('create.venue', locale)}>
      <BlockHead title={t('create.venue', locale)} />
      <div class="rsv__venue">
        <strong>{sheet.venue?.name ?? sheet.venue_name}</strong>
        {#if sheet.venue?.address}<span>{sheet.venue.address}</span>{/if}
        {#if sheet.city}<span>{[sheet.city, sheet.country].filter(Boolean).join(', ')}</span>{/if}
        {#if sheet.venue?.capacity}<span class="rsv__muted">{t('venue.capacity_short', locale, { n: sheet.venue.capacity })}</span>{/if}
      </div>
      {#if hasJsonContent(sheet.venue?.contacts)}
        <JsonKV value={sheet.venue!.contacts} />
      {/if}
    </section>
  {/if}

  {#if hasJsonContent(sheet.logistics)}
    <section class="rsv__section" aria-label={t('perf.logistics', locale)}>
      <BlockHead title={t('perf.logistics', locale)} />
      <JsonKV value={sheet.logistics} />
    </section>
  {/if}

  {#if hasJsonContent(sheet.hospitality)}
    <section class="rsv__section" aria-label={t('perf.hospitality', locale)}>
      <BlockHead title={t('perf.hospitality', locale)} />
      <JsonKV value={sheet.hospitality} />
    </section>
  {/if}

  {#if hasJsonContent(sheet.technical)}
    <section class="rsv__section" aria-label={t('perf.technical', locale)}>
      <BlockHead title={t('perf.technical', locale)} />
      <JsonKV value={sheet.technical} />
    </section>
  {/if}

  {#if sheet.cast && sheet.cast.length > 0}
    <section class="rsv__section" aria-label={t('perf.cast', locale)}>
      <BlockHead title={t('perf.cast', locale)} />
      <ul class="rsv__people" role="list">
        {#each sheet.cast as m, i (i)}
          <li>
            <span class="rsv__role">{m.role}</span>
            <span class="rsv__name">
              {m.person?.full_name ?? '—'}
              {#if m.replaces}
                <span class="rsv__muted">{t('perf.replaces', locale, { name: m.replaces })}{#if m.reason} — {m.reason}{/if}</span>
              {/if}
              {#if m.person?.email || m.person?.phone}
                <span class="rsv__contact">
                  {[m.person?.email, m.person?.phone].filter(Boolean).join(' · ')}
                </span>
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if sheet.crew && sheet.crew.length > 0}
    <section class="rsv__section" aria-label={t('perf.crew', locale)}>
      <BlockHead title={t('perf.crew', locale)} />
      <ul class="rsv__people" role="list">
        {#each sheet.crew as m, i (i)}
          <li>
            <span class="rsv__role">{m.role}</span>
            <span class="rsv__name">
              {m.person?.full_name ?? '—'}
              {#if m.notes}<span class="rsv__muted">{m.notes}</span>{/if}
              {#if m.person?.email || m.person?.phone}
                <span class="rsv__contact">
                  {[m.person?.email, m.person?.phone].filter(Boolean).join(' · ')}
                </span>
              {/if}
              {#if hasJsonContent(m.contact_override)}
                <JsonKV value={m.contact_override!} />
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if sheet.contacts}
    <section class="rsv__section" aria-label={t('perf.programmer', locale)}>
      <BlockHead title={t('perf.programmer', locale)} />
      <p class="rsv__programmer">
        {sheet.contacts.programmer.full_name}
        {#if sheet.contacts.programmer.email || sheet.contacts.programmer.phone}
          <span class="rsv__contact">
            {[sheet.contacts.programmer.email, sheet.contacts.programmer.phone]
              .filter(Boolean)
              .join(' · ')}
          </span>
        {/if}
      </p>
    </section>
  {/if}

  {#if sheet.assets && sheet.assets.length > 0}
    <section class="rsv__section" aria-label={t('perf.assets', locale)}>
      <BlockHead title={t('perf.assets', locale)} />
      <ul class="rsv__people" role="list">
        {#each sheet.assets as a, i (i)}
          <li>
            <span class="rsv__role">{enumWord('perf.asset_dir_', a.direction)}</span>
            <span class="rsv__name">{enumWord('perf.asset_kind_', a.kind)}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if sheet.notes}
    <section class="rsv__section" aria-label={t('perf.notes', locale)}>
      <BlockHead title={t('perf.notes', locale)} />
      <p class="rsv__notes">{sheet.notes}</p>
    </section>
  {/if}
</div>

<style>
  @layer components {

    .rsv__section {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding: 0;
    }

    .rsv__venue {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      font-size: var(--text-s);
      color: var(--text-color);
    }

    .rsv__people li {
      display: flex;
      gap: var(--space-m);
      align-items: baseline;
      padding-block: var(--space-xs);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }

    .rsv__role {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      color: var(--text-faint);
      min-inline-size: var(--record-label-inline);
    }

    .rsv__name {
      font-size: var(--text-s);
      color: var(--text-color);
    }

    .rsv__muted {
      display: block;
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .rsv__contact {
      display: block;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .rsv__programmer {
      font-size: var(--text-s);
    }

    .rsv__notes {
      font-size: var(--text-s);
      white-space: pre-wrap;
      line-height: 1.55;
    }

  }
</style>
