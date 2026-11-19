<script lang="ts" module>
  import type { StatusTone } from '$lib/performance';

  /** One box of the stub: a name and whether it is filled. */
  export interface PassBox {
    id: string;
    label: string;
    done: boolean;
  }

  /** One thing the stub still asks for, with the verb that settles it. */
  export interface PassLine {
    id: string;
    text: string;
    /** A quiet fact after the text: a day, since when. */
    meta?: string;
    verbs: PassVerb[];
  }

  export interface PassVerb {
    label: string;
    onclick?: () => void;
    href?: string;
    disabled?: boolean;
    ariaLabel?: string;
  }

  /** An action at the thumb: a place or a call, only when there is data behind it. */
  export interface PassAct {
    id: string;
    label: string;
    ariaLabel?: string;
    href?: string;
    /** «Mapa» is a link that picks the map app (`MapLink`). */
    map?: readonly (string | null | undefined)[];
    /** «Hablar»: a button that opens the board's sheet (ADR-214). */
    onclick?: () => void;
    /** Unread messages, said beside the word; 0 says nothing. */
    count?: number;
    /** The one light act of the row (only «Hablar»). */
    lead?: boolean;
    testid?: string;
  }

  /** The tone's dot on the tag, read off the status tone (never a hex). */
  export function passToneVar(tone: StatusTone): string {
    switch (tone) {
      case 'success':
        return 'var(--success)';
      case 'warning':
        return 'var(--warning)';
      case 'danger':
        return 'var(--danger)';
      case 'info':
        return 'var(--info)';
      default:
        return 'var(--surface-focus-faint)';
    }
  }
</script>

<script lang="ts">
  /**
   * RecordPass — the «pase» of a performance's page (ADR-139 p2; brief
   * `ficha-pase`): the filled piece, with its stub inside.
   *
   *   [mark] FUNCIÓN · EN 3 DÍAS                        [● Confirmada ▾]
   *   SÁB 21 NOV                                  Gota
   *   20h30                                 Teatre Municipal / Girona
   *   ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ perforación ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
   *   LISTO PARA SALIR                                         3 DE 4
   *   ▬▬ Estado  ▬▬ Horas  ▬▬ Equipo  ▭ Hoja
   *   [ Hoja de ruta, sin compartir                  [Compartir] ]
   *   [Hablar 3] [Llamar] [Mapa] [Hoja]
   *
   * The pass has the size of a phone's and never stretches (380 px; less
   * only where the screen is less): on a desktop it is a ticket on the
   * page, not a banner. The piece is the ONE filled surface of the screen
   * (ADR-209): its own ink, the monogram retinted through IdentityMark's
   * contract. The figure is the hour (the date above it in mono); the state
   * is a tag that opens the menu to change it. Without an hour the date
   * rules («Vie 11», and «Diciembre · sin hora» in amber above it). The stub
   * is cut from the piece by a perforation and lives on its ink: a segment
   * per box, the open ones amber, a row with its verb for each of them.
   *
   * It draws what it is given and derives nothing: boxes and lines come from
   * `performanceReadiness` / `performanceMissing` (`$lib/record-missing`).
   * Buttons wear `--radius`, never a pill.
   */
  import type { Snippet } from 'svelte';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import MapLink from '$lib/components/MapLink.svelte';
  import { dayParts } from '$lib/datetime';
  import { t, type Locale } from '$lib/i18n';
  import { accentVarFor } from '$lib/utils/accent';

  interface Props {
    locale: Locale;
    project: { slug: string; name: string; accent: string | null } | null;
    /** «Función · en 3 días». */
    eyebrow: string;
    /** The state tag: a menu trigger for whoever can change it, else a plain tag. */
    tag: Snippet;
    /** The first (or only) day, ISO. The pass writes it itself, without the year. */
    dayIso: string;
    /** The last day of a span (a trip, a two-day press): «sáb 21 nov – lun 23 nov». */
    dayIsoEnd?: string | null;
    /** The hour in the venue's clock; null says «sin hora». */
    time: string | null;
    /** The show (the project's name). */
    show: string | null;
    /** The room and the city, `·` between them: each is a line. */
    place: string;
    /** Set for whoever edits: the date and the place open the details. */
    onEditDate?: (() => void) | null;
    onEditPlace?: (() => void) | null;
    editDateLabel?: string;
    editPlaceLabel?: string;
    /** Drawn instead of the date while it is being changed in place (ADR-213). */
    dateEdit?: Snippet | null;
    /** Drawn under the lead while the place is being changed in place. */
    placeEdit?: Snippet | null;
    /** «Guardado», said for a moment after a change saved itself. */
    saved?: boolean;
    /** No hour is no news (a trip): the date rules without the amber «sin hora». */
    timeOptional?: boolean;
    /** The piece's name for assistive tech (a performance's by default). */
    label?: string | null;
    acts?: readonly PassAct[];
    boxes: readonly PassBox[];
    /** Open boxes with their verbs; only for whoever can settle them. */
    lines?: readonly PassLine[];
  }

  let {
    locale,
    project,
    eyebrow,
    tag,
    dayIso,
    dayIsoEnd = null,
    time,
    show,
    place,
    onEditDate = null,
    onEditPlace = null,
    editDateLabel,
    editPlaceLabel,
    dateEdit = null,
    placeEdit = null,
    saved = false,
    timeOptional = false,
    label = null,
    acts = [],
    boxes,
    lines = [],
  }: Props = $props();

  let doneCount = $derived(boxes.filter((b) => b.done).length);
  let day = $derived(dayParts(dayIso, locale));
  let dayEnd = $derived(dayIsoEnd && dayIsoEnd !== dayIso ? dayParts(dayIsoEnd, locale) : null);
  /** «sáb 21 nov» (a span: «sáb 21 nov – lun 23 nov»), the mono line over the hour. */
  let dateLine = $derived(dayEnd ? `${day.short} – ${dayEnd.short}` : day.short);
  /** The room and the city, one line each. */
  let placeLines = $derived(place.split(' · ').filter(Boolean));
