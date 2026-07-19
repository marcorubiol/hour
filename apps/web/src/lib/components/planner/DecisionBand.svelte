<script module lang="ts">
  /**
   * Decision band (ADR-080 §4) — the derived decisions queue rendered
   * above every Calendar projection. Collapsed = one honest line (the
   * urgent one if any, the count otherwise); open = stacked "A ─ o ─ B"
   * cards plus the quiet concurrence list (§3 — "es veu, no crida").
   *
   * Pure presentation: the page owns the feeds, the engine
   * ($lib/planner decisionsFor), the scope filtering and the write
   * mutations. The component only renders VMs and reports gestures up
   * (onConfirm / onRelease — each maps to ONE explicit PATCH, AI=UI
   * parity §5). "Mantén el hold" collapses that card locally (session
   * state, never persisted); "Deixa-ho obert" collapses the band.
   *
   * The band also renders with ZERO decisions when concurrences exist —
   * §3's tier is defined by being seen, and a concurrence has no cell
   * mark by design, so the band is its only surface. That state wears
   * the quiet skin (neutral border, soft head) and the count chip counts
   * concurrences, never "per decidir".
   */

  /** One side of a decision card, display-ready. */
  export type DecisionOptionVM = {
    /** Performance id — the PATCH target. */
    id: string;
    project: string;
    /** CSS color value (accent var) for the project dot. */
    accent: string;
    venue: string;
    city: string | null;
    time: string | null;
    statusLabel: string;
    hold: boolean;
    confirmed: boolean;
  };

  export type DecisionVM = {
    id: string;
    /** YYYY-MM-DD. */
    day: string;
    level: 'people' | 'double' | 'possible';
    kind: 'choose' | 'release';
    urgent: boolean;
    /** YYYY-MM-DD or null (no notice anywhere — never urgent). */
    decideBy: string | null;
    /** Resolved person names ('people' level). */
    people: string[];
    /** Project lacking team data ('possible' level), when identifiable. */
    missingTeam: string | null;
    a: DecisionOptionVM;
    b: DecisionOptionVM;
  };

  /** A quiet same-day pair (ADR-080 §3) — seen, never counted. */
  export type ConcurrenceVM = {
    id: string;
    day: string;
    a: { venue: string; project: string; accent: string };
    b: { venue: string; project: string; accent: string };
  };
</script>

