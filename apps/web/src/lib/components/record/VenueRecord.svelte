<script lang="ts">
  /**
   * Venue detail (ADR-164 § 1): the physical room, not the organization that
   * programs it (that one is `OrganizationRecord`, ADR-159). In the shape of
   * every record (ADR-139 p2): head, «Falta», blocks, Detalles.
   *
   * Its data is edited where it is read: each fact of the head (address,
   * capacity, timezone) and the notes open the one venue editor
   * (`VenueEditDialog`), the same the performance opens. The organization
   * that programs it (92, ADR-170) is a fact with a link to its record; set
   * in the same editor. Its technical
   * contacts call (`tel:`) and write (`mailto:`); its performances, past and
   * to come, are the common row (`PerformanceRows`).
   *
   * One record, two frames (ADR-139 p1 A): the page and the vistazo draw
   * this component. One column on purpose: the vistazo is narrow.
   */

  import { docTitle } from '$lib/doc-title';
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import { retryLoad } from '$lib/load-fail';
  import RecordState from '$lib/components/RecordState.svelte';
  import RecordHead from '$lib/components/RecordHead.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import Button from '$lib/components/Button.svelte';
  import MissingBand, { type MissingItem } from '$lib/components/MissingBand.svelte';
  import PerformanceRows, { type PerformanceRowItem } from '$lib/components/PerformanceRows.svelte';
  import VenueEditDialog from '$lib/components/VenueEditDialog.svelte';
  import {
    venueContactRows,
    venueOrganizations,
    venuePerformances,
    type VenueFile,
    type VenuePerformance,
  } from '$lib/venue-record';
  import { dayLabel, localDayISO } from '$lib/datetime';
  import { spaceCrumb } from '$lib/record-crumbs';
  import { isGuestIn } from '$lib/workspace-role';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { appLocale, t } from '$lib/i18n';

  interface Props {
    workspaceSlug: string;
    /** The venue's slug, or its id while it has none. */
    slug: string;
    /** Drawn in the vistazo (ADR-139 p1): no document title. */
    inPeek?: boolean;
  }

  let { workspaceSlug, slug, inPeek = false }: Props = $props();

  const locale = appLocale();
  const workspacesQuery = createQuery(workspacesQueryOptions());

  let workspace = $derived(($workspacesQuery.data?.items ?? []).find((w) => w.slug === workspaceSlug) ?? null);
  let workspaceId = $derived(workspace?.id ?? '');
  // A guest of a bolo reads; the venue is written by the space's own people
  // (`venue_update`).
  let canEdit = $derived(Boolean(workspace) && !isGuestIn(workspace));

  const query = createQuery(
    toStore(() => ({
      queryKey: ['venue', workspaceId, slug] as const,
      enabled: Boolean(slug && workspaceId),
      // A 404 is the answer: no retries.
      retry: retryLoad,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<VenueFile>(
          `/api/venues/${encodeURIComponent(slug)}?workspace_id=${encodeURIComponent(workspaceId)}`,
          signal,
        ),
    })),
  );

  let file = $derived($query.data ?? null);
  let loading = $derived($query.isPending);
  let venue = $derived(file?.venue ?? null);

  let crumbs = $derived([spaceCrumb(workspace?.name, workspaceSlug), { label: t('venue.eyebrow', locale) }]);

  const today = localDayISO();
  let split = $derived(file ? venuePerformances(file.performances, today) : { coming: [], past: [] });
  // Who programs it (92, ADR-170) goes first; the others are whom its
  // performances were with, once each.
  let programmer = $derived(file?.organization ?? null);
  let organizations = $derived(
    file ? venueOrganizations(file.performances).filter((o) => o.slug !== programmer?.slug) : [],
  );
  let contacts = $derived(venueContactRows(venue?.contacts));
  let placeLine = $derived(venue ? [venue.city, venue.country].filter(Boolean).join(', ') : '');

  function row(p: VenuePerformance): PerformanceRowItem {
    return {
      id: p.id,
      day: p.performed_at,
      // The venue is the page: the row is named by what plays there.
      title: p.project?.name ?? dayLabel(p.performed_at),
      href: p.slug ? `/h/${workspaceSlug}/performance/${encodeURIComponent(p.slug)}` : null,
      note: p.conversation?.organization?.name ?? null,
      status: p.status,
    };
  }

  let editOpen = $state(false);
  const edit = () => (editOpen = true);

  // «Falta» (ADR-139 p2): the timezone, when something is still to play there.
  // Without it the road sheet's hours fall back to the home space's clock.
  let missingItems = $derived.by<MissingItem[]>(() => {
    if (!venue || !canEdit || venue.timezone || split.coming.length === 0) return [];
    return [
      {
        id: 'timezone',
        text: t('venue.missing_timezone', locale),
        verbs: [{ label: t('venue.edit', locale), onclick: edit }],
      },
    ];
  });
</script>

