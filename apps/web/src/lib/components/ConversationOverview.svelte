<script lang="ts">
  /**
   * El dashboard de «con quién hablas» (ADR-117, propuesta A): turno y
   * temperatura de la difusión encima de la lista. Una sola petición
   * (`GET /api/conversations/overview`); cada bloque es también un filtro de
   * la lista de debajo (sus enlaces llevan `?turno=`/`?temp=` y bajan a
   * `#lista`) y «Se enfría» es una selección hecha para «Escribir a N».
   *
   * Un bloque sin filas se queda en una línea (el vacío también contesta);
   * «Último envío» y «Del equipo» desaparecen si no hay nada. Sin
   * conversaciones en el alcance no se pinta nada: la lista enseña su vacío.
   */

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { addToast } from '$lib/components/Toast.svelte';
  import Button from '$lib/components/Button.svelte';
  import { dayMonth } from '$lib/datetime';
  import { t, type Locale } from '$lib/i18n';
  import {
    daysAgoLabel,
    eventKindLabel,
    relativeContactDate,
    statusBadgeClass,
    statusLabel,
    CONVERSATION_STATUSES,
    type ConversationEventKind,
    type ConversationStatus,
  } from '$lib/conversation';
  import {
    COLD_IDLE_DAYS,
    COLD_REPLY_DAYS,
    currentSeason,
    type BlockRow,
    type DueRow,
    type OverviewResponse,
  } from '$lib/conversation-overview';
  import { feedHref, feedThreadName, feedTitle, messageWhen } from '$lib/threads';

  interface Props {
    filters: { projectIds: string[]; workspaceIds: string[]; lineIds: string[]; enabled: boolean };
    workspaceSlugById: Map<string, string>;
    /** Names «Escribir a estas» per project when the cooling spans several. */
    projectNameById: Map<string, string>;
    locale: Locale;
    /** Pulsar un tramo de la temporada: filtra la lista por ese estado en la temporada. */
    onstatus: (status: ConversationStatus) => void;
    /** «Escribir a estas»: precarga el modo selección del envío en bloque (ADR-115). */
    /** Absent for whoever cannot edit conversations: no «write to these». */
    onwrite?: (picks: { id: string; project_id: string }[]) => void;
  }

  let { filters, workspaceSlugById, projectNameById, locale, onstatus, onwrite }: Props = $props();

  type Pick = { id: string; project_id: string };
  function picksByProject(picks: Pick[]): { projectId: string; picks: Pick[] }[] {
    const by = new Map<string, Pick[]>();
    for (const p of picks) by.set(p.project_id, [...(by.get(p.project_id) ?? []), p]);
    return [...by.entries()].map(([projectId, list]) => ({ projectId, picks: list })).sort((a, b) => b.picks.length - a.picks.length);
  }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function params(f: Props['filters']): string {
    const p = new URLSearchParams();
    if (f.projectIds.length > 0) p.set('project_ids', f.projectIds.join(','));
    if (f.workspaceIds.length > 0) p.set('workspace_ids', f.workspaceIds.join(','));
    if (f.lineIds.length > 0) p.set('line_ids', f.lineIds.join(','));
    return p.toString();
  }

  const query = createQuery(
    toStore(() => ({
      queryKey: ['conversation-overview', filters.projectIds, filters.workspaceIds, filters.lineIds] as const,
      enabled: filters.enabled,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<OverviewResponse>(`/api/conversations/overview?${params(filters)}`, signal),
      placeholderData: (prev: OverviewResponse | undefined) => prev,
    })),
  );

  let data = $derived($query.data ?? null);
  let pickGroups = $derived(data ? new Set(data.cold.picks.map((p) => p.project_id)).size : 0);
  let loading = $derived($query.isLoading || !filters.enabled);
  let seasonStatuses = $derived(
    data ? CONVERSATION_STATUSES.filter((s) => data.season.counts[s] > 0) : [],
  );

  // «No pide respuesta» (ADR-126 § 1): settles that reply, not «now».
  const queryClient = useQueryClient();
  const settle = createMutation({
    mutationFn: (row: DueRow) =>
      mutateJSON('PATCH', `/api/conversations/${row.id}`, { reply_settled_at: row.at }),
    onError: (err) =>
      addToast({
        tone: 'danger',
        title: t('conversations.change_not_saved', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversation-overview'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['conversation'] });
    },
  });

  function href(row: BlockRow): string | undefined {
    const ws = workspaceSlugById.get(row.workspace_id);
    return ws ? `/h/${ws}/conversation/${row.id}` : undefined;
  }

  function kindLabel(kind: string | null): string {
    return kind ? eventKindLabel(kind as ConversationEventKind, locale) : '';
  }

  function seasonAria(d: OverviewResponse): string {
    return seasonStatuses.map((s) => `${d.season.counts[s]} ${statusLabel(s, locale)}`).join(', ');
  }
</script>

{#snippet who(row: BlockRow, badge = false)}
  <span class="row__who">
    <span class="row__org">{row.title || t('conversations.conversation', locale)}</span>
    {#if badge}
      <span class={statusBadgeClass(row.status)}>{statusLabel(row.status, locale)}</span>
    {:else if row.person}
      <span class="row__person">{row.person}</span>
    {/if}
  </span>
{/snippet}

<!-- Loading: the same rows as the real ones (two lines and the time column,
     `&nbsp;` so each bar is exactly a line high) and the typical blocks, so
     the list below does not jump when the overview arrives (diseño A3). -->
{#snippet fig(n: number, key: string, link: string | null, warn = false)}
  {#if link}
    <a class="fig" class:is-warn={warn} href={link}><b>{n}</b>{t(key, locale)}</a>
  {:else}
    <span class:is-warn={warn}><b>{n}</b>{t(key, locale)}</span>
  {/if}
{/snippet}

{#snippet ghost(n: number)}
  <ol class="rows" aria-hidden="true">
    {#each Array(n) as _, i (i)}
      <li>
        <div class="row row--ghost">
          <span class="row__who"><span class="g" style:inline-size="{55 - (i % 3) * 8}%">&nbsp;</span></span>
          <span class="row__what"><span class="g" style:inline-size="{40 + (i % 2) * 10}%">&nbsp;</span></span>
          <span class="row__when"><strong><span class="g">&nbsp;</span></strong><span class="g">&nbsp;</span></span>
        </div>
      </li>
    {/each}
  </ol>
{/snippet}

<div class="overview">
{#if loading}
  <div class="board" aria-busy="true" aria-label={t('overview.loading', locale)}>
    <div class="board__col">
      <section class="block block--due"><div class="block-head"><h2 class="eyebrow eyebrow--sub">{t('overview.due', locale)}</h2></div>{@render ghost(5)}</section>
      <section class="block block--hot"><div class="block-head"><h2 class="eyebrow eyebrow--sub">{t('overview.hot', locale)}</h2></div>{@render ghost(5)}</section>
    </div>
    <div class="board__col">
      <section class="block block--season">
        <div class="block-head"><h2 class="eyebrow eyebrow--sub">{t('overview.season_of', locale, { season: currentSeason(new Date()).label })}</h2></div>
        <div class="season__bar season__bar--ghost"></div>
        <div class="season__legend" aria-hidden="true">
          {#each Array(6) as _, i (i)}
            <span class="season__item"><span class="season__n"><span class="g">&nbsp;</span></span><span class="season__k"><span class="g">&nbsp;</span></span></span>
          {/each}
        </div>
        <p class="season__note" aria-hidden="true"><span class="g" style:inline-size="60%">&nbsp;</span></p>
      </section>
      <section class="block block--cold">
        <div class="block-head"><h2 class="eyebrow eyebrow--sub">{t('overview.cold', locale)}</h2></div>
        {@render ghost(5)}
      </section>
      <section class="block block--mailout" aria-hidden="true">
        <div class="block-head"><h2 class="eyebrow eyebrow--sub">{t('overview.last_mailout', locale)}</h2></div>
        <p class="mailout__subject"><span class="g" style:inline-size="50%">&nbsp;</span></p>
        <p class="mailout__meta"><span class="g" style:inline-size="70%">&nbsp;</span></p>
        <p class="mailout__figs"><span><b><span class="g">&nbsp;</span></b></span></p>
      </section>
    </div>
  </div>
{:else if $query.isError}
  <p class="load-fail" role="alert">
    <span>{t('overview.error', locale)}</span>
    <Button size="xs" variant="outline" onclick={() => void $query.refetch()}>{t('ui.retry', locale)}</Button>
  </p>
{:else if data && data.total > 0}
  <div class="board" data-testid="conversation-overview">
    <div class="board__col">
      <section class="block block--due" aria-labelledby="ov-due" data-testid="block-due">
        <div class="block-head">
          <h2 class="eyebrow eyebrow--sub" id="ov-due">{t('overview.due', locale)}&nbsp;· {data.due.count}</h2>
          {#if data.due.count > 0}<a class="block__more" href="?turno=nuestro#lista">{t('overview.see_in_list', locale)}</a>{/if}
        </div>
        {#if data.due.count === 0}
          <p class="block__empty">{t('overview.due_empty', locale)}</p>
        {:else}
          <ol class="rows">
            {#each data.due.rows as row, i (row.id)}
              {@const firstFollowUp = data.due.rows.findIndex((r) => r.reason === 'follow_up')}
              {#if i === firstFollowUp}
                <li class="rows__sep">{t('overview.follow_ups', locale)}</li>
              {/if}
              <!-- On a phone the block keeps three: two replies and a follow-up when there are both. -->
              <li
                class="rows__item"
                class:rows__more={firstFollowUp === -1 || firstFollowUp === 0
                  ? i >= 3
                  : i < firstFollowUp
                    ? i >= Math.min(2, firstFollowUp)
                    : i > firstFollowUp}
              >
                <a class="row" class:row--late={row.days >= 7} href={href(row)}>
                  {@render who(row)}
                  {#if row.reason === 'reply'}
                    <span class="row__what"><b>{row.subject || kindLabel(row.kind)}</b></span>
                    <span class="row__when"><strong>{relativeContactDate(row.at, locale)}</strong>{kindLabel(row.kind)}</span>
                  {:else}
                    <span class="row__what">{row.note || t('overview.follow_up', locale)}</span>
                    <span class="row__when"><strong>{dayMonth(row.at)}</strong>{t('overview.follow_up', locale)}</span>
                  {/if}
                </a>
                {#if row.reason === 'reply' && onwrite}
                  <button
                    type="button"
                    class="row__settle"
                    aria-label={t('overview.settle_aria', locale, { name: row.title })}
                    disabled={$settle.isPending}
                    onclick={() => $settle.mutate(row)}>{t('overview.settle', locale)}</button
                  >
                {/if}
              </li>
            {/each}
          </ol>
        {/if}
      </section>

      <section class="block block--hot" aria-labelledby="ov-hot" data-testid="block-hot">
        <div class="block-head">
          <h2 class="eyebrow eyebrow--sub" id="ov-hot">{t('overview.hot', locale)}&nbsp;· {data.hot.count}</h2>
          {#if data.hot.count > 0}<a class="block__more" href="?temp=caliente#lista">{t('overview.see_n', locale, { n: data.hot.count })}</a>{/if}
        </div>
        {#if data.hot.count === 0}
          <p class="block__empty">{t('overview.hot_empty', locale)}</p>
        {:else}
          <ol class="rows">
            {#each data.hot.rows as row (row.id)}
              <li>
                <a class="row" href={href(row)}>
                  {@render who(row, true)}
                  <span class="row__what">{row.person ?? ''}</span>
                  <span class="row__when"
                    ><strong>{relativeContactDate(row.at, locale)}</strong>{row.turn === 'ours'
                      ? t('overview.turn_ours', locale)
                      : row.turn === 'theirs'
                        ? t('overview.turn_theirs', locale)
                        : ''}</span
                  >
                </a>
              </li>
            {/each}
          </ol>
        {/if}
      </section>
    </div>

    <div class="board__col">
      <section class="block block--season" aria-labelledby="ov-season" data-testid="block-season">
        <div class="block-head">
          <h2 class="eyebrow eyebrow--sub" id="ov-season">{t('overview.season_of', locale, { season: data.season.label })}&nbsp;· {data.season.total}</h2>
          <span class="block__hint">{t('overview.season_hint', locale)}</span>
        </div>
        {#if data.season.total === 0}
          <p class="block__empty">{t('overview.season_empty', locale)}</p>
        {:else}
          <div class="season__bar" role="group" aria-label={seasonAria(data)}>
            {#each seasonStatuses as s (s)}
              <button
                type="button"
                class="season__seg"
                data-status={s}
                style:flex-grow={data.season.counts[s]}
                title={`${statusLabel(s, locale)} · ${data.season.counts[s]}`}
                aria-label={`${statusLabel(s, locale)} · ${data.season.counts[s]}`}
                onclick={() => onstatus(s)}
              ></button>
            {/each}
          </div>
          <div class="season__legend">
            {#each seasonStatuses as s (s)}
              <button type="button" class="season__item" onclick={() => onstatus(s)}>
                <span class="season__n">{data.season.counts[s]}</span>
                <span class="season__k"><i data-status={s}></i>{statusLabel(s, locale)}</span>
              </button>
            {/each}
          </div>
          <p class="season__note">
            {t('overview.season_note', locale, { answered: data.season.answered, silent: data.season.total - data.season.answered })}
          </p>
        {/if}
      </section>

      <section class="block block--cold" aria-labelledby="ov-cold" data-testid="block-cold">
        <div class="block-head">
          <h2 class="eyebrow eyebrow--sub" id="ov-cold">{t('overview.cold', locale)}&nbsp;· {data.cold.count}</h2>
          {#if data.cold.count > 0}<a class="block__more" href="?temp=fria#lista">{t('overview.see_n', locale, { n: data.cold.count })}</a>{/if}
        </div>
        {#if data.cold.count === 0}
          <p class="block__empty">{t('overview.cold_empty', locale)}</p>
        {:else}
          <ol class="rows">
            {#each data.cold.rows as row, i (row.id)}
              {#if i === 0 || data.cold.rows[i - 1].group !== row.group}
                <li class="rows__sep">
                  {#if row.group === 'stalled'}
                    <a href="?temp=parada#lista">{t('overview.cold_stalled', locale, { n: data.cold.stalled })}</a>
                  {:else}
                    <a href="?temp=ronda#lista">{t('overview.cold_round', locale, { n: data.cold.round })}</a>
                  {/if}
                </li>
              {/if}
              <li>
                <a class="row" href={href(row)}>
                  {@render who(row)}
                  <span class="row__what"
                    >{row.reason === 'no_history'
                      ? t('overview.cold_no_history', locale)
                      : row.reason === 'no_reply'
                        ? row.subject
                          ? t('overview.cold_last_mail', locale, { subject: row.subject })
                          : t('overview.cold_no_reply', locale)
                        : t('overview.cold_idle', locale, { status: statusLabel(row.status, locale) })}</span
                  >
                  <span class="row__when"
                    ><strong>{row.days === null ? t('overview.no_date', locale) : daysAgoLabel(row.days, locale)}</strong
                    >{row.group === 'stalled' && row.reason !== 'no_reply' ? t('overview.idle', locale) : t('overview.no_reply', locale)}</span
                  >
                </a>
              </li>
            {/each}
          </ol>
          <div class="block__foot">
            <span class="block__hint">{t('overview.cold_rule', locale, { reply: COLD_REPLY_DAYS, idle: COLD_IDLE_DAYS })}</span>
            {#if onwrite && data.cold.picks.length > 0}
              <!-- A mailout is of one project (ADR-118 § 8): one button per project, never a blocked bar. -->
              <span class="block__acts">
                {#each picksByProject(data.cold.picks) as g (g.projectId)}
                  <Button size="s" onclick={() => onwrite(g.picks)}
                    >{pickGroups > 1
                      ? t('overview.write_these_project', locale, { project: projectNameById.get(g.projectId) ?? '', n: g.picks.length })
                      : t('overview.write_these', locale, { n: g.picks.length })}</Button
                  >
                {/each}
              </span>
            {/if}
          </div>
        {/if}
      </section>

      {#if data.last_mailout}
        {@const m = data.last_mailout}
        {@const ws = workspaceSlugById.get(m.workspace_id)}
        <section class="block block--mailout" aria-labelledby="ov-mail" data-testid="block-mailout">
          <div class="block-head">
            <h2 class="eyebrow eyebrow--sub" id="ov-mail">{t('overview.last_mailout', locale)}</h2>
            {#if ws}<a class="block__more" href={`/h/${ws}/mailout/${m.id}`}>{t('overview.open_mailout', locale)}</a>{/if}
          </div>
          <p class="mailout__subject">{m.subject || t('overview.no_subject', locale)}</p>
          <p class="mailout__meta">
            {[m.queued_at ? dayMonth(m.queued_at) : null, t('overview.recipients', locale, { n: m.figures.recipients }), m.from_address]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p class="mailout__figs">
            <span><b>{m.figures.delivered}</b>{t('overview.delivered', locale)}</span>
            <!-- The figures that name someone lead to them (uso #10). -->
            {@render fig(m.figures.replies, 'overview.replies', m.figures.replies > 0 ? `?envio=${m.id}&r=respuestas#lista` : null)}
            {@render fig(m.figures.bounced, 'overview.bounced', m.figures.bounced > 0 ? `?envio=${m.id}&r=rebotes#lista` : null, m.figures.bounced > 0)}
            <span><b>{m.figures.unsubscribed}</b>{t('overview.unsubscribed', locale)}</span>
            {#if m.figures.complained > 0}
              <span class="is-warn"><b>{m.figures.complained}</b>{t('overview.complained', locale)}</span>
            {/if}
          </p>
        </section>
      {/if}

      {#if data.team.count > 0}
        <section class="block block--team" aria-labelledby="ov-team" data-testid="block-team">
          <div class="block-head">
            <h2 class="eyebrow eyebrow--sub" id="ov-team">{t('overview.team', locale)}&nbsp;· {t('overview.team_new', locale, { n: data.team.count })}</h2>
            <a class="block__more" href="/h/conversations?view=threads">{t('conversations.view_what', locale)}</a>
          </div>
          <ol class="rows">
            {#each data.team.threads as th (th.thread_id)}
              {@const link = feedHref(th, workspaceSlugById.get(th.workspace_id))}
              {@const author = th.last_message.author_id ? data.team.authors[th.last_message.author_id] : null}
              <li>
                <svelte:element this={link ? 'a' : 'div'} href={link} class="row">
                  <span class="row__who">
                    <span class="row__org"><span class="dot" aria-hidden="true"></span>{feedTitle(th)}</span>
                    <span class="row__person">{feedThreadName(th, locale)}</span>
                  </span>
                  <span class="row__what">{author ? `${author}: ` : ''}{th.last_message.body}</span>
                  <span class="row__when"><strong>{messageWhen(th.last_message_at, locale, tz)}</strong></span>
                </svelte:element>
              </li>
            {/each}
          </ol>
        </section>
      {/if}
    </div>
  </div>
{/if}
</div>

<style>
  @layer components {
    .overview {
      container-type: inline-size;
    }
    .board {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
      gap: var(--space-l) var(--space-xl);
    }
    .board__col {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
      min-inline-size: 0;
    }
    .block__empty {
      font-size: var(--text-s);
      color: var(--text-faint);
    }

    .block {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      min-inline-size: 0;
    }
    .block__more {
      font-size: var(--text-s);
      color: var(--text-muted);
      text-decoration: none;
      white-space: nowrap;
    }
    .block__more:hover {
      color: var(--text-color);
    }
    .block__hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }
    .block__acts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
    }
    .rows__sep a {
      color: inherit;
      text-decoration: none;
    }
    .rows__sep a:hover {
      color: var(--text-color);
    }
    .block__foot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-s);
      flex-wrap: wrap;
      padding-block-start: var(--space-2xs);
    }

    .rows {
      display: flex;
      flex-direction: column;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-2xs) var(--space-s);
      align-items: baseline;
      padding-block: var(--space-xs);
      border-block-end: 1px solid var(--border-color-light);
      text-decoration: none;
      color: inherit;
      transition: background-color var(--transition);
    }
    a.row:hover {
      background: var(--bg-ultra-light);
    }
    .row__who {
      display: flex;
      gap: var(--space-xs);
      align-items: baseline;
      min-inline-size: 0;
    }
    /* «No pide respuesta» sits beside the link (never inside it: a button in
       a link is two controls in one), quiet until the row is under the
       pointer or the keyboard; always there on a touch screen. */
    .rows__item {
      position: relative;
    }
    .row__settle {
      position: absolute;
      inset-block-end: var(--space-xs);
      inset-inline-end: 0;
      padding: 0 var(--space-2xs);
      border: 0;
      /* The row's hover ground: on hover it covers the kind label below the date. */
      background: var(--bg-ultra-light);
      color: var(--text-muted);
      font-size: var(--text-xs);
      text-decoration: underline;
      text-underline-offset: 0.2em;
      cursor: pointer;
      opacity: 0;
      transition: opacity var(--transition);
    }
    .rows__item:hover .row__settle,
    .row__settle:focus-visible {
      opacity: 1;
    }
    .row__settle:hover {
      color: var(--text-color);
    }
    @media (pointer: coarse) {
      .row__settle {
        position: static;
        opacity: 1;
        min-block-size: var(--touch-target);
      }
    }
    .row__org {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .row__person,
    .row__what {
      color: var(--text-muted);
      font-size: var(--text-s);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .row__what {
      grid-column: 1;
    }
    .row__what b {
      font-weight: 500;
      color: var(--text-color);
    }
    .row__when {
      grid-column: 2;
      grid-row: 1 / span 2;
      align-self: center;
      text-align: end;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
      white-space: nowrap;
    }
    .row__when strong {
      display: block;
      font-family: var(--font-sans);
      font-size: var(--text-s);
      font-weight: 500;
      color: var(--text-color);
    }
    .row--late .row__when strong {
      color: var(--warning-ultra-dark);
    }
    .rows__sep {
      padding-block: var(--space-xs) 0;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
    }
    /* Carga: filas de la altura real, para que nada salte al llegar. */
    .g {
      display: inline-block;
      inline-size: 3.5rem;
      border-radius: var(--radius-s);
      background: var(--bg-light);
      line-height: inherit;
    }
    .row__when .g {
      inline-size: 3.5rem;
    }

    /* La temporada: una barra apilada con los tonos de los badges de estado
       (`.badge--*` en base.css: la misma familia de color por estado). */
    [data-status='contacted'] { --seg: color-mix(in oklch, var(--info) 55%, transparent); }
    [data-status='in_conversation'] { --seg: color-mix(in oklch, var(--warning) 65%, transparent); }
    [data-status='hold'] { --seg: color-mix(in oklch, var(--neutral) 45%, transparent); }
    [data-status='confirmed'] { --seg: var(--success); }
    [data-status='declined'] { --seg: color-mix(in oklch, var(--danger) 45%, transparent); }
    [data-status='dormant'] { --seg: color-mix(in oklch, var(--neutral) 20%, transparent); }
    [data-status='recurring'] { --seg: color-mix(in oklch, var(--primary) 55%, transparent); }

    .season__bar {
      display: flex;
      gap: 2px;
      block-size: 0.9rem;
      border-radius: var(--radius-s);
      overflow: hidden;
    }
    .season__bar--ghost {
      background: var(--bg-light);
    }
    .season__seg {
      flex-basis: 0;
      min-inline-size: 3px;
      padding: 0;
      border: 0;
      background: var(--seg);
      cursor: pointer;
    }
    .season__seg:hover,
    .season__seg:focus-visible {
      filter: brightness(0.92);
    }
    .season__legend {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--space-xs) var(--space-m);
      margin-block-start: var(--space-s);
    }
    .season__item {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      text-align: start;
      cursor: pointer;
    }
    .season__n {
      font-family: var(--font-display);
      font-size: var(--text-xl);
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }
    .season__k {
      display: flex;
      align-items: center;
      gap: var(--space-2xs);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .season__k i {
      display: inline-block;
      inline-size: 0.6rem;
      block-size: 0.6rem;
      border-radius: 2px;
      background: var(--seg);
    }
    .season__item:hover .season__k {
      color: var(--text-color);
    }
    .season__note {
      margin-block-start: var(--space-xs);
      font-size: var(--text-s);
      color: var(--text-muted);
    }

    .mailout__subject {
      font-weight: 500;
    }
    .mailout__meta {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .mailout__figs {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2xs) var(--space-m);
      margin-block-start: var(--space-2xs);
      font-size: var(--text-s);
    }
    .mailout__figs b {
      margin-inline-end: 0.2em;
      font-family: var(--font-display);
      font-size: var(--text-l);
      font-weight: 400;
      font-variant-numeric: tabular-nums;
    }
    .mailout__figs .fig {
      color: inherit;
      text-decoration: underline;
      text-decoration-color: var(--border-color-dark);
      text-underline-offset: 0.25em;
    }
    .mailout__figs .fig:hover {
      text-decoration-color: currentColor;
    }
    .mailout__figs .is-warn b {
      color: var(--warning-ultra-dark);
    }

    .dot {
      display: inline-block;
      inline-size: 0.45rem;
      block-size: 0.45rem;
      margin-inline-end: var(--space-2xs);
      border-radius: 50%;
      background: var(--info);
      transform: translateY(-0.1em);
    }

    /* Móvil: una columna en el orden de las preguntas (te toca, temporada,
       caliente, se enfría…), tres filas por bloque y el botón a lo ancho. */
    @container (max-width: 44rem) {
      .board__col {
        display: contents;
      }
      .board {
        grid-template-columns: minmax(0, 1fr);
      }
      .block--due {
        order: -2;
      }
      .block--season {
        order: -1;
      }
      .block:not(.block--due) .rows > li:nth-child(n + 4),
      .rows__more {
        display: none;
      }
      .block__foot :global(button) {
        inline-size: 100%;
      }
    }
  }
</style>
