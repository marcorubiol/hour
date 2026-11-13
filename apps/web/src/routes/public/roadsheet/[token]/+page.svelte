<script lang="ts">
  /**
   * Public road sheet (ADR-047, D6) — the page behind a signed link. No
   * account, no shell: the token is the capability and the server already
   * filtered the projection to the share's pinned role. Renders the same
   * RoadsheetView as the operator page.
   *
   * 121 B (ADR-183): a personal link says whose sheet it is and, on the day,
   * offers «Llego tarde» (RoadsheetLate). A role link has neither.
   *
   * 143: no shell sets the trade here, so the sheet brings its space's and
   * this screen speaks it (ADR-129 § 4: a screen speaks its spaces' trade).
   * An answer without it (a base before 20261113110000) speaks stage.
   */

  import { docTitle } from '$lib/doc-title';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import RoadsheetView from '$lib/components/RoadsheetView.svelte';
  import RoadsheetLate from '$lib/components/RoadsheetLate.svelte';
  import RecordState from '$lib/components/RecordState.svelte';
  import { ApiError } from '$lib/api';
  import { loadFailKind } from '$lib/load-fail';
  import { appLocale, setTrade, t, tradeOf } from '$lib/i18n';
  import type { Roadsheet } from '$lib/roadsheet';
  import type { PublicLate, RoadsheetHolder } from '$lib/roadsheet-late';

  type Response = {
    roadsheet: Roadsheet;
    venue_timezone: string | null;
    holder?: RoadsheetHolder | null;
    late?: PublicLate | null;
    trade?: string | null;
  };

  let token = $derived(page.params.token ?? '');

  /** An anonymous reader: the browser's language if Hour speaks it (ca, es,
      en, fr), else English. That is exactly `appLocale()`. */
  const locale = appLocale();

  async function fetchPublic(url: string, signal: AbortSignal): Promise<Response> {
    const res = await fetch(url, { signal });
    // No session here, so not fetchJSON; the same ApiError, so the same two
    // answers (`load-fail.ts`): a revoked link is `missing`, the rest `failed`.
    if (!res.ok) throw new ApiError(res.status, `Error ${res.status}`);
    return (await res.json()) as Response;
  }

  const queryOptions = toStore(() => {
    const k = token;
    return {
      queryKey: ['public-roadsheet', k] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchPublic(`/api/public/roadsheet/${encodeURIComponent(k)}`, signal),
      retry: false,
    };
  });
  const query = createQuery(queryOptions);

  let sheet = $derived($query.data?.roadsheet ?? null);
  let venueTz = $derived($query.data?.venue_timezone ?? null);
  let loading = $derived($query.isPending);
  let gone = $derived($query.isError && !sheet && loadFailKind($query.error) === 'missing');
  let lateState = $derived($query.data?.late ?? null);
  let holder = $derived.by(() => {
    const h = $query.data?.holder;
    if (!h?.name) return null;
    return t('roadsheet.holder', locale, { name: h.role ? `${h.name} · ${h.role}` : h.name });
  });
  let moments = $derived(sheet?.schedule?.moments ?? []);

  $effect(() => {
    setTrade(tradeOf([{ trade: $query.data?.trade }]));
  });
</script>

<svelte:head>
  <title>{docTitle(sheet?.title, t('roadsheet.title', locale))}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="prs">
  {#if gone}
    <div class="prs__gone">
      <h1>{t('roadsheet.gone_title', locale)}</h1>
      <p>{t('roadsheet.gone_body', locale)}</p>
    </div>
  {:else if loading || ($query.isError && !sheet)}
    <RecordState
      {loading}
      error={$query.error}
      missingText={t('roadsheet.gone_title', locale)}
      failedText={t('roadsheet.load_error', locale)}
      onretry={() => void $query.refetch()}
      {locale}
    />
  {:else if sheet}
    <RoadsheetView {sheet} {venueTz} {locale} {holder}>
      {#snippet late()}
        {#if lateState && (lateState.open || lateState.last)}
          <RoadsheetLate
            {token}
            late={lateState}
            {moments}
            {venueTz}
            {locale}
            onsent={() => void $query.refetch()}
          />
        {/if}
      {/snippet}
    </RoadsheetView>
  {/if}
</main>

<style>
  @layer components {
    .prs {
      max-inline-size: 40rem;
      margin-inline: auto;
      padding: var(--space-l) var(--space-m) var(--space-xxl);
    }

    .prs__gone {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding-block: var(--space-xxl);
      text-align: center;
    }

    .prs__gone h1 {
      font-family: var(--font-display);
      font-size: var(--text-xxl);
      font-weight: 400;
      color: var(--text-color);
    }

    .prs__gone p {
      font-size: var(--text-s);
      color: var(--text-muted);
    }

    @media print {
      .prs {
        max-inline-size: none;
      }
    }
  }
</style>
