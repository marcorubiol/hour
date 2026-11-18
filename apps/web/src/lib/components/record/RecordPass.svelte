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
   * `ficha-pase`, phase 1): the filled piece and its stub.
   *
   *   [mark] FUNCIÓN · EN 3 DÍAS                        [● Confirmada ▾]
   *   SÁB 21 NOV                                  Gota a gota
   *   19:30                                  Teatre Municipal · Girona
   *   ───────────────────────────────────────────────────────────────
   *   [Llamar]  [Mapa]  [Hoja]
   *   LISTO PARA SALIR · 3 DE 4
   *   ■ Estado  ■ Horas  ■ Equipo  □ Hoja
   *   Hoja de ruta sin compartir   compartir
   *
   * The piece is the ONE filled surface of the screen (ADR-209): its own ink,
   * the monogram retinted through IdentityMark's contract. The hour is the
   * thing that rules (Newsreader, the date above it in mono); the state is a
   * tag that opens the menu to change it. The stub is NOT filled: it reads
   * «what is left», in amber, with a line (and a verb) for each open box.
   *
   * It draws what it is given and derives nothing: boxes and lines come from
   * `performanceReadiness` / `performanceMissing` (`$lib/record-missing`).
   * Without a start time, the date rules and «sin hora» is amber (the case
   * with no hours). Buttons wear `--radius`, never a pill.
   */
  import type { Snippet } from 'svelte';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import MapLink from '$lib/components/MapLink.svelte';
  import { t, type Locale } from '$lib/i18n';
  import { accentVarFor } from '$lib/utils/accent';

  interface Props {
    locale: Locale;
    project: { slug: string; name: string; accent: string | null } | null;
    /** «Función · en 3 días». */
    eyebrow: string;
    /** The state tag: a menu trigger for whoever can change it, else a plain tag. */
    tag: Snippet;
    /** «Sáb 21 nov». */
    date: string;
    /** The hour in the venue's clock; null says «sin hora». */
    time: string | null;
    /** The show (the project's name). */
    show: string | null;
    /** The room and the city. */
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
    date,
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
    acts = [],
    boxes,
    lines = [],
  }: Props = $props();

  let doneCount = $derived(boxes.filter((b) => b.done).length);
</script>

<section class="pass" aria-label={t('pass.label', locale)} data-testid="record-pass">
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
          <span class="pass__time" class:pass__time--date={!time} data-testid={time ? 'pass-time' : 'pass-no-time'}>{time ?? date}</span>
        {:else if time}
          <span class="pass__date">
            {#if onEditDate}<button type="button" class="pass__edit" aria-label={editDateLabel} onclick={onEditDate}>{date}</button
              >{:else}{date}{/if}
          </span>
          <span class="pass__time" data-testid="pass-time">{time}</span>
        {:else}
          <span class="pass__date pass__date--open" data-testid="pass-no-time">{t('pass.no_time', locale)}</span>
          <span class="pass__time pass__time--date">
            {#if onEditDate}<button type="button" class="pass__edit" aria-label={editDateLabel} onclick={onEditDate}>{date}</button
              >{:else}{date}{/if}
          </span>
        {/if}
      </div>
      <div class="pass__where">
        {#if show}<span class="pass__show">{show}</span>{/if}
        {#if place && !placeEdit}
          <span class="pass__place">
            {#if onEditPlace}<button type="button" class="pass__edit" aria-label={editPlaceLabel} onclick={onEditPlace}>{place}</button
              >{:else}{place}{/if}
          </span>
        {/if}
      </div>
    </div>

    {#if placeEdit}
      <div class="pass__place-edit" data-testid="pass-place-edit">{@render placeEdit()}</div>
    {/if}

    {#if acts.length > 0}
      <nav class="pass__acts" aria-label={t('ahora.actions', locale)} data-testid="pass-acts">
        {#each acts as a (a.id)}
          {#if a.map}
            <MapLink class="pass__act" parts={a.map} changeIn="settings" ariaLabel={a.ariaLabel}>{a.label}</MapLink>
          {:else}
            <a class="pass__act" href={a.href} aria-label={a.ariaLabel}>{a.label}</a>
          {/if}
        {/each}
      </nav>
    {/if}
  </div>

  {#if boxes.length > 0}
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
                      <a class="missing__act" href={v.href} aria-label={v.ariaLabel}>{v.label}</a>
                    {:else}
                      <button type="button" class="missing__act" disabled={v.disabled} aria-label={v.ariaLabel} onclick={v.onclick}
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
</section>

<style>
  @layer components {
    .pass {
      display: grid;
      gap: var(--space-s);
      margin-block-end: var(--space-m);
    }

    /* THE FILLED PIECE (design-system rules 1 and 2): the one surface of the
       screen with a fill, its own ink, the monogram retinted over it. */
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
      font-size: var(--display-piece);
      line-height: 1.02;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .pass__time--date {
      text-transform: capitalize;
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
      font-size: var(--text-l);
      line-height: 1.1;
      text-wrap: balance;
    }
    .pass__place {
      font-size: var(--text-m);
      color: var(--surface-focus-muted);
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

    .pass__acts {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(0, 1fr);
      gap: var(--space-s);
      padding-block-start: var(--space-s);
      border-block-start: var(--line-hairline) solid var(--surface-focus-rule);
    }
    /* `:global`: «Mapa» is a MapLink, whose <a> this file does not own. */
    .pass__acts :global(.pass__act) {
      display: flex;
      align-items: center;
      justify-content: center;
      min-block-size: var(--touch-target);
      padding: var(--space-xs) var(--space-s);
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

    /* THE STUB: boxes with their names; the open ones amber, a line each. */
    .stub {
      display: grid;
      gap: var(--space-xs);
      padding-inline: var(--space-xs);
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
      color: var(--text-muted);
    }
    .stub__count {
      font-variant-numeric: tabular-nums;
    }
    .stub__boxes {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs) var(--space-m);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .stub__box {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2xs);
      font-size: var(--text-s);
      color: var(--missing-ink);
    }
    .stub__box--done {
      color: var(--text-color);
    }
    .stub__mark {
      flex: none;
      inline-size: 0.875rem;
      block-size: 0.875rem;
      border: var(--line-hairline) solid currentColor;
      border-radius: var(--radius-xs);
    }
    .stub__box--done .stub__mark {
      border-color: var(--success);
      background: var(--success);
    }
    .stub__lines {
      display: grid;
      gap: var(--space-2xs);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .stub__line {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-2xs) var(--space-m);
      font-size: var(--text-s);
      color: var(--text-color);
    }
    .stub__meta {
      margin-inline-start: var(--space-s);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-faint);
    }
    .stub__verbs {
      display: inline-flex;
      flex-wrap: wrap;
      gap: var(--space-2xs) var(--space-m);
    }
  }
</style>
