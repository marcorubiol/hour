<script lang="ts">
  /**
   * La vista Envíos de Conversaciones (ADR-176): lo que sale a muchos. Arriba
   * la temporada de Difusión (SeasonBand); debajo, difusión e invitaciones en
   * una lista, lo que va a salir y lo último arriba, con a quién y sus cifras
   * (`GET /api/mailout?list=1`, de 20 en 20); al lado, las listas del público
   * (AudiencePanel), que son el «a quién» de una invitación. Las respuestas de
   * un envío se leen en Conversaciones (`?envio=`), no aquí: un envío no es
   * un chat.
   */
  import { createInfiniteQuery, createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import { t, type Locale } from '$lib/i18n';
  import { dayMonth } from '$lib/datetime';
  import { retryLoad } from '$lib/load-fail';
  import type { Relation } from '$lib/conversation-relation';
  import { audienceListQueryOptions } from '$lib/audience-query';
  import {
    MAILOUT_PAGE,
    MAILOUT_TYPES,
    type MailoutListResponse,
    type MailoutRow,
    type MailoutType,
  } from '$lib/mailout-list';
  import type { NavWorkspace } from '$lib/nav';
  import AudiencePanel from '$lib/components/AudiencePanel.svelte';
  import Button from '$lib/components/Button.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import SeasonBand from '$lib/components/SeasonBand.svelte';

  interface Props {
    filters: { projectIds: string[]; workspaceIds: string[]; lineIds: string[]; enabled: boolean };
    /** The spaces on screen: the audience lists are per space. */
    scopeWorkspaceIds: string[];
    workspaces: NavWorkspace[];
    workspaceSlugById: Map<string, string>;
    locale: Locale;
    /** Who reads conversations sees the mailouts; who carries an audience, its lists. */
    canRead: boolean;
    canAudience: boolean;
    type: MailoutType;
    typeHref: (type: MailoutType) => string;
    /** A link into the Conversaciones view, with these filters (`envio=…&r=respuestas`). */
    conversationsHref: (qs: string) => string;
    onrelation: (relation: Relation, linea?: string) => void;
    online: (linea: string) => void;
  }

  let {
    filters,
    scopeWorkspaceIds,
    workspaces,
    workspaceSlugById,
    locale,
    canRead,
    canAudience,
    type,
    typeHref,
    conversationsHref,
    onrelation,
    online,
  }: Props = $props();

  // Who carries an audience but reads no conversation sees the invitations
  // alone (ADR-173 § 3): they came with the lists before ADR-176.
  let shownType = $derived<MailoutType>(canRead ? type : 'invitaciones');

  // «Ver más» asks for the next page of 20 (`offset`): each request has a
  // fixed number of reads (Workers Free), and the pages already read stay.
  const query = createInfiniteQuery(
    toStore(() => ({
      queryKey: ['mailout-list', filters.projectIds, filters.workspaceIds, scopeWorkspaceIds, shownType] as const,
      enabled: filters.enabled && (canRead || canAudience),
      retry: retryLoad,
      initialPageParam: 0,
      getNextPageParam: (last: MailoutListResponse, all: MailoutListResponse[]) => {
        const read = all.reduce((n, p) => n + p.items.length, 0);
        return read < last.total && last.items.length === MAILOUT_PAGE ? read : undefined;
      },
      queryFn: ({ signal, pageParam }: { signal: AbortSignal; pageParam: number }) => {
        const p = new URLSearchParams({ list: '1', tipo: shownType, offset: String(pageParam) });
        if (filters.projectIds.length > 0) p.set('project_ids', filters.projectIds.join(','));
        if (filters.workspaceIds.length > 0) p.set('workspace_ids', filters.workspaceIds.join(','));
        if (scopeWorkspaceIds.length > 0) p.set('audience_workspace_ids', scopeWorkspaceIds.join(','));
        return fetchJSON<MailoutListResponse>(`/api/mailout?${p}`, signal);
      },
    })),
  );
  let data = $derived(
    $query.data
      ? { items: $query.data.pages.flatMap((p) => p.items), total: $query.data.pages[0]?.total ?? 0 }
      : null,
  );

  // The list names of the invitations: the same read as the panel beside it.
  const audienceQuery = createQuery(toStore(() => audienceListQueryOptions(scopeWorkspaceIds)));
  let listName = $derived(new Map(($audienceQuery.data?.items ?? []).map((a) => [a.id, a.name])));

  const TYPE_WORD: Record<MailoutType, string> = {
    todos: 'envios.type_all',
    difusion: 'envios.type_outreach',
    invitaciones: 'envios.type_invitation',
  };

  function href(m: MailoutRow): string | undefined {
    const ws = workspaceSlugById.get(m.workspace_id);
    return ws ? `/h/${ws}/mailout/${m.id}` : undefined;
  }

  /** A quién: N destinatarios, o la lista y sus profesionales. */
  function who(m: MailoutRow): string {
    const list = m.audience_id ? listName.get(m.audience_id) : null;
    const pros = m.professionals > 0 ? t('envios.professionals', locale, { n: m.professionals }) : null;
    if (m.kind === 'invitation') {
      return [list ? t('envios.list', locale, { list }) : null, pros].filter(Boolean).join(' · ') || t('envios.nobody', locale);
    }
    return t('overview.recipients', locale, { n: m.professionals });
  }
</script>

<div class="envios">
  {#if canRead}
    <SeasonBand {filters} {locale} allHref={conversationsHref('etiqueta=sales&temporada=actual')} {onrelation} {online} />
  {/if}

  <div class="envios__body" class:envios__body--solo={!canAudience}>
    {#if canRead || canAudience}
      <section class="envios__main" aria-labelledby="envios-list" data-testid="mailout-list">
        <h2 class="visually-hidden" id="envios-list">{t('envios.list_title', locale)}</h2>
        {#if canRead}
          <nav class="envios__types" aria-label={t('envios.type_label', locale)}>
            {#each MAILOUT_TYPES as k (k)}
              <a class="envios__type" href={typeHref(k)} aria-current={type === k ? 'page' : undefined} data-type={k}>{t(TYPE_WORD[k], locale)}</a>
            {/each}
          </nav>
        {/if}

        {#if $query.isPending}
          <EmptyLine text={t('envios.loading', locale)} busy />
        {:else if $query.isError}
          <p class="load-fail" role="alert">
            <span>{t('envios.load_error', locale)}</span>
            <Button size="xs" variant="secondary" onclick={() => void $query.refetch()}>{t('ui.retry', locale)}</Button>
          </p>
        {:else if data && data.items.length === 0}
          <EmptyLine text={t(shownType === 'todos' ? 'envios.empty' : 'envios.empty_type', locale)} />
        {:else if data}
          <ul class="envios__rows">
            {#each data.items as m (m.id)}
              {@const f = m.figures}
              <li class="mrow" data-kind={m.kind} data-status={m.status}>
                <span class="mrow__kind eyebrow eyebrow--sub">{t(m.kind === 'invitation' ? 'envios.kind_invitation' : 'envios.kind_outreach', locale)}</span>
                <a class="mrow__subject" href={href(m)}>{m.subject || t('mailout.untitled', locale)}</a>
                <span class="mrow__who">{who(m)}</span>
                <span class="mrow__state">
                  <span>{t(`mailout.s_${m.status}`, locale)}</span>
                  {#if f && f.replies > 0 && canRead}
                    <!-- Who replied, in Conversaciones: a mailout is of Difusión; an invitation's professionals, of any tag. -->
                    <a href={conversationsHref(`${m.kind === 'outreach' ? 'etiqueta=sales&' : ''}envio=${m.id}&r=respuestas`)}
                      >{t(f.replies === 1 ? 'envios.replies_one' : 'envios.replies', locale, { n: f.replies })}</a
                    >
                  {/if}
                  {#if f && f.unsubscribed > 0}
                    <span>{t(f.unsubscribed === 1 ? 'envios.unsub_one' : 'envios.unsub', locale, { n: f.unsubscribed })}</span>
                  {/if}
                  {#if f && f.bounced > 0}
                    <span class="mrow__warn">{t(f.bounced === 1 ? 'envios.bounced_one' : 'envios.bounced', locale, { n: f.bounced })}</span>
                  {/if}
                </span>
                <span class="mrow__when">{m.queued_at ? dayMonth(m.queued_at) : ''}</span>
              </li>
            {/each}
          </ul>
          {#if $query.hasNextPage}
            <div class="envios__more">
              <Button size="s" variant="secondary" loading={$query.isFetchingNextPage} onclick={() => void $query.fetchNextPage()}
                >{t('envios.more', locale, { n: data.total - data.items.length })}</Button
              >
            </div>
          {/if}
        {/if}
      </section>
    {/if}

    {#if canAudience}
      <aside class="envios__aside">
        <AudiencePanel workspaceIds={scopeWorkspaceIds} {workspaces} {locale} />
      </aside>
    {/if}
  </div>
</div>

<style>
  @layer components {
    .envios {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
      container-type: inline-size;
    }
    .envios__body {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
      gap: var(--space-l) var(--space-xl);
      align-items: start;
    }
    .envios__body--solo {
      grid-template-columns: minmax(0, 1fr);
    }
    @container (max-width: 48rem) {
      .envios__body {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .envios__main {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      min-inline-size: 0;
    }
    .envios__types {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2xs);
    }
    .envios__type {
      padding: var(--space-2xs) var(--space-xs);
      border-radius: var(--radius-s);
      color: var(--text-muted);
      font-size: var(--text-s);
      text-decoration: none;
      transition: color var(--transition), background-color var(--transition);
    }
    .envios__type:hover {
      color: var(--text-color);
    }
    .envios__type[aria-current] {
      background: var(--bg-light);
      color: var(--text-color);
    }
    /* Las filas comparten columnas (subgrid): a quién, el estado y la fecha
       caen en la misma vertical en todas. */
    .envios__rows {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(0, 1.2fr) minmax(0, 1.6fr) auto;
      margin: 0;
      padding: 0;
      list-style: none;
      border-block-start: var(--border);
    }
    /* Una fila: el tipo sobre el asunto, a quién, el estado con sus cifras y
       la fecha al final, alineados en columnas a lo ancho. */
    .mrow {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
      grid-template-areas:
        'kind who state when'
        'subject who state when';
      align-items: center;
      gap: 0 var(--space-m);
      padding-block: var(--space-s);
      border-block-end: var(--border);
    }
    .mrow__kind {
      grid-area: kind;
    }
    .mrow__subject {
      grid-area: subject;
      min-inline-size: 0;
      overflow: hidden;
      color: var(--text-color);
      text-decoration: none;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mrow__subject:hover {
      text-decoration: underline;
      text-decoration-color: var(--border-color-dark);
      text-underline-offset: 0.25em;
    }
    .mrow__who,
    .mrow__state {
      font-size: var(--text-s);
      color: var(--text-muted);
    }
    .mrow__who {
      grid-area: who;
    }
    .mrow__state {
      grid-area: state;
    }
    .mrow__state > :not(:last-child)::after {
      content: '·';
      margin-inline: var(--space-2xs);
      color: var(--text-faint);
    }
    .mrow__state a {
      color: inherit;
      text-decoration: underline;
      text-decoration-color: var(--border-color-dark);
      text-underline-offset: 0.25em;
    }
    .mrow__state a:hover {
      color: var(--text-color);
    }
    .mrow__warn {
      color: var(--warning-dark);
    }
    .mrow__when {
      grid-area: when;
      font-size: var(--text-s);
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
      text-align: end;
    }
    /* Estrecho: el tipo y la fecha en una línea, el asunto, y a quién con el estado debajo. */
    @container (max-width: 40rem) {
      .envios__rows {
        grid-template-columns: minmax(0, 1fr) auto;
      }
      .mrow {
        grid-template-areas:
          'kind when'
          'subject subject'
          'who who'
          'state state';
        gap: var(--space-2xs) var(--space-s);
      }
    }
    .envios__more {
      padding-block-start: var(--space-xs);
    }
    .envios__aside {
      min-inline-size: 0;
    }
  }
</style>