<svelte:head>
  {#if !inPeek}<title>{docTitle(venue?.name ?? slug, t('venue.eyebrow', locale))}</title>{/if}
</svelte:head>

<article class="record venue" aria-busy={loading} data-testid="venue-record">
  {#if loading || ($query.isError && !file)}
    <RecordState
      {loading}
      error={$query.error}
      missingText={t('venue.not_found', locale)}
      failedText={t('venue.load_error', locale)}
      onretry={() => void $query.refetch()}
      {locale}
    />
  {:else if file && venue}
    <RecordHead {crumbs} title={venue.name}>
      {#snippet actions()}
        {#if canEdit}<Button variant="secondary" size="xs" onclick={edit}>{t('venue.edit', locale)}</Button>{/if}
      {/snippet}
      {#snippet facts()}
        {#if placeLine}<span>{placeLine}</span>{/if}
        {#if venue!.address}
          {#if canEdit}
            <span><button type="button" class="fact-act" aria-label={t('venue.address', locale)} onclick={edit}>{venue!.address}</button></span>
          {:else}
            <span>{venue!.address}</span>
          {/if}
        {/if}
        {#if venue!.capacity}
          {#if canEdit}
            <span
              ><button type="button" class="fact-act" aria-label={t('venue.capacity', locale)} onclick={edit}
                >{t('venue.capacity_short', locale, { n: venue!.capacity })}</button
              ></span
            >
          {:else}
            <span>{t('venue.capacity_short', locale, { n: venue!.capacity })}</span>
          {/if}
        {/if}
        {#if venue!.timezone}
          {#if canEdit}
            <span><button type="button" class="fact-act" aria-label={t('venue.timezone', locale)} onclick={edit}>{venue!.timezone}</button></span>
          {:else}
            <span>{venue!.timezone}</span>
          {/if}
        {/if}
        {#if programmer}
          <span data-testid="venue-programmer"
            >{t('venue.programmed_by_fact', locale)}
            <a class="lenshead__frag" href={`/h/${workspaceSlug}/organization/${encodeURIComponent(programmer.slug)}`}>{programmer.name}</a></span
          >
        {:else if canEdit}
          <span><button type="button" class="fact-act" onclick={edit}>{t('venue.programmed_by_add', locale)}</button></span>
        {/if}
        {#each organizations as o (o.slug)}
          <span
            >{t('perf.with', locale)}
            <a class="lenshead__frag" href={`/h/${workspaceSlug}/organization/${encodeURIComponent(o.slug)}`}>{o.name}</a></span
          >
        {/each}
      {/snippet}
      {#snippet band()}
        <MissingBand items={missingItems} {locale} />
      {/snippet}
    </RecordHead>

    <section class="venue__section" aria-label={t('venue.coming', locale)}>
      {#if split.coming.length > 0}
        <BlockHead title={t('venue.coming', locale)} count={split.coming.length} />
        <PerformanceRows rows={split.coming.map(row)} {locale} testid="venue-coming" />
      {:else}
        <EmptyLine label={t('venue.coming', locale)} text={t('venue.no_coming', locale)} />
      {/if}
    </section>

    <section class="venue__section" aria-label={t('venue.contacts', locale)}>
      {#if contacts.length > 0}
        <BlockHead title={t('venue.contacts', locale)} count={contacts.length} />
        <ul class="venue__contacts" role="list" data-testid="venue-contacts">
          {#each contacts as c, i (i)}
            <li>
              <span class="venue__contact-name">{c.name}</span>
              <span class="venue__contact-role">{c.role ?? ''}</span>
              {#if c.telHref}<a class="venue__contact-reach" href={c.telHref}>{c.phone}</a>{/if}
              {#if c.mailHref}<a class="venue__contact-reach" href={c.mailHref}>{c.email}</a>{/if}
            </li>
          {/each}
        </ul>
      {:else}
        <EmptyLine label={t('venue.contacts', locale)} text={t('organization.no_contacts', locale)}>
          {#if canEdit}<button type="button" class="empty-line__act" onclick={edit}>{t('venue.add_contact', locale)}</button>{/if}
        </EmptyLine>
      {/if}
    </section>

    {#if venue.notes || canEdit}
      <section class="venue__section" aria-label={t('perf.notes', locale)}>
        {#if venue.notes}
          <BlockHead title={t('perf.notes', locale)}>
            {#if canEdit}<button type="button" class="block-head__act" onclick={edit}>{t('venue.edit', locale)}</button>{/if}
          </BlockHead>
          <p class="venue__notes">{venue.notes}</p>
        {:else}
          <EmptyLine label={t('perf.notes', locale)} text={t('venue.no_notes', locale)}>
            <button type="button" class="empty-line__act" onclick={edit}>{t('venue.edit', locale)}</button>
          </EmptyLine>
        {/if}
      </section>
    {/if}

    {#if split.past.length > 0}
      <section class="venue__section" aria-label={t('venue.past', locale)}>
        <BlockHead title={t('venue.past', locale)} count={split.past.length} />
        <PerformanceRows rows={split.past.map(row)} {locale} testid="venue-past" />
      </section>
    {/if}
  {/if}
</article>

<VenueEditDialog bind:open={editOpen} {venue} {workspaceId} />

<style>
  @layer components {
    .venue__section {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .venue__contacts li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2xs) var(--space-m);
      align-items: baseline;
      padding-block: var(--space-xs);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
      font-size: var(--text-s);
    }

    .venue__contact-name {
      min-inline-size: var(--record-label-inline);
      color: var(--text-color);
    }

    .venue__contact-role {
      flex: 1;
      color: var(--text-muted);
    }

    .venue__contact-reach {
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .venue__notes {
      margin: 0;
      font-size: var(--text-s);
      white-space: pre-line;
    }
  }
</style>
