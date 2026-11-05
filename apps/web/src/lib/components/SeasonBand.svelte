<script lang="ts">
  /**
   * La temporada de Difusión, por línea (ADR-135), a la cabeza de la vista
   * Envíos (ADR-176): mide cómo va una campaña, lo que salió a muchos y lo que
   * volvió. Salió del panel de Difusión de Conversaciones. Lee el mismo panel
   * (`GET /api/conversations/overview?etiqueta=sales`, la misma clave), así
   * que lo que lo invalida la refresca. Sin conversaciones de difusión en la
   * temporada no se pinta.
   *
   * Pulsar un tramo o el nombre de una línea abre Conversaciones filtrada.
   */

  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON } from '$lib/api';
  import { t, type Locale } from '$lib/i18n';
  import { RELATIONS, relationLabel, type BoloCounts, type Relation } from '$lib/conversation-relation';
  import { NO_LINE, type OverviewResponse, type RelationCounts, type SeasonLine } from '$lib/conversation-overview';
  import { SALES } from '$lib/conversation-tags';

  interface Props {
    filters: { projectIds: string[]; workspaceIds: string[]; lineIds: string[]; enabled: boolean };
    locale: Locale;
    /** «Ver las N en Conversaciones»: la lista de la temporada. */
    allHref: string;
    /** Pulsar un tramo: esa relación en la temporada (y su línea). */
    onrelation: (relation: Relation, linea?: string) => void;
    /** Pulsar el nombre de una línea: esa línea en la temporada. */
    online: (linea: string) => void;
  }

  let { filters, locale, allHref, onrelation, online }: Props = $props();

  function params(f: Props['filters']): string {
    const p = new URLSearchParams();
    if (f.projectIds.length > 0) p.set('project_ids', f.projectIds.join(','));
    if (f.workspaceIds.length > 0) p.set('workspace_ids', f.workspaceIds.join(','));
    if (f.lineIds.length > 0) p.set('line_ids', f.lineIds.join(','));
    p.set('etiqueta', SALES);
    return p.toString();
  }

  // The key of the lens's figures under the Difusión tag: one cache for both.
  const query = createQuery(
    toStore(() => ({
      queryKey: ['conversation-overview', filters.projectIds, filters.workspaceIds, filters.lineIds, SALES] as const,
      enabled: filters.enabled,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<OverviewResponse>(`/api/conversations/overview?${params(filters)}`, signal),
      placeholderData: (prev: OverviewResponse | undefined) => prev,
    })),
  );
  let season = $derived($query.data?.season ?? null);

  function present(counts: RelationCounts): Relation[] {
    return RELATIONS.filter((s) => counts[s] > 0);
  }
  function countsAria(counts: RelationCounts): string {
    return present(counts).map((s) => `${counts[s]} ${relationLabel(s, locale)}`).join(', ');
  }
  function bolosLine(b: BoloCounts, key: 'overview.season_bolos' | 'overview.line_bolos'): string {
    return b.option + b.firm > 0 ? t(key, locale, { option: b.option, firm: b.firm }) : '';
  }
  function lineKey(l: SeasonLine): string {
    return l.line_id ?? NO_LINE;
  }
  function lineName(l: SeasonLine): string {
    return l.line_id === null ? t('overview.no_line', locale) : l.name || t('overview.unnamed_line', locale);
  }
</script>