<script lang="ts">
  import { t, type Locale } from '$lib/i18n';
  import { SvelteSet } from 'svelte/reactivity';

  interface Props {
    decisions: DecisionVM[];
    concurrences: ConcurrenceVM[];
    open: boolean;
    onToggle: (open: boolean) => void;
    /** Confirm this performance (PATCH status → confirmed). */
    onConfirm: (perfId: string) => void;
    /** Release this performance (PATCH status → cancelled). */
    onRelease: (perfId: string) => void;
    /** Performance id with a write in flight (disables its buttons). */
    pendingId: string | null;
    locale: Locale;
    /** BCP-47 tag for date formatting (en-GB / es-ES / ca-ES). */
    localeTag: string;
    /** DOM id — the pulse strip's jump target. */
    id?: string;
  }

  let {
    decisions,
    concurrences,
    open,
    onToggle,
    onConfirm,
    onRelease,
    pendingId,
    locale,
    localeTag,
    id = 'cal-decisions',
  }: Props = $props();

  // "Mantén el hold" — collapse that card for this session only. Never
  // persisted: the queue is derived truth and must resurface on reload.
  const keptCards = new SvelteSet<string>();

  let shown = $derived(decisions.filter((d) => !keptCards.has(d.id)));
  let urgentCount = $derived(decisions.filter((d) => d.urgent).length);
  let headline = $derived(decisions.find((d) => d.urgent) ?? null);

  function dayNum(iso: string): number {
    return Number(iso.slice(8, 10));
  }
  function monthShort(iso: string): string {
    return new Intl.DateTimeFormat(localeTag, { month: 'short', timeZone: 'UTC' })
      .format(new Date(`${iso}T00:00:00Z`))
      .replace(/\.+$/, '');
  }
  function weekdayShort(iso: string): string {
    return new Intl.DateTimeFormat(localeTag, { weekday: 'short', timeZone: 'UTC' })
      .format(new Date(`${iso}T00:00:00Z`))
      .replace(/\.+$/, '');
  }
  /** "17 jul" — the honest date every copy leans on. */
  function dayLabelShort(iso: string): string {
    return `${dayNum(iso)} ${monthShort(iso)}`;
  }

  function title(d: DecisionVM): string {
    if (d.level === 'people') return t('planner.dec_people_title', locale);
    if (d.level === 'double') return t('planner.dec_double_title', locale);
    return t('planner.dec_possible_title', locale);
  }
  /** Reason for double/possible — 'people' renders inline (bold names). */
  function reason(d: DecisionVM): string {
    if (d.level === 'double') return t('planner.dec_double_reason', locale);
    return d.missingTeam
      ? t('planner.dec_possible_reason', locale, { project: d.missingTeam })
      : t('planner.dec_possible_reason_generic', locale);
  }
  function tie(d: DecisionVM): string {
    if (d.level === 'people') return t('planner.dec_tie_people', locale);
    if (d.level === 'double') return t('planner.dec_tie_double', locale);
    return d.missingTeam
      ? t('planner.dec_tie_possible', locale, { project: d.missingTeam })
      : t('planner.dec_tie_possible_generic', locale);
  }
  /** Honest, data-derived footer: a real decide-by day or "no notice". */
  function hint(d: DecisionVM): string {
    return d.decideBy
      ? t('planner.dec_decide_by', locale, { date: dayLabelShort(d.decideBy) })
      : t('planner.dec_no_notice', locale);
  }

  /** Collapsed-line subcopy: who/day, plus the decide-by when it exists. */
  let headSub = $derived.by(() => {
    if (!headline) return '';
    const who = headline.people[0] ?? headline.a.project;
    const base = `${who} · ${dayLabelShort(headline.day)}`;
    return headline.decideBy
      ? `${base} — ${t('planner.dec_decide_by', locale, { date: dayLabelShort(headline.decideBy) })}`
      : base;
  });

  let countChip = $derived(
    urgentCount > 0
      ? t('planner.dec_chip_urgent', locale, { n: decisions.length, m: urgentCount })
      : String(decisions.length > 0 ? decisions.length : concurrences.length),
  );

  function confirmedSide(d: DecisionVM): DecisionOptionVM {
    return d.a.confirmed ? d.a : d.b;
  }
  function holdSide(d: DecisionVM): DecisionOptionVM {
    return d.a.confirmed ? d.b : d.a;
  }
</script>

<section
  class="decband"
  class:decband--urgent={urgentCount > 0}
  class:decband--quiet={decisions.length === 0}
  class:decband--open={open}
  {id}
