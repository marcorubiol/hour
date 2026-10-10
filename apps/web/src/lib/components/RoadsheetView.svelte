<script lang="ts">
  /**
   * Road sheet document — the render body shared by the operator page
   * (role preview, ADR-041) and the public token page (ADR-047). Pure
   * presentation over an already-filtered projection: the server decides
   * what `sheet` contains, this only draws non-null sections. Mobile-first
   * (read on a phone in a van), print-friendly (pinned to a dressing-room
   * door).
   */

  import JsonKV, { hasJsonContent } from '$lib/components/JsonKV.svelte';
  import ScheduleTable from '$lib/components/ScheduleTable.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import { dayLabel } from '$lib/datetime';
  import { LOCALE_TAG, appLocale, t, type Locale } from '$lib/i18n';
  import { performanceStatusLabel, performanceStatusTone } from '$lib/performance';
  import type { Roadsheet } from '$lib/roadsheet';

  let {
    sheet,
    venueTz = null,
    backHref = null,
    locale = appLocale(),
  }: {
    sheet: Roadsheet;
    venueTz?: string | null;
    backHref?: string | null;
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

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
</script>

<div class="rsv">
  <header class="rsv__head">
    <p class="eyebrow">
      {t('roadsheet.title', locale)}{#if sheet.project}{' · '}{sheet.project.name}{/if}
    </p>
    <h1 class="rsv__title"><em>{sheet.title}</em></h1>
    <p class="rsv__day">{dayLabel(sheet.performed_at, 'long', LOCALE_TAG[locale])}</p>
    <div class="rsv__meta">
      <StateBadge
        label={performanceStatusLabel(sheet.status, locale)}
        tone={performanceStatusTone(sheet.status)}
      />
      {#if sheet.city}
        <span class="rsv__meta-place">{[sheet.city, sheet.country].filter(Boolean).join(', ')}</span>
      {/if}
    </div>
    {#if backHref}
      <p class="rsv__back"><a href={backHref}>{t('roadsheet.back', locale)}</a></p>
    {/if}
  </header>

  {#if sheet.schedule}
    <section class="rsv__section" aria-label={t('perf.schedule', locale)}>
      <h2 class="eyebrow eyebrow--sub rsv__section-title">{t('perf.schedule', locale)}</h2>
      <ScheduleTable slots={sheet.schedule} moments={sheet.schedule.moments ?? null} {venueTz} {viewerTz} {locale} />
    </section>
  {/if}

  {#if sheet.venue || sheet.venue_name}
    <section class="rsv__section" aria-label={t('create.venue', locale)}>
      <h2 class="eyebrow eyebrow--sub rsv__section-title">{t('create.venue', locale)}</h2>
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
      <h2 class="eyebrow eyebrow--sub rsv__section-title">{t('perf.logistics', locale)}</h2>
      <JsonKV value={sheet.logistics} />
    </section>
  {/if}

  {#if hasJsonContent(sheet.hospitality)}
    <section class="rsv__section" aria-label={t('perf.hospitality', locale)}>
      <h2 class="eyebrow eyebrow--sub rsv__section-title">{t('perf.hospitality', locale)}</h2>
      <JsonKV value={sheet.hospitality} />
    </section>
  {/if}

  {#if hasJsonContent(sheet.technical)}
    <section class="rsv__section" aria-label={t('perf.technical', locale)}>
      <h2 class="eyebrow eyebrow--sub rsv__section-title">{t('perf.technical', locale)}</h2>
      <JsonKV value={sheet.technical} />
    </section>
  {/if}

  {#if sheet.cast && sheet.cast.length > 0}
    <section class="rsv__section" aria-label={t('perf.cast', locale)}>
      <h2 class="eyebrow eyebrow--sub rsv__section-title">{t('perf.cast', locale)}</h2>
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
      <h2 class="eyebrow eyebrow--sub rsv__section-title">{t('perf.crew', locale)}</h2>
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
      <h2 class="eyebrow eyebrow--sub rsv__section-title">{t('perf.programmer', locale)}</h2>
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
      <h2 class="eyebrow eyebrow--sub rsv__section-title">{t('perf.assets', locale)}</h2>
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
      <h2 class="eyebrow eyebrow--sub rsv__section-title">{t('perf.notes', locale)}</h2>
      <p class="rsv__notes">{sheet.notes}</p>
    </section>
  {/if}
</div>

<style>
  @layer components {
    .rsv {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
    }

    .rsv__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      padding-block-end: var(--space-m);
      border-block-end: 1px solid var(--border-color-light);
    }

    /* Masthead typography via base.css h1 defaults. */
    .rsv__title {
      color: var(--text-color);
    }
    .rsv__title em {
      font-style: italic;
    }

    .rsv__day {
      font-size: var(--text-m);
      color: var(--text-muted);
    }

    .rsv__meta {
      display: flex;
      align-items: baseline;
      gap: var(--space-s);
    }

    .rsv__meta-place {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      color: var(--text-faint);
    }

    .rsv__back {
      font-size: var(--text-s);
    }

    .rsv__section {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding: 0;
    }

    /* Sub-eyebrow typography via base.css .eyebrow--sub. */
    .rsv__section-title {
      margin: 0;
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
      border-block-end: 1px solid var(--border-color-light);
    }

    .rsv__role {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      color: var(--text-faint);
      min-inline-size: 7rem;
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

    @media print {
      .rsv__back {
        display: none;
      }
    }
  }
</style>