</script>

<section class="pass" aria-label={label ?? t('pass.label', locale)} data-testid="record-pass">
  <div class="pass__piece">
    <div class="pass__eyeline">
      <span class="pass__eye">
        {#if project}<span class="pass__mark"
            ><IdentityMark mini accent={accentVarFor(project)} name={project.name} /></span
          >{/if}{eyebrow}
      </span>
      <span class="pass__tag-slot"
        >{#if saved}<span class="pass__saved" role="status" data-testid="pass-saved">{t('pass.saved', locale)}</span
          >{/if}{@render tag()}</span
      >
    </div>

    <div class="pass__lead">
      <div class="pass__when">
        {#if dateEdit}
          <span class="pass__date">{@render dateEdit()}</span>
          <span class="pass__time" class:pass__time--date={!time} data-testid={time ? 'pass-time' : 'pass-no-time'}>{time ?? day.big}</span>
        {:else if time}
          <span class="pass__date">
            {#if onEditDate}<button type="button" class="pass__edit" aria-label={editDateLabel} onclick={onEditDate}>{dateLine}</button
              >{:else}{dateLine}{/if}
          </span>
          <span class="pass__time" data-testid="pass-time">{time}</span>
        {:else}
          <span class="pass__date" class:pass__date--open={!timeOptional} data-testid={timeOptional ? undefined : 'pass-no-time'}
            >{day.month}{#if dayEnd} – {dayEnd.short}{/if}{#if !timeOptional} · {t('pass.no_time', locale)}{/if}</span
          >
          <span class="pass__time pass__time--date">
            {#if onEditDate}<button type="button" class="pass__edit" aria-label={editDateLabel} onclick={onEditDate}>{day.big}</button
              >{:else}{day.big}{/if}
          </span>
        {/if}
      </div>
      <div class="pass__where">
        {#if show}<span class="pass__show">{show}</span>{/if}
        {#if placeLines.length > 0 && !placeEdit}
          <span class="pass__place">
            {#if onEditPlace}<button type="button" class="pass__edit" aria-label={editPlaceLabel} onclick={onEditPlace}
                >{#each placeLines as l, i (i)}<span class="pass__place-line">{l}</span>{/each}</button
              >{:else}{#each placeLines as l, i (i)}<span class="pass__place-line">{l}</span>{/each}{/if}
          </span>
        {:else if placeLines.length === 0 && !placeEdit && onEditPlace}
          <!-- No place yet: the same door, with a verb instead of a name. -->
          <span class="pass__place">
            <button type="button" class="pass__edit pass__edit--open" data-testid="pass-put-place" onclick={onEditPlace}
              >{t('pass.put_place', locale)}</button
            >
          </span>
        {/if}
      </div>
    </div>

    {#if placeEdit}
      <div class="pass__place-edit" data-testid="pass-place-edit">{@render placeEdit()}</div>
    {/if}

    {#if boxes.length > 0}
      <!-- The stub, cut from the piece: the perforation with its two notches. -->
      <div class="pass__perf" aria-hidden="true"></div>
      <div class="stub" data-testid="pass-stub">
        <p class="stub__head">
          <span class="stub__title">{t('pass.ready', locale)}</span>
          <span class="stub__count" data-testid="pass-count">{t('pass.ready_count', locale, { n: doneCount, m: boxes.length })}</span>
        </p>
        <ul class="stub__boxes" role="list">
          {#each boxes as b (b.id)}
            <li class="stub__box" class:stub__box--done={b.done} data-box={b.id} data-done={b.done}>
              <span class="stub__mark" aria-hidden="true"></span>
              <span class="stub__name">{b.label}</span>
              <span class="visually-hidden">{t(b.done ? 'pass.box_done' : 'pass.box_open', locale)}</span>
            </li>
          {/each}
        </ul>
        {#if lines.length > 0}
          <ul class="stub__lines" role="list" data-testid="record-missing">
            {#each lines as line (line.id)}
              <li class="stub__line" data-missing={line.id}>
                <span class="stub__text"
                  >{line.text}{#if line.meta}<span class="stub__meta">{line.meta}</span>{/if}</span
                >
                {#if line.verbs.length > 0}
                  <span class="stub__verbs">
                    {#each line.verbs as v, i (i)}
                      {#if v.href}
                        <a class="missing__act stub__verb" href={v.href} aria-label={v.ariaLabel}>{v.label}</a>
                      {:else}
                        <button type="button" class="missing__act stub__verb" disabled={v.disabled} aria-label={v.ariaLabel} onclick={v.onclick}
                          >{v.label}</button
                        >
                      {/if}
                    {/each}
                  </span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    {#if acts.length > 0}
      <nav class="pass__acts" aria-label={t('ahora.actions', locale)} data-testid="pass-acts">
        {#each acts as a (a.id)}
          {#if a.map}
            <MapLink class="pass__act" parts={a.map} changeIn="settings" ariaLabel={a.ariaLabel}>{a.label}</MapLink>
          {:else if a.onclick}
            <button
              type="button"
              class="pass__act"
              class:pass__act--lead={a.lead}
              aria-label={a.ariaLabel}
              data-testid={a.testid}
              onclick={a.onclick}
              >{a.label}{#if a.count}<span class="pass__count" data-testid="pass-talk-count">{a.count}</span>{/if}</button
            >
          {:else}
            <a class="pass__act" href={a.href} aria-label={a.ariaLabel}>{a.label}</a>
          {/if}
        {/each}
      </nav>
    {/if}
  </div>
</section>

<style>
  @layer components {
    /* The pass is a phone's size and does not stretch: 380 px on any screen
       that has them, the whole width on one that has fewer. */
    .pass {
      inline-size: min(100%, var(--pass-width));
    }

    /* THE FILLED PIECE (design-system rules 1 and 2): the one surface of the
       screen with a fill, its own ink, the monogram retinted over it. The
       stub is inside it: one object, cut by a perforation. */
    .pass__piece {
      display: grid;
      gap: var(--space-s);
      padding: var(--space-m);
      border-radius: var(--radius-xl);
      background: var(--surface-focus);
      color: var(--surface-focus-ink);
      --identity-tint-base: var(--surface-focus);
      --identity-tint: var(--surface-focus-mark-tint);
      --identity-ink-l: var(--surface-focus-mark-ink-l);
    }
    .pass__eyeline {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-xs) var(--space-s);
    }
    .pass__eye {
      display: flex;
      align-items: center;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--surface-focus-muted);
    }
    .pass__mark {
      display: inline-flex;
      flex: none;
      margin-inline-end: var(--space-xs);
    }

    /* The state, as a tag: quiet on the piece, so the hour and the place
       weigh more than it (the brief's rule). The tone is a dot. */
    .pass__tag-slot :global(.pass__tag) {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2xs);
      padding: var(--space-2xs) var(--space-xs);
      border: var(--line-hairline) solid var(--surface-focus-rule);
      border-radius: var(--radius);
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: var(--text-s);
      cursor: pointer;
    }
    .pass__tag-slot :global(button.pass__tag:hover) {
      background: var(--surface-focus-act);
    }
    .pass__tag-slot :global(.pass__tag::before) {
      content: '';
      inline-size: var(--dot-m);
      block-size: var(--dot-m);
      border-radius: var(--radius-50);
      background: var(--pass-tone, var(--surface-focus-faint));
    }
    .pass__tag-slot :global(.pass__tag .status-caret) {
      color: var(--surface-focus-faint);
    }

    /* The hour (or the day, with no hour) is the figure; the show sits to
       its right at 30 px and the room and the city under it, a line each. */
    .pass__lead {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: end;
      gap: var(--space-s) var(--space-m);
    }
    .pass__when {
      display: grid;
    }
    .pass__date {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--surface-focus-muted);
    }
    .pass__date--open {
      color: var(--warning-light);
    }
    .pass__time {
      font-family: var(--font-display);
      font-size: var(--display-pass);
      line-height: 1;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .pass__time--date {
      font-size: var(--display-pass-day);
    }
    .pass__where {
      display: grid;
      justify-items: end;
      gap: var(--space-2xs);
      text-align: end;
      min-inline-size: 0;
    }
    .pass__show {
      font-family: var(--font-display);
      font-size: var(--display-pass-show);
      line-height: 1.05;
      text-wrap: balance;
    }
    .pass__place {
      font-size: var(--text-xs);
      color: var(--surface-focus-muted);
    }
    .pass__place-line {
      display: block;
    }
    .pass__edit {
      appearance: none;
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      color: inherit;
      text-align: inherit;
      text-transform: inherit;
      letter-spacing: inherit;
      cursor: pointer;
      text-underline-offset: 3px;
    }
    @media (hover: hover) {
      .pass__edit:hover {
        text-decoration: underline;
      }
    }
    /* «Poner lugar»: a place still to write reads as one, in the piece's
       amber like «sin hora». */
    .pass__edit--open {
      color: var(--warning-light);
      text-decoration: underline;
      text-decoration-thickness: var(--line-hairline);
      text-underline-offset: 3px;
    }

    .pass__saved {
      margin-inline-end: var(--space-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--surface-focus-muted);
    }
    .pass__tag-slot {
      display: inline-flex;
      align-items: center;
    }
    /* Changing the place in place: bare fields on the piece's own ink. */
    .pass__place-edit {
      display: grid;
      gap: var(--space-s);
      padding-block-start: var(--space-s);
      border-block-start: var(--line-hairline) solid var(--surface-focus-rule);
    }
    .pass__place-edit :global(.pass__in),
    .pass__date :global(.pass__in) {
      min-inline-size: 0;
      padding: 0 0 var(--line-hairline);
      border: 0;
      border-block-end: var(--line-hairline) solid var(--surface-focus-rule);
      background: none;
      color: inherit;
      font: inherit;
      color-scheme: dark;
    }
    .pass__place-edit :global(.pass__in:focus),
    .pass__date :global(.pass__in:focus) {
      outline: none;
      border-block-end-color: var(--surface-focus-muted);
    }
    .pass__place-edit :global(.pass__btn) {
      padding: var(--space-2xs) var(--space-s);
      border: var(--line-hairline) solid var(--surface-focus-rule);
      border-radius: var(--radius);
      background: var(--surface-focus-act);
      color: inherit;
      font: inherit;
      font-size: var(--text-s);
      cursor: pointer;
    }
    .pass__place-edit :global(.pass__btn:hover) {
      background: var(--surface-focus-act-hover);
    }

    /* THE PERFORATION: a dashed line across the piece with a notch cut at
       each edge, in the page's own colour. */
    .pass__perf {
      position: relative;
      margin-inline: calc(-1 * var(--space-m));
      border-block-start: var(--line-hairline) dashed var(--surface-focus-faint);
    }
    .pass__perf::before,
    .pass__perf::after {
      content: '';
      position: absolute;
      inset-block-start: -0.5rem;
      inline-size: 1rem;
      block-size: 1rem;
      border-radius: var(--radius-50);
      background: var(--bg);
    }
    .pass__perf::before {
      inset-inline-start: -0.5rem;
    }
    .pass__perf::after {
      inset-inline-end: -0.5rem;
    }

    /* THE STUB: «listo para salir N de M», a segment per box with its name
       under it, and a row for each open one, in amber, with its verb. */
    .stub {
      display: grid;
      gap: var(--space-xs);
    }
    .stub__head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: var(--space-s);
      margin: 0;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--surface-focus-muted);
    }
    .stub__count {
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      color: var(--surface-focus-ink);
    }
    .stub__boxes {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(0, 1fr);
      gap: var(--space-2xs);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .stub__box {
      display: grid;
      gap: var(--space-2xs);
      font-size: var(--text-xs);
      color: var(--surface-focus-muted);
    }
    .stub__mark {
      block-size: 0.375rem;
      border: var(--line-hairline) solid var(--warning-light);
      border-radius: var(--radius-xs);
    }
    .stub__box--done .stub__mark {
      border-color: var(--surface-focus-ink);
      background: var(--surface-focus-ink);
    }
    .stub__box:not(.stub__box--done) {
      color: var(--warning-light);
    }
    .stub__name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .stub__lines {
      display: grid;
      gap: var(--space-xs);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .stub__line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s);
      padding: var(--space-xs);
      padding-inline-start: var(--space-s);
      border-radius: var(--radius);
      background: color-mix(in oklch, var(--warning-light) 16%, transparent);
      font-size: var(--text-s);
      color: var(--warning-light);
    }
    .stub__meta {
      margin-inline-start: var(--space-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: var(--surface-focus-faint);
    }
    .stub__verbs {
      display: inline-flex;
      flex: none;
      flex-wrap: wrap;
      gap: var(--space-2xs);
    }
    /* The verb is a light button on the dark piece, at the radius of buttons. */
    .stub__verbs :global(.stub__verb) {
      appearance: none;
      display: inline-flex;
      align-items: center;
      min-block-size: 2.25rem;
      padding: var(--space-2xs) var(--space-s);
      border: 0;
      border-radius: var(--radius);
      background: var(--surface-focus-ink);
      color: var(--surface-focus);
      font: inherit;
      font-size: var(--text-s);
      font-weight: 500;
      text-decoration: none;
      white-space: nowrap;
      cursor: pointer;
    }
    .stub__verbs :global(.stub__verb:disabled) {
      opacity: 0.5;
      cursor: default;
    }

    /* THE ACTS: four buttons that share the 380 px, each 44 px tall. */
    .pass__acts {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(0, 1fr);
      gap: var(--space-xs);
      padding-block-start: var(--space-s);
      border-block-start: var(--line-hairline) solid var(--surface-focus-rule);
    }
    /* A piece with no stub has no perforation either: the acts need no rule. */
    .pass__lead + .pass__acts,
    .pass__place-edit + .pass__acts {
      padding-block-start: 0;
      border-block-start: 0;
    }
    /* `:global`: «Mapa» is a MapLink, whose <a> this file does not own. */
    .pass__acts :global(.pass__act) {
      display: flex;
      align-items: center;
      justify-content: center;
      min-block-size: 2.75rem;
      padding: var(--space-2xs) var(--space-xs);
      border-radius: var(--radius);
      background: var(--surface-focus-act);
      color: inherit;
      font-size: var(--text-m);
      font-weight: 500;
      text-decoration: none;
      white-space: nowrap;
    }
    .pass__acts :global(.pass__act:hover) {
      background: var(--surface-focus-act-hover);
    }
    button.pass__act {
      gap: var(--space-xs);
      border: 0;
      font: inherit;
      font-size: var(--text-m);
      font-weight: 500;
      cursor: pointer;
    }
    /* «Hablar»: the one light act on the dark piece (the drawing's). */
    .pass__acts .pass__act--lead,
    .pass__acts .pass__act--lead:hover {
      background: var(--surface-focus-ink);
      color: var(--surface-focus);
    }
    .pass__count {
      display: inline-grid;
      place-items: center;
      min-inline-size: 1.25rem;
      padding-inline: var(--space-2xs);
      border-radius: var(--radius-xs);
      background: var(--surface-focus);
      color: var(--surface-focus-ink);
      font-size: var(--text-xs);
      font-variant-numeric: tabular-nums;
    }
  }
</style>
