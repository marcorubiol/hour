<script lang="ts">
  /**
   * Credits and licences: the public data Hour shows, where it comes from,
   * under which licence and of which date. The licences oblige to it:
   * Licence Ouverte 2.0 (Basilic) asks for the source and the date of its
   * last update, the Generalitat's open licence for attribution with the
   * date and no sublicensing, CC BY 4.0 (Castilla y León, GeoNames) for
   * attribution. The directory's sources are read from the base
   * (`venue_directory_source`, filled by each import), so the dates are the
   * ones of the data actually loaded.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { fetchJSON } from '$lib/api';
  import { detectLocale, t } from '$lib/i18n';

  type Source = {
    key: string;
    name: string;
    publisher: string;
    license: string;
    license_url: string;
    source_url: string;
    attribution: string;
    data_date: string | null;
    imported_at: string | null;
  };

  const locale = detectLocale(navigator.language);
  const sources = createQuery({
    queryKey: ['venue-directory', 'sources'],
    queryFn: ({ signal }) => fetchJSON<{ items: Source[] }>('/api/venue-directory/sources', signal),
  });

  const dateOf = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
</script>

<svelte:head><title>{t('legal.title', locale)} · Hour</title></svelte:head>

<section class="legal" aria-busy={$sources.isPending}>
  <h1>{t('legal.title', locale)}</h1>

  <h2>{t('legal.directory_title', locale)}</h2>
  <p>{t('legal.directory_intro', locale)}</p>
  {#if $sources.isError}
    <p class="legal__faint">{t('legal.unavailable', locale)}</p>
  {:else if $sources.data}
    {#if $sources.data.items.length === 0}
      <p class="legal__faint">{t('legal.not_loaded', locale)}</p>
    {/if}
    <dl>
      {#each $sources.data.items as s (s.key)}
        <dt><a href={s.source_url} target="_blank" rel="noopener">{s.name}</a></dt>
        <dd>
          <p>{s.attribution}</p>
          <p class="legal__faint">
            {s.publisher} · {t('legal.license', locale)}:
            <a href={s.license_url} target="_blank" rel="noopener">{s.license}</a>
            {#if s.data_date}· {t('legal.data_date', locale, { date: dateOf(s.data_date) })}{/if}
            {#if s.imported_at}· {t('legal.imported', locale, { date: dateOf(s.imported_at) })}{/if}
          </p>
        </dd>
      {/each}
    </dl>
    <p class="legal__faint">{t('legal.no_sublicense', locale)}</p>
  {/if}

  <h2>{t('legal.places_title', locale)}</h2>
  <p>
    {t('legal.places_body', locale)}
    <a href="https://www.geonames.org" target="_blank" rel="noopener">GeoNames</a> (CC BY 4.0) ·
    <a href="https://github.com/mborsetti/airportsdata" target="_blank" rel="noopener">airportsdata</a> (MIT).
  </p>
</section>

<style>
  @layer components {
    .legal {
      max-inline-size: 46rem;
    }
    .legal dl {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
    .legal dd {
      margin: 0;
    }
    .legal dd p {
      margin: 0;
    }
    .legal__faint {
      font-size: var(--text-s);
      color: var(--text-faint);
    }
  }
</style>