{#snippet seasonBar(counts: RelationCounts, aria: string, linea?: string)}
  <!-- A drawing for the pointer; the legend below is the control for the
       keyboard and the screen reader (móvil #7): one stop per relation. -->
  <div class="season__bar" role="img" aria-label={aria}>
    {#each present(counts) as s (s)}
      <button
        type="button"
        class="season__seg"
        data-relation={s}
        style:flex-grow={counts[s]}
        title={`${relationLabel(s, locale)} · ${counts[s]}`}
        tabindex="-1"
        aria-hidden="true"
        onclick={() => onrelation(s, linea)}
      ></button>
    {/each}
  </div>
  <div class="season__legend">
    {#each present(counts) as s (s)}
      <button type="button" class="season__item hit" onclick={() => onrelation(s, linea)}>
        <span class="season__n">{counts[s]}</span>
        <span class="season__k" data-relation={s}>{relationLabel(s, locale)}</span>
      </button>
    {/each}
  </div>
{/snippet}

{#if season && season.total > 0}
  <section class="season" aria-labelledby="sb-head" data-testid="block-season" data-help-step="conv-season">
    <div class="season__head">
      <h2 class="season__title eyebrow" id="sb-head">
        {t('conversations.view_sales', locale)} · {t('overview.season_of', locale, { season: season.label })}
      </h2>
      {#if season.lines.length === 0}
        <!-- One bar: its figures go up to the head instead of a line of their own. -->
        <span class="season__line-figs"
          >{[t('overview.line_figures', locale, { total: season.total, answered: season.answered }), bolosLine(season.bolos, 'overview.season_bolos')]
            .filter(Boolean)
            .join(' · ')}</span
        >
      {/if}
    </div>
    <!-- The colours' key, once for every bar: what each tone is. -->
    <p class="season__key" aria-hidden="true">
      {#each present(season.counts) as s (s)}<span><i data-relation={s}></i>{relationLabel(s, locale)}</span>{/each}
    </p>
    {#if season.lines.length > 0}
      <!-- One bar per line, «sin línea» last and never hidden (ADR-135). -->
      <ol class="season__lines">
        {#each season.lines as l (lineKey(l))}
          <li class="season__line" data-testid="season-line" data-line={lineKey(l)}>
            <div class="season__line-head">
              <button
                type="button"
                class="season__line-name"
                aria-label={t('overview.line_open', locale, { line: lineName(l), n: l.total })}
                onclick={() => online(lineKey(l))}>{lineName(l)}</button
              >
              <span class="season__line-figs"
                >{[t('overview.line_figures', locale, { total: l.total, answered: l.answered }), bolosLine(l.bolos, 'overview.line_bolos')]
                  .filter(Boolean)
                  .join(' · ')}</span
              >
            </div>
            {@render seasonBar(l.counts, `${lineName(l)}: ${countsAria(l.counts)}`, lineKey(l))}
          </li>
        {/each}
      </ol>
    {:else}
      <div class="season__line">
        {@render seasonBar(season.counts, countsAria(season.counts))}
      </div>
    {/if}
    <a class="season__all" href={allHref}>{t('envios.season_all', locale, { n: season.total })}</a>
  </section>
{/if}

<style>
  @layer components {
    /* The season, unboxed (diseño 2026-11-05): a section head, the key of
       its colours once, a thin bar per line with its figures, and the way to
       its conversations at the foot. */
    .season {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
    .season__head {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: baseline;
      gap: var(--space-2xs) var(--space-m);
    }
    .season__title {
      margin: 0;
    }
    .season__key {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2xs) var(--space-s);
      margin: 0;
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .season__key span {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
    }
    .season__all {
      align-self: start;
      font-size: var(--text-s);
      color: var(--text-muted);
      text-decoration: underline;
      text-decoration-color: var(--border-color-dark);
      text-underline-offset: 0.25em;
    }
    .season__all:hover {
      color: var(--text-color);
    }

    /* Una barra apilada en el tono de cada estado (`--status`, base.css, el
       mismo que sus pastillas), con una sola receta. */
    .season__seg,
    .season__key i {
      --seg: color-mix(in oklab, var(--status) 38%, transparent);
    }
    .season__bar {
      display: flex;
      gap: var(--space-2xs);
      block-size: var(--season-bar);
      margin-block-start: var(--space-xs);
    }
    .season__seg {
      flex-basis: 0;
      min-inline-size: var(--dot-xs);
      padding: 0;
      border: 0;
      border-radius: var(--radius-xs);
      background: var(--seg);
      cursor: pointer;
    }
    .season__seg:hover,
    .season__seg:focus-visible {
      filter: brightness(0.92);
    }
    .season__legend {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2xs) var(--space-m);
      margin-block-start: var(--space-2xs);
    }
    .season__item {
      display: flex;
      align-items: baseline;
      gap: var(--space-xs);
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      text-align: start;
      cursor: pointer;
    }
    .season__n {
      font-variant-numeric: tabular-nums;
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    /* Under a bar, its figures as words: the key above says the colour. */
    .season__k {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }
    .season__key i {
      display: inline-block;
      inline-size: var(--season-key);
      block-size: var(--season-key);
      border-radius: var(--radius-xs);
      background: var(--seg);
    }
    .season__item:hover .season__k {
      color: var(--text-color);
    }
    .season__lines {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .season__line {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }
    /* El nombre de la línea manda: si no caben las cifras a su lado, bajan
       a la línea de debajo, a la derecha, en vez de cortar el nombre. */
    .season__line-head {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: baseline;
      gap: 0 var(--space-s);
      min-inline-size: 0;
    }
    .season__line-name {
      min-inline-size: 0;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: start;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: pointer;
    }
    .season__line-name:hover {
      text-decoration: underline;
      text-decoration-color: var(--border-color-dark);
      text-underline-offset: 0.25em;
    }
    .season__line-figs {
      flex-shrink: 0;
      margin-inline-start: auto;
      font-size: var(--text-xs);
      font-variant-numeric: tabular-nums;
      color: var(--text-faint);
      text-align: end;
    }
    @media (pointer: coarse) {
      .season__line-name {
        min-block-size: var(--touch-target);
      }
    }
  }
</style>