>
  <button
    type="button"
    class="decband__head"
    aria-expanded={open}
    aria-controls="{id}-body"
    onclick={() => onToggle(!open)}
  >
    {#if headline}
      <span class="decband__mark" aria-hidden="true">!</span>
      <span class="decband__title">{t('planner.dec_urgent_title', locale)}</span>
      <span class="decband__sub">{headSub}</span>
    {:else if decisions.length > 0}
      <span class="decband__mark decband__mark--soft" aria-hidden="true">?</span>
      <span class="decband__title"
        >{t('planner.dec_needed_title', locale, { n: decisions.length })}</span
      >
    {:else}
      <!-- Concurrences only (§3) — seen, never counted as decisions. -->
      <span class="decband__mark decband__mark--soft" aria-hidden="true">·</span>
      <span class="decband__title">{t('planner.dec_concurrence_title', locale)}</span>
    {/if}
    <span class="decband__count">{countChip}</span>
    <span class="decband__chev" aria-hidden="true">▾</span>
  </button>

  {#if open}
    <div class="decband__body" id="{id}-body">
      {#each shown as d (d.id)}
        <!-- Per-card DOM id — the carrils connector jump lands here
             (getElementById copes with the ':'/'+' of the pair id). -->
        <article
          class="deccard"
          class:deccard--soft={d.level === 'possible'}
          id="{id}-card-{d.id}"
        >
          <header class="deccard__top">
            <div class="deccard__date">
              <div class="deccard__daynum">{dayNum(d.day)}</div>
              <div class="deccard__dayrow">{monthShort(d.day)} · {weekdayShort(d.day)}</div>
            </div>
            <div class="deccard__q">
              <p class="deccard__title">
                <span
                  class="deccard__mark"
                  class:deccard__mark--possible={d.level === 'possible'}
                  aria-hidden="true">{d.level === 'possible' ? '?' : '!'}</span
                >
                {title(d)}
              </p>
              <p class="deccard__reason">
                {#if d.level === 'people'}
                  <!-- Shared person bold (ADR-080 §4) — the name IS the reason. -->
                  <b>{d.people.join(', ')}</b>
                  {t('planner.dec_people_reason_rest', locale)}
                {:else}
                  {reason(d)}
                {/if}
              </p>
            </div>
            {#if d.urgent && d.decideBy}
              <span class="deccard__urg"
                >{t('planner.dec_decide_by', locale, { date: dayLabelShort(d.decideBy) })}</span
              >
            {/if}
          </header>

          {#if d.kind === 'release'}
            <!-- Follow-up card (ADR-080 §5): one side already confirmed —
                 the only question left is the other hold. Two explicit
                 gestures, never a silent write. -->
            <div class="deccard__release">
              <p class="deccard__release-q">
                {t('planner.dec_release_q', locale, {
                  a: confirmedSide(d).venue,
                  b: holdSide(d).venue,
                })}
              </p>
              <div class="deccard__release-actions">
                <button
                  type="button"
                  class="deccard__btn deccard__btn--warn"
                  disabled={pendingId !== null}
                  onclick={() => onRelease(holdSide(d).id)}
                >
                  {t('planner.dec_release', locale)}
                </button>
                <button
                  type="button"
                  class="deccard__btn"
                  disabled={pendingId !== null}
                  onclick={() => keptCards.add(d.id)}
                >
                  {t('planner.dec_keep_hold', locale)}
                </button>
              </div>
            </div>
          {:else}
            <div class="deccard__vs">
              {#each [d.a, d.b] as o, i (o.id)}
                {#if i === 1}
                  <div class="deccard__mid">
                    <span class="deccard__or">{t('planner.dec_or', locale)}</span>
                    <span class="deccard__tie">
                      {#if d.level === 'people'}
                        <b>{d.people.join(', ')}</b><br />{tie(d)}
                      {:else}
                        {tie(d)}
                      {/if}
                    </span>
                  </div>
                {/if}
                <div class="deccard__opt">
                  <p class="deccard__tag" style="--c: {o.accent}">
                    <span class="deccard__dot" aria-hidden="true"></span>{o.project}
                  </p>
                  <p class="deccard__venue">
                    {o.venue}{#if o.city}<span class="deccard__city"> · {o.city}</span>{/if}
                  </p>
                  <p class="deccard__meta">
                    {#if o.time}<span>{o.time}</span>{/if}
                    <span class="deccard__hold" style="--c: {o.accent}">{o.statusLabel}</span>
                  </p>
                  <button
                    type="button"
                    class="deccard__btn deccard__btn--pick"
                    disabled={pendingId !== null}
                    onclick={() => onConfirm(o.id)}
                  >
                    {t('planner.dec_confirm', locale, { venue: o.venue })}
                  </button>
                </div>
              {/each}
            </div>
            <footer class="deccard__foot">
              <span class="deccard__hint">{hint(d)}</span>
              <button type="button" class="deccard__btn deccard__btn--quiet" onclick={() => onToggle(false)}>
                {t('planner.dec_keep_open', locale)}
              </button>
            </footer>
          {/if}
        </article>
      {/each}

      {#if concurrences.length > 0}
        <!-- ADR-080 §3 — same day, disjoint known teams: seen, not counted,
             no marks, no urgency. A quiet list and nothing more. -->
        <div class="decband__conc">
          <p class="decband__conc-title">{t('planner.dec_concurrence_title', locale)}</p>
          <ul class="decband__conc-list" role="list">
            {#each concurrences as c (c.id)}
              <li class="decband__conc-row">
                <span class="decband__conc-day">{dayLabelShort(c.day)}</span>
                <span class="decband__conc-pair">
                  <span class="deccard__dot" style="--c: {c.a.accent}" aria-hidden="true"></span>
                  {c.a.venue} · {c.a.project}
                </span>
                <span class="decband__conc-sep" aria-hidden="true">·</span>
                <span class="decband__conc-pair">
                  <span class="deccard__dot" style="--c: {c.b.accent}" aria-hidden="true"></span>
                  {c.b.venue} · {c.b.project}
                </span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  @layer components {
    .decband {
      border: 1px solid color-mix(in oklch, var(--danger) 30%, var(--border-color-dark));
      border-radius: var(--radius-xl);
      background: var(--bg-ultra-light);
      overflow: hidden;
    }
    .decband--urgent.decband--open {
      box-shadow: 0 0 0 3px color-mix(in oklch, var(--danger) 10%, transparent);
    }
    /* Concurrences only — the quiet tier never wears the danger skin. */
    .decband--quiet {
      border-color: var(--border-color-dark);
    }

    .decband__head {
      display: flex;
      align-items: center;
      gap: var(--space-s);
      inline-size: 100%;
      padding: var(--space-s) var(--space-m);
      background: var(--bg-light);
      border: none;
      cursor: pointer;
      text-align: start;
      font-family: inherit;
      transition: background var(--transition);
    }
    .decband--urgent .decband__head {
      background: color-mix(in oklch, var(--danger) 6%, var(--bg-ultra-light));
    }

    .decband__mark {
      inline-size: 1.125rem;
      block-size: 1.125rem;
      border-radius: var(--radius-50);
      background: var(--danger);
      color: var(--white);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      flex: none;
    }
    .decband__mark--soft {
      background: var(--neutral-semi-light);
    }

    .decband__title {
      font-size: var(--text-s);
      font-weight: 600;
      color: var(--text-color);
      white-space: nowrap;
    }
    .decband__sub {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-inline-size: 0;
    }
    .decband__count {
      margin-inline-start: auto;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      flex: none;
    }
    .decband__chev {
      color: var(--text-faint);
      transition: transform var(--transition);
      flex: none;
    }
    .decband:not(.decband--open) .decband__chev {
      transform: rotate(-90deg);
    }

    .decband__body {
      padding: var(--space-2xs) var(--space-s) var(--space-s);
    }

    /* ── One decision card ─────────────────────────────────────────── */
    .deccard {
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-l);
      overflow: hidden;
      margin-block-start: var(--space-s);
    }
    .deccard__top {
      display: flex;
      align-items: center;
      gap: var(--space-m);
      padding: var(--space-s) var(--space-m);
      background: color-mix(in oklch, var(--danger) 5%, var(--bg-ultra-light));
      border-block-end: 1px solid var(--border-color-light);
    }
    .deccard--soft .deccard__top {
      background: var(--bg-light);
    }

    .deccard__date {
      text-align: center;
      flex: none;
    }
    .deccard__daynum {
      font-family: var(--font-display);
      font-size: var(--text-xl);
      line-height: 1;
      color: var(--text-color);
    }
    .deccard__dayrow {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      margin-block-start: var(--space-2xs);
    }

    .deccard__q {
      flex: 1;
      min-inline-size: 0;
    }
    .deccard__title {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      font-size: var(--text-s);
      font-weight: 600;
      color: var(--text-color);
    }
    .deccard__mark {
      inline-size: 1.0625rem;
      block-size: 1.0625rem;
      border-radius: var(--radius-50);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      background: var(--danger);
      color: var(--white);
      flex: none;
    }
    .deccard__mark--possible {
      background: var(--bg-ultra-light);
      color: var(--text-muted);
      border: 1px dashed var(--border-color-dark);
    }
    .deccard__reason {
      font-size: var(--text-s);
      color: var(--text-muted);
      margin-block-start: var(--space-2xs);
    }

    .deccard__urg {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--danger);
      border: 1px solid color-mix(in oklch, var(--danger) 35%, var(--border-color-dark));
      border-radius: var(--radius-circle);
      padding: var(--space-2xs) var(--space-s);
      flex: none;
    }

    /* A ─ o ─ B */
    .deccard__vs {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: stretch;
    }
    .deccard__opt {
      padding: var(--space-s) var(--space-m);
    }
    .deccard__tag {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: color-mix(in oklch, var(--c) 45%, var(--text-muted));
      margin-block-end: var(--space-xs);
    }
    .deccard__dot {
      inline-size: 0.4rem;
      block-size: 0.4rem;
      border-radius: var(--radius-50);
      background: var(--c);
      flex: none;
    }
    .deccard__venue {
      font-size: var(--text-m);
      font-weight: 500;
      color: var(--text-color);
    }
    .deccard__city {
      color: var(--text-faint);
      font-weight: 400;
      /* Svelte trims the whitespace between the venue text and this span —
         restore the venue–city gap here (same fix as AgendaList .ag__city). */
      margin-inline-start: var(--space-2xs);
    }
    .deccard__meta {
      display: flex;
      align-items: center;
      gap: var(--space-s);
      font-size: var(--text-s);
      color: var(--text-faint);
      margin-block-start: var(--space-2xs);
    }
    .deccard__hold {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      padding: 1px var(--space-s);
      border-radius: var(--radius-circle);
      border: 1px dashed color-mix(in oklch, var(--c) 40%, var(--border-color-dark));
      color: color-mix(in oklch, var(--c) 45%, var(--text-muted));
    }

    .deccard__mid {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-xs);
      padding-inline: var(--space-s);
      border-inline: 1px solid var(--border-color-light);
      background: var(--bg-light);
      min-inline-size: 7rem;
    }
    .deccard__or {
      font-family: var(--font-display);
      font-style: italic;
      color: var(--text-faint);
    }
    .deccard__tie {
      font-size: var(--text-xs);
      color: color-mix(in oklch, var(--danger) 42%, var(--text-muted));
      text-align: center;
      line-height: 1.35;
    }
    .deccard--soft .deccard__tie {
      color: var(--text-faint);
    }
    .deccard__tie b {
      color: var(--danger);
    }

    /* Buttons — quiet skin, variable-contract friendly. */
    .deccard__btn {
      font-family: inherit;
      font-size: var(--text-s);
      padding: var(--space-xs) var(--space-m);
      border-radius: var(--radius-l);
      border: 1px solid var(--border-color-dark);
      background: var(--bg-ultra-light);
      color: var(--text-muted);
      cursor: pointer;
      transition:
        color var(--transition),
        border-color var(--transition);
    }
    .deccard__btn:hover:not(:disabled) {
      color: var(--text-color);
      border-color: color-mix(in oklch, var(--neutral) 40%, transparent);
    }
    .deccard__btn:disabled {
      opacity: var(--disabled-opacity);
      cursor: default;
    }
    .deccard__btn--pick {
      margin-block-start: var(--space-s);
      inline-size: 100%;
    }
    .deccard__btn--warn {
      color: var(--danger);
      border-color: color-mix(in oklch, var(--danger) 35%, var(--border-color-dark));
    }
    .deccard__btn--warn:hover:not(:disabled) {
      color: var(--danger-dark);
      border-color: var(--danger);
    }
    .deccard__btn--quiet {
      font-size: var(--text-xs);
      padding: var(--space-2xs) var(--space-s);
    }

    .deccard__foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s);
      padding: var(--space-xs) var(--space-m);
      border-block-start: 1px solid var(--border-color-light);
    }
    .deccard__hint {
      font-family: var(--font-display);
      font-style: italic;
      font-size: var(--text-s);
      color: var(--text-faint);
    }

    /* Release follow-up (single focus) */
    .deccard__release {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--space-s);
      padding: var(--space-s) var(--space-m);
    }
    .deccard__release-q {
      font-size: var(--text-s);
      color: var(--text-color);
    }
    .deccard__release-actions {
      display: flex;
      gap: var(--space-s);
    }

    /* ── Concurrences — quiet by design ───────────────────────────── */
    .decband__conc {
      margin-block-start: var(--space-m);
      padding-inline: var(--space-xs);
    }
    .decband__conc-title {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      margin-block-end: var(--space-xs);
    }
    .decband__conc-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-s);
      font-size: var(--text-s);
      color: var(--text-muted);
      padding-block: var(--space-2xs);
    }
    .decband__conc-day {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      min-inline-size: 3.5rem;
    }
    .decband__conc-pair {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
    }
    .decband__conc-sep {
      color: var(--text-faint);
    }

    /* Narrow: options stack, the tie becomes a row divider. */
    @media (max-width: 640px) {
      .deccard__top {
        gap: var(--space-s);
      }
      .deccard__vs {
        grid-template-columns: 1fr;
      }
      .deccard__mid {
        flex-direction: row;
        min-inline-size: 0;
        padding: var(--space-xs) var(--space-m);
        border-inline: none;
        border-block: 1px solid var(--border-color-light);
      }
      .deccard__urg {
        display: none;
      }
    }
  }
</style>
