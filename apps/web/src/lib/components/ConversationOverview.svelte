<script lang="ts">
  /**
   * El dashboard de «con quién hablas» (ADR-117, propuesta A): turno y
   * temperatura de la difusión encima de la lista. Una sola petición
   * (`GET /api/conversations/overview`); cada bloque es también un filtro de
   * la lista de debajo (sus enlaces llevan `?turno=`/`?temp=` y bajan a
   * `#lista`) y «Se enfría» es una selección hecha para «Escribir a N».
   *
   * Un bloque sin filas se queda en una línea (el vacío también contesta).
   * Sin conversaciones en el alcance no se pinta nada: la lista enseña su
   * vacío. La temporada y el último envío se mudaron a la vista Envíos
   * (ADR-176, SeasonBand y MailoutsView).
   */

  import StateBadge from '$lib/components/StateBadge.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { refreshAfterWrite } from '$lib/query-refresh';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { addToast } from '$lib/components/Toast.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import { useCalm } from '$lib/stores/calm.svelte';
  import FirstTimeNote from '$lib/components/FirstTimeNote.svelte';
  import Button from '$lib/components/Button.svelte';
  import { dayMonth } from '$lib/datetime';
  import { LATE_DAYS } from '$lib/conversation-row';
  import { DASH } from '$lib/glyphs';
  import { t, type Locale } from '$lib/i18n';
  import {
    daysAgoLabel,
    eventKindLabel,
    relativeContactDate,
    type ConversationEventKind,
  } from '$lib/conversation';
  import { relationLabel, relationTone } from '$lib/conversation-relation';
  import {
    COLD_IDLE_DAYS,
    COLD_REPLY_DAYS,
    type BlockRow,
    type ColdRow,
    type DueRow,
    type OverviewResponse,
  } from '$lib/conversation-overview';
  import { ALL, panelHref, type LensChip } from '$lib/conversation-tags';

  interface Props {
    filters: { projectIds: string[]; workspaceIds: string[]; lineIds: string[]; enabled: boolean };
    workspaceSlugById: Map<string, string>;
    /** Names «Escribir a estas» per project when the cooling spans several. */
    projectNameById: Map<string, string>;
    locale: Locale;
    /** «Escribir a estas»: precarga el modo selección del envío en bloque (ADR-115). */
    /** Absent for whoever cannot edit conversations: no «write to these». */
    onwrite?: (picks: { id: string; project_id: string }[]) => void;
    /**
     * ADR-138 fase 2, el dominio es el chip: la etiqueta que acota (`all`,
     * ninguna) y qué panel se pinta. `sales` es el de Difusión entero;
     * `common`, solo te toca (sin temperatura).
     */
    chip?: LensChip;
    panel?: 'sales' | 'common';
  }

  let {
    filters,
    workspaceSlugById,
    projectNameById,
    locale,
    onwrite,
    chip = ALL,
    panel = 'sales',
  }: Props = $props();

  let full = $derived(panel === 'sales');
  // The list is not in calm: its door leaves calm first, as Cuentas' do.
  const calm = useCalm();
  /** A block's link is its filter, with the chip: block and list count the same (ADR-118 § 7). */
  function link(qs: string): string {
    return panelHref(chip, qs);
  }

  type Pick = { id: string; project_id: string };
  function picksByProject(picks: Pick[]): { projectId: string; picks: Pick[] }[] {
    const by = new Map<string, Pick[]>();
    for (const p of picks) by.set(p.project_id, [...(by.get(p.project_id) ?? []), p]);
    return [...by.entries()].map(([projectId, list]) => ({ projectId, picks: list })).sort((a, b) => b.picks.length - a.picks.length);
  }


  function params(f: Props['filters']): string {
    const p = new URLSearchParams();
    if (f.projectIds.length > 0) p.set('project_ids', f.projectIds.join(','));
    if (f.workspaceIds.length > 0) p.set('workspace_ids', f.workspaceIds.join(','));
    if (f.lineIds.length > 0) p.set('line_ids', f.lineIds.join(','));
    if (chip !== ALL) p.set('etiqueta', chip);
    return p.toString();
  }

  const query = createQuery(
    toStore(() => ({
      queryKey: ['conversation-overview', filters.projectIds, filters.workspaceIds, filters.lineIds, chip, panel] as const,
      enabled: filters.enabled,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<OverviewResponse>(`/api/conversations/overview?${params(filters)}`, signal),
      placeholderData: (prev: OverviewResponse | undefined) => prev,
    })),
  );


  let data = $derived($query.data ?? null);
  let pickGroups = $derived(data ? new Set(data.cold.picks.map((p) => p.project_id)).size : 0);
  let loading = $derived($query.isLoading || !filters.enabled);

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
      void refreshAfterWrite(queryClient, ['conversations']);
      void queryClient.invalidateQueries({ queryKey: ['conversation'] });
    },
  });

  function href(row: BlockRow): string | undefined {
    const ws = workspaceSlugById.get(row.workspace_id);
    return ws ? `/h/${ws}/conversation/${row.id}` : undefined;
  }

  // Short names for the row links (móvil #12): who first, then what and when,
  // with pauses; never the kind twice nor the status glued to the name.
  function name(row: BlockRow): string {
    return row.title || t('conversations.conversation', locale);
  }
  function dueAria(row: DueRow): string {
    if (row.reason === 'reply' && row.kind === 'call') {
      return t('overview.aria_call', locale, { name: name(row), when: relativeContactDate(row.at, locale) });
    }
    return row.reason === 'reply'
      ? t('overview.aria_reply', locale, { name: name(row), when: relativeContactDate(row.at, locale), what: row.subject || kindLabel(row.kind) })
      : t('overview.aria_follow_up', locale, { name: name(row), when: dayMonth(row.at), what: row.note ?? '' });
  }
  /** «parada» for a stalled one that is not waiting on our email; «sin respuesta» otherwise. */
  function coldWord(row: ColdRow): string {
    return row.reason === 'idle' ? t('overview.idle', locale) : t('overview.no_reply', locale);
  }
  function coldAria(row: ColdRow): string {
    return [name(row), daysAgoLabel(row.days, locale), coldWord(row)].join(', ');
  }

  function kindLabel(kind: string | null): string {
    return kind ? eventKindLabel(kind as ConversationEventKind, locale) : '';
  }



</script>

{#snippet who(row: BlockRow, badge = false)}
  <span class="row__who">
    <span class="row__org">{row.title || t('conversations.conversation', locale)}</span>
    {#if badge}
      <StateBadge label={relationLabel(row.relation, locale)} tone={relationTone(row.relation)} />
    {:else if row.person}
      <span class="row__person">{row.person}</span>
    {/if}
  </span>
{/snippet}

<!-- Loading: the same rows as the real ones (two lines and the time column,
     `&nbsp;` so each bar is exactly a line high) and the typical blocks, so
     the list below does not jump when the overview arrives (diseño A3). -->
{#snippet ghost(n: number)}
  <ol class="rows" aria-hidden="true">
    {#each Array(n) as _, i (i)}
      <li>
        <div class="row row--ghost">
          <span class="row__who"><span class="ghost-line" style:inline-size="{55 - (i % 3) * 8}%">&nbsp;</span></span>
          <span class="row__what"><span class="ghost-line" style:inline-size="{40 + (i % 2) * 10}%">&nbsp;</span></span>
          <span class="row__when"><strong><span class="ghost-line">&nbsp;</span></strong><span class="ghost-line">&nbsp;</span></span>
        </div>
      </li>
    {/each}
  </ol>
{/snippet}

<div class="overview">
{#if loading}
  <div class="board" aria-busy="true" aria-label={t('overview.loading', locale)}>
    <div class="board__col">
      <section class="block block--due"><BlockHead title={t('overview.due', locale)} count={DASH} />{@render ghost(5)}</section>
    </div>
    {#if full}
    <div class="board__col">
      <section class="block block--cold">
        <BlockHead title={t('overview.cold', locale)} count={DASH} />
        {@render ghost(5)}
      </section>
    </div>
    {/if}
  </div>
{:else if $query.isError}
  <p class="load-fail" role="alert">
    <span>{t('overview.error', locale)}</span>
    <Button size="xs" variant="secondary" onclick={() => void $query.refetch()}>{t('ui.retry', locale)}</Button>
  </p>
{:else if data && data.total > 0}
  <div class="board" data-testid="conversation-overview">
    <div class="board__col">
      {#if data.due.count > 0}
      <section class="block block--due" aria-labelledby="ov-due" data-testid="block-due" data-help-step="conv-due">
        <BlockHead id="ov-due" title={t('overview.due', locale)} count={data.due.count}>
          {#if data.due.count > 0}<a class="block-head__act" href={link('turno=nuestro#lista')} onclick={() => calm.set(false)}>{t('overview.see_in_list', locale)}</a>{/if}
        </BlockHead>
        <FirstTimeNote event="first_reply_waiting" when={data.due.count > 0} />
          <ol class="rows">
            {#each data.due.rows as row, i (row.id)}
              {@const firstFollowUp = data.due.rows.findIndex((r) => r.reason === 'follow_up')}
              {#if i === firstFollowUp}
                <li class="rows__sep eyebrow eyebrow--sub">{t('overview.follow_ups', locale)}</li>
              {/if}
              <!-- On a phone the block keeps its first row (the CSS below). -->
              <li class="rows__item">
                <a class="row" class:row--late={row.days >= LATE_DAYS} href={href(row)} aria-label={dueAria(row)}>
                  {@render who(row)}
                  {#if row.reason === 'reply'}
                    <span class="row__what"><b>{row.subject || kindLabel(row.kind)}</b></span>
                    <!-- The kind goes under the date only when the subject took the line: never twice (diseño B7). -->
                    <span class="row__when"><strong>{relativeContactDate(row.at, locale)}</strong>{row.subject ? kindLabel(row.kind) : ''}</span>
                  {:else}
                    <span class="row__what">{row.note || t('overview.follow_up', locale)}</span>
                    <span class="row__when"><strong>{dayMonth(row.at)}</strong>{row.note ? t('overview.follow_up', locale) : ''}</span>
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
      </section>
      {/if}
    </div>

    {#if full}
    <div class="board__col">
      {#if data.cold.count > 0}
      <section class="block block--cold" aria-labelledby="ov-cold" data-testid="block-cold">
        <BlockHead id="ov-cold" title={t('overview.cold', locale)} count={data.cold.count}>
          {#if data.cold.count > 0}<a class="block-head__act" href={link('temp=fria#lista')}>{t('overview.see_n', locale, { n: data.cold.count })}</a>{/if}
        </BlockHead>
          <ol class="rows">
            {#each data.cold.rows as row, i (row.id)}
              {#if i === 0 || data.cold.rows[i - 1].group !== row.group}
                <li class="rows__sep eyebrow eyebrow--sub">
                  {#if row.group === 'stalled'}
                    <a href={link('temp=parada#lista')}>{t('overview.cold_stalled', locale, { n: data.cold.stalled })}</a>
                  {:else}
                    <a href={link('temp=ronda#lista')}>{t('overview.cold_round', locale, { n: data.cold.round })}</a>
                  {/if}
                </li>
              {/if}
              <li>
                <a class="row" href={href(row)} aria-label={coldAria(row)}>
                  {@render who(row)}
                  <span class="row__what"
                    >{row.reason === 'no_reply'
                      ? row.subject
                        ? t('overview.cold_last_mail', locale, { subject: row.subject })
                        : t('overview.cold_no_reply', locale)
                      : t('overview.cold_idle', locale, { status: relationLabel(row.relation, locale) })}</span
                  >
                  <span class="row__when"
                    ><strong>{daysAgoLabel(row.days, locale)}</strong
                    >{coldWord(row)}</span
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
      </section>
      {/if}


    </div>
    {/if}
    {#if full && data.undated > 0}
      <!-- No date at all: not cold, not due (we do not know). Counted apart, a quiet line with its filter. -->
      <p class="board__undated" data-testid="overview-undated">
        <a href={link('temp=sin-fecha#lista')}>{t('overview.undated', locale, { n: data.undated })}</a>
      </p>
    {/if}
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
    /* A column whose blocks are all at zero is not drawn (ADR-145 § 1), and
       the other one takes the width. */
    .board__col:not(:has(> *)) {
      display: none;
    }
    .board:has(> .board__col:not(:has(> *))) {
      grid-template-columns: minmax(0, 1fr);
    }
    .board__undated {
      grid-column: 1 / -1;
      margin: 0;
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .board__undated a {
      color: inherit;
      text-decoration: underline;
      text-decoration-color: var(--border-color-dark);
      text-underline-offset: 0.25em;
    }
    .board__undated a:hover {
      color: var(--text-color);
    }
    .block {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      min-inline-size: 0;
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
      border-block-end: var(--line-hairline) solid var(--border-color-light);
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
    /* Touch: always there, in the row's corner over the kind label. 24 px
       (WCAG 2.5.8): the full 44 would cover the date above it. */
    @media (pointer: coarse) {
      .row__settle {
        inset-block-end: var(--space-2xs);
        min-block-size: 1.5rem;
        background: var(--bg);
        opacity: 1;
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
    /* «Tarde» (a week waiting): the warning ink, not -ultra-dark, which next
       to the body ink read as the same near-black in light (diseño M4). The
       same step the mailout figures use for a bounce. */
    .row--late .row__when strong {
      color: var(--warning-dark);
    }
    /* The voice is the shared sub-eyebrow (diseño B5); only its place here. */
    .rows__sep {
      display: block;
      padding-block: var(--space-xs) 0;
    }
    /* Carga: filas de la altura real, para que nada salte al llegar. */
    .row__when .ghost-line {
      inline-size: 3.5rem;
    }

    /* Móvil: una columna en el orden del documento, que es el que lee el
       teclado y el lector de pantalla: primero lo que pide acción (te
       toca), después lo que se enfría. Sin `order`: lo que se ve y lo que se recorre no se separan
       (móvil #4). Tres filas por bloque y los botones a lo ancho. */
    @container (max-width: 44rem) {
      .board {
        grid-template-columns: minmax(0, 1fr);
      }
      /* Folded to its first line per block (plan de la lista § 3.3, móvil
         11): the list starts in the first screen. Each block keeps its head
         and its link «see N»; the rest is in the list itself. */
      .rows > li.rows__sep,
      .rows > li:not(.rows__sep) ~ li,
      .block__foot .block__hint {
        display: none;
      }
      .block__foot :global(button) {
        inline-size: 100%;
      }
      /* The contact wraps under the venue instead of both being cut (móvil #11). */
      .row__who {
        flex-wrap: wrap;
        row-gap: 0;
      }
    }
  }
</style>
