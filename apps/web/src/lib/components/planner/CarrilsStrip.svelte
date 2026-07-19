<script module lang="ts">
  /**
   * Carrils — the horizontal month ribbon (ADR-080 §7/§8): one lane per
   * espai/projecte, or the Loom (one thread per team person) under Agrupa
   * per Persona. Pure presentation over page-built VMs; day math is % of
   * the month, pixel math (pip row stacking, connector geometry, the
   * center-on-today scroll) happens in ONE measured pass after render —
   * the calPostRender pattern the prototype validated, re-run on resize
   * and font load.
   *
   * Prototype render bugs fixed here by construction:
   * - right-edge label collisions → labels flip side late in the month
   *   AND every pip carries a max-inline-size clamp (ellipsis + full
   *   title), so text can never overflow the strip;
   * - overlapping "fora" pills → in-lane bands and loom outs get lane
   *   assignment (`assignBandLanes`) and stack, growing the row;
   * - axis/person labels clipped at the left edge → the label column is
   *   sticky (position: sticky; left: 0) inside the scroll container, so
   *   it survives horizontal scroll at any width (390px scrolls the strip,
   *   never the page).
   */
  import type { CarrilsGroup } from '$lib/carrils';

  /** One event pip on a lane. */
  export type LanePipVM = {
    id: string;
    /** Day of month, 1-based. */
    day: number;
    kind: 'perf' | 'date' | 'travel';
    /** perf only — solid dot vs dashed-ring dot. */
    state?: 'confirmed' | 'hold';
    label: string;
    /** perf only — mono time after the venue. */
    time?: string | null;
    /** CSS color value (accent var). */
    accent: string;
    /** Full text for the title attr (the clamp's honest exit). */
    title: string;
    href?: string | null;
  };

  /** One quiet in-lane band (prep run / blackout / derived away). */
  export type LaneBandVM = {
    id: string;
    /** Day of month, 1-based, both ends inclusive, pre-clipped. */
    from: number;
    to: number;
    kind: 'prep' | 'blackout' | 'away';
    company?: boolean;
    tentative?: boolean;
    label: string;
    /** prep only — project accent. */
    accent?: string;
    title?: string;
  };

  export type LaneVM = {
    key: string;
    label: string;
    /** CSS color value for the lane dot. */
    accent: string;
    /** Square dot (line-level convention) — espai lanes use round. */
    pips: LanePipVM[];
    bands: LaneBandVM[];
  };

  /** A cross-lane conflict connector (ADR-080 §7). */
  export type ConnectorVM = {
    /** Decision pair id — the band card jump target. */
    id: string;
    /** Day of month, 1-based. */
    day: number;
    aKey: string;
    bKey: string;
    severity: 'people' | 'possible';
    label: string;
  };

  export type LoomSegmentVM = {
    from: number;
    to: number;
    state: 'confirmed' | 'hold' | 'prep';
    accent: string;
    title: string;
  };

  export type LoomThreadVM = {
    person_id: string;
    name: string;
    shared: boolean;
    ghost: boolean;
    segments: LoomSegmentVM[];
    outs: Array<{ from: number; to: number; tentative: boolean }>;
    /** Knot days of month, 1-based. */
    knots: number[];
  };

  export type LoomGroupVM = {
    key: string;
    label: string;
    accent: string;
    threads: LoomThreadVM[];
  };
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import { t, type Locale } from '$lib/i18n';
  import { stackIntervals, isWeekendIso } from '$lib/carrils';

  interface Props {
    /** Ordered ISO days of the visible month. */
    monthDays: string[];
    /** YYYY-MM-DD — paints the "avui" line when inside the month. */
    todayIso: string;
    group: CarrilsGroup;
    lanes: LaneVM[];
    loom: LoomGroupVM[];
    connectors: ConnectorVM[];
    /** Connector gesture — the page opens the decision band at the card. */
    onConnectorJump: (decisionId: string) => void;
    locale: Locale;
  }

  let {
    monthDays,
    todayIso,
    group,
    lanes,
    loom,
    connectors,
    onConnectorJump,
    locale,
  }: Props = $props();

  let nDays = $derived(monthDays.length);
  let todayNum = $derived(
    monthDays.includes(todayIso) ? Number(todayIso.slice(8, 10)) : null,
  );
  /** Past ~68% of the month, labels flip to the left of their dot. */
  let flipAfter = $derived(Math.ceil(nDays * 0.68));

  function center(day: number): number {
    return ((day - 0.5) / nDays) * 100;
  }
  function leftPct(day: number): number {
    return ((day - 1) / nDays) * 100;
  }
  function spanPct(from: number, to: number): number {
    return ((to - from + 1) / nDays) * 100;
  }

  /** Pip placement + overflow clamp — flipped pips grow leftwards. */
  function pipStyle(pip: LanePipVM): string {
    const c = center(pip.day);
    const flip = pip.day > flipAfter;
    const pos = flip
      ? `right: ${100 - c}%; max-inline-size: ${Math.max(c - 1, 4)}%;`
      : `left: ${c}%; max-inline-size: ${Math.max(100 - c - 1, 4)}%;`;
    return `--c: ${pip.accent}; ${pos}`;
  }

  /** Stacked rows for a lane's bands (kept pure — ISO-free day ints). */
  function bandRows(bands: LaneBandVM[]): { rows: number[]; rowCount: number } {
    return stackIntervals(bands.map((b) => ({ start: b.from, end: b.to + 0.5 })));
  }
  function outRows(outs: Array<{ from: number; to: number }>): {
    rows: number[];
    rowCount: number;
  } {
    return stackIntervals(outs.map((o) => ({ start: o.from, end: o.to + 0.5 })));
  }

  // ── Measured pass (the calPostRender pattern) ────────────────────────
  // Pip x-extents depend on rendered text, so row stacking and connector
  // geometry are pixel work: measure, assign tops, grow tracks, place
  // connectors, then (once) scroll today into the center.
  let rootEl = $state<HTMLElement | null>(null);
  let lanesEl = $state<HTMLElement | null>(null);
  let scrolledOnce = false;

  const PIP_ROW_H = 20;
  const PIP_TOP = 6;
  const BAND_ROW_H = 17;

  function layout() {
    const root = rootEl;
    const wrap = lanesEl;
    if (!root || !wrap) return;

    for (const track of wrap.querySelectorAll<HTMLElement>('[data-pip-track]')) {
      const pips = [...track.querySelectorAll<HTMLElement>('[data-pip]')];
      const tr = track.getBoundingClientRect();
      const { rows, rowCount } = stackIntervals(
        pips.map((p) => {
          const r = p.getBoundingClientRect();
          return { start: r.left - tr.left, end: r.right - tr.left };
        }),
        6,
      );
      pips.forEach((p, i) => {
        p.style.top = `${PIP_TOP + rows[i] * PIP_ROW_H}px`;
      });
      const bandCount = Number(track.dataset.bandRows ?? '0');
      const h = PIP_TOP + Math.max(rowCount, 1) * PIP_ROW_H + 6 + bandCount * BAND_ROW_H + 4;
      track.style.blockSize = `${Math.max(h, 58)}px`;
    }

    // Connectors: x from the day, y from the two lanes' track centres —
    // same offsetParent (the lanes wrap), so offsets compose directly.
    const labW = wrap.querySelector<HTMLElement>('[data-lane-label]')?.offsetWidth ?? 0;
    const trackW = wrap.clientWidth - labW;
    for (const conn of wrap.querySelectorAll<HTMLElement>('[data-connector]')) {
      const a = wrap.querySelector<HTMLElement>(
        `[data-lane-key="${CSS.escape(conn.dataset.a ?? '')}"] [data-pip-track]`,
      );
      const b = wrap.querySelector<HTMLElement>(
        `[data-lane-key="${CSS.escape(conn.dataset.b ?? '')}"] [data-pip-track]`,
      );
      if (!a || !b) {
        conn.style.display = 'none';
        continue;
      }
      const wrapTop = wrap.getBoundingClientRect().top;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const y0 = ra.top - wrapTop + ra.height / 2;
      const y1 = rb.top - wrapTop + rb.height / 2;
      conn.style.display = '';
      conn.style.left = `${labW + (center(Number(conn.dataset.day)) / 100) * trackW}px`;
      conn.style.top = `${Math.min(y0, y1)}px`;
      conn.style.blockSize = `${Math.abs(y1 - y0)}px`;
    }

    // Scroll affordance + one-time centring of today (55% like the mock).
    const overflows = root.scrollWidth > root.clientWidth + 4;
    root.classList.toggle('strip--scrolls', overflows);
    if (overflows && !scrolledOnce && todayNum !== null) {
      scrolledOnce = true;
      const inner = root.firstElementChild as HTMLElement | null;
      if (inner) {
        const w = inner.getBoundingClientRect().width - labW;
        root.scrollLeft = Math.max(0, labW + (center(todayNum) / 100) * w - root.clientWidth * 0.55);
      }
    }
  }

  $effect(() => {
    // Re-run whenever the rendered data changes …
    void lanes;
    void loom;
    void connectors;
    void group;
    void nDays;
    let cancelled = false;
    void tick().then(() => {
      if (!cancelled) layout();
    });
    return () => {
      cancelled = true;
    };
  });
  $effect(() => {
    // … and on the pixel-level triggers: resize and font swap.
    const rerun = () => layout();
    window.addEventListener('resize', rerun);
    document.fonts?.ready.then(rerun).catch(() => {});
    return () => window.removeEventListener('resize', rerun);
  });

  let axisLabel = $derived(t(`planner.group_${group}`, locale));
</script>

<div class="strip" bind:this={rootEl}>
  <div class="strip__inner">
    <p class="strip__hint" aria-hidden="true">{t('planner.carrils_hint', locale)}</p>

    {#if group === 'persona'}
      <!-- Loom legend (ADR-080 §8) — the five words the threads speak. -->
      <div class="strip__legend">
        <span class="strip__leg"><i class="strip__leg-th strip__leg-th--avail"></i>{t('planner.loom_available', locale)}</span>
        <span class="strip__leg"><i class="strip__leg-th strip__leg-th--commit"></i>{t('planner.loom_commitment', locale)}</span>
        <span class="strip__leg"><i class="strip__leg-th strip__leg-th--hold"></i>{t('planner.loom_hold', locale)}</span>
        <span class="strip__leg"><i class="strip__leg-th strip__leg-th--out"></i>{t('planner.loom_out', locale)}</span>
        <span class="strip__leg"><i class="strip__leg-th strip__leg-th--knot"></i>{t('planner.loom_knot', locale)}</span>
      </div>
    {/if}

    <div class="strip__axis">
      <span class="strip__lab strip__lab--axis" data-lane-label>{axisLabel}</span>
      <span class="strip__axtrack">
        {#each monthDays as iso (iso)}
          {@const d = Number(iso.slice(8, 10))}
          <span
            class="strip__daynum"
            class:strip__daynum--we={isWeekendIso(iso)}
            class:strip__daynum--today={iso === todayIso}
            style="left: {center(d)}%">{d}</span
          >
        {/each}
        {#if todayNum !== null}
          <span class="strip__now-label" style="left: {center(todayNum)}%"
            >{t('calendar.today', locale)}</span
          >
        {/if}
      </span>
    </div>

    <div class="strip__lanes" bind:this={lanesEl}>
      <div class="strip__bg" aria-hidden="true">
        {#each monthDays as iso (iso)}
          {#if isWeekendIso(iso)}
            <span
              class="strip__we"
              style="left: {leftPct(Number(iso.slice(8, 10)))}%; inline-size: {100 / nDays}%"
            ></span>
          {/if}
        {/each}
        {#if todayNum !== null}
          <span class="strip__now" style="left: {center(todayNum)}%"></span>
        {/if}
      </div>

      {#if group === 'persona'}
        {#each loom as grp (grp.key)}
          <div class="strip__grp">
            <span class="strip__grp-name" style="--c: {grp.accent}">
              <i class="strip__grp-sq" aria-hidden="true"></i>{grp.label}
            </span>
          </div>
          {#each grp.threads as th (th.person_id)}
            {@const outLanes = outRows(th.outs)}
            <div class="strip__lane strip__lane--thread">
              <span
                class="strip__lab strip__lab--person"
                class:strip__lab--shared={th.shared}
                class:strip__lab--ghost={th.ghost}
                data-lane-label
              >
                <span class="strip__lab-name">{th.name}</span>
                {#if th.ghost}
                  <span class="strip__badge">{t('planner.loom_no_data', locale)}</span>
                {:else if th.shared}
                  <span class="strip__badge">{t('planner.loom_shared', locale)}</span>
                {/if}
              </span>
              <span
                class="strip__track strip__track--thread"
                style="block-size: {32 + Math.max(outLanes.rowCount - 1, 0) * 22}px"
              >
                <i class="strip__thread" class:strip__thread--ghost={th.ghost} aria-hidden="true"
                ></i>
                {#each th.segments as seg, i (`${seg.from}-${seg.state}-${seg.accent}-${i}`)}
                  <i
                    class="strip__seg strip__seg--{seg.state}"
                    style="--c: {seg.accent}; left: {leftPct(seg.from)}%; inline-size: {spanPct(
                      seg.from,
                      seg.to,
                    )}%"
                    title={seg.title}
                  ></i>
                {/each}
                {#each th.outs as o, i (`${o.from}-${o.to}-${i}`)}
                  <span
                    class="strip__out"
                    class:strip__out--tent={o.tentative}
                    style="left: {leftPct(o.from)}%; inline-size: {spanPct(o.from, o.to)}%; margin-block-start: {outLanes.rows[i] * 22}px"
                    >{o.tentative
                      ? t('planner.loom_out_short_t', locale)
                      : t('planner.loom_out_short', locale)}</span
                  >
                {/each}
                {#each th.knots as day (day)}
                  <i class="strip__knot" style="left: {center(day)}%" aria-hidden="true"></i>
                  <span class="strip__kflag" style="left: {center(day)}%"
                    >{t('planner.loom_knot_flag', locale, { day })}</span
                  >
                {/each}
              </span>
            </div>
          {/each}
        {/each}
        {#if loom.length === 0}
          <p class="strip__empty">{t('calendar.empty_month', locale)}</p>
        {/if}
      {:else}
        {#each lanes as lane (lane.key)}
          {@const bands = bandRows(lane.bands)}
          <div class="strip__lane" data-lane-key={lane.key}>
            <span class="strip__lab" data-lane-label>
              <i
                class="strip__dot"
                class:strip__dot--sq={group === 'projecte'}
                style="--c: {lane.accent}"
                aria-hidden="true"
              ></i>
              <span class="strip__lab-name" title={lane.label}>{lane.label}</span>
            </span>
            <span class="strip__track" data-pip-track data-band-rows={bands.rowCount}>
              {#each lane.bands as band, i (band.id)}
                <span
                  class="strip__band strip__band--{band.kind}"
                  class:strip__band--company={band.company}
                  class:strip__band--tent={band.tentative}
                  style="{band.accent ? `--c: ${band.accent};` : ''} left: {leftPct(
                    band.from,
                  )}%; inline-size: {spanPct(band.from, band.to)}%; bottom: {4 +
                    bands.rows[i] * BAND_ROW_H}px"
                  title={band.title ?? band.label}>{band.label}</span
                >
              {/each}
              {#each lane.pips as pip (pip.id)}
                <span
                  class="strip__pip strip__pip--{pip.kind}"
                  class:strip__pip--hold={pip.state === 'hold'}
                  class:strip__pip--flip={pip.day > flipAfter}
                  style={pipStyle(pip)}
                  data-pip
                  title={pip.title}
                >
                  {#if pip.kind !== 'travel'}
                    <i class="strip__pip-dot" aria-hidden="true"></i>
                  {/if}
                  {#if pip.href}
                    <a class="strip__pip-lab" href={pip.href}
                      >{pip.label}{#if pip.time}<i class="strip__pip-time"> {pip.time}</i>{/if}</a
                    >
                  {:else}
                    <span class="strip__pip-lab"
                      >{pip.label}{#if pip.time}<i class="strip__pip-time"> {pip.time}</i>{/if}</span
                    >
                  {/if}
                </span>
              {/each}
            </span>
          </div>
        {/each}
        {#if lanes.length === 0}
          <p class="strip__empty">{t('calendar.empty_month', locale)}</p>
        {/if}
        {#each connectors as c (c.id)}
          <button
            type="button"
            class="strip__conn"
            class:strip__conn--possible={c.severity === 'possible'}
            data-connector
            data-a={c.aKey}
            data-b={c.bKey}
            data-day={c.day}
            aria-label={c.label}
            title={c.label}
            onclick={() => onConnectorJump(c.id)}
          ></button>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  @layer components {
    /* The strip scrolls horizontally as a whole; the page never does. */
    .strip {
      --strip-label-w: 9.5rem;
      overflow-x: auto;
      scrollbar-width: thin;
    }
    .strip__inner {
      min-inline-size: 47.5rem;
    }
    .strip__hint {
      display: none;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      text-align: end;
      padding-block-end: var(--space-2xs);
    }
    :global(.strip--scrolls) .strip__hint {
      display: block;
    }

    /* ── Sticky label column — labels never clip, never scroll away. ── */
    .strip__lab {
      position: sticky;
      left: 0;
      z-index: 7;
      flex: 0 0 var(--strip-label-w);
      inline-size: var(--strip-label-w);
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      padding-inline-end: var(--space-s);
      background: var(--bg);
      font-size: var(--text-s);
      color: var(--text-color);
      min-inline-size: 0;
    }
    .strip__lab-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .strip__lab--axis {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      align-items: flex-end;
      padding-block-end: var(--space-2xs);
    }
    .strip__dot {
      inline-size: 0.5625rem;
      block-size: 0.5625rem;
      border-radius: var(--radius-50);
      background: var(--c);
      flex: none;
    }
    .strip__dot--sq {
      border-radius: var(--radius-s);
    }

    .strip__axis {
      display: flex;
      border-block-end: 1px solid var(--border-color-light);
    }
    .strip__axtrack {
      position: relative;
      flex: 1;
      block-size: 2.25rem;
      min-inline-size: 0;
    }
    .strip__daynum {
      position: absolute;
      bottom: var(--space-2xs);
      transform: translateX(-50%);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .strip__daynum--we {
      color: var(--text-faint);
    }
    .strip__daynum--today {
      color: var(--info);
      font-weight: 500;
    }
    .strip__now-label {
      position: absolute;
      top: 0;
      transform: translateX(-50%);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: lowercase;
      color: var(--info);
    }

    .strip__lanes {
      position: relative;
    }
    .strip__bg {
      position: absolute;
      inset-block: 0;
      left: var(--strip-label-w);
      right: 0;
      z-index: 0;
      pointer-events: none;
    }
    .strip__we {
      position: absolute;
      inset-block: 0;
      background: color-mix(in oklch, var(--neutral) 6%, transparent);
    }
    .strip__now {
      position: absolute;
      inset-block: 0;
      inline-size: 1.5px;
      background: var(--info);
      z-index: 4;
    }

    .strip__lane {
      display: flex;
      border-block-end: 1px solid var(--border-color-light);
      position: relative;
      z-index: 1;
    }
    .strip__track {
      position: relative;
      flex: 1;
      block-size: 3.625rem;
      min-inline-size: 0;
    }

    /* ── Pips — the chip grammar at ribbon scale. ─────────────────────── */
    .strip__pip {
      position: absolute;
      top: 6px;
      display: flex;
      align-items: center;
      gap: var(--space-2xs);
      white-space: nowrap;
      z-index: 3;
      min-inline-size: 0;
    }
    .strip__pip--flip {
      flex-direction: row-reverse;
    }
    .strip__pip-dot {
      inline-size: 0.75rem;
      block-size: 0.75rem;
      border-radius: var(--radius-50);
      background: var(--c);
      flex: none;
      box-shadow: 0 0 0 3px color-mix(in oklch, var(--c) 18%, transparent);
    }
    .strip__pip--hold .strip__pip-dot {
      background: var(--bg);
      border: 2px dashed var(--c);
      box-shadow: none;
    }
    .strip__pip--date .strip__pip-dot {
      inline-size: 0.5rem;
      block-size: 0.5rem;
      box-shadow: none;
    }
    .strip__pip-lab {
      font-size: var(--text-xs);
      font-weight: 500;
      color: var(--text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-inline-size: 0;
      text-decoration: none;
    }
    a.strip__pip-lab:hover {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .strip__pip--hold .strip__pip-lab {
      font-weight: 400;
      color: var(--text-muted);
    }
    .strip__pip-time {
      font-style: normal;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
    }
    .strip__pip--date .strip__pip-lab,
    .strip__pip--travel .strip__pip-lab {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-weight: 400;
      text-transform: uppercase;
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-muted);
    }
    .strip__pip--travel .strip__pip-lab {
      color: color-mix(in oklch, var(--c) 50%, var(--text-muted));
    }

    /* ── In-lane quiet bands: prep hatched accent, blackout person/company,
       derived away dotted (quieter than everything). Modifiers redeclare
       the --band-* contract, never the properties. ────────────────────── */
    .strip__band {
      --band-bg: transparent;
      --band-fg: var(--text-muted);
      --band-border: transparent;
      position: absolute;
      block-size: 0.875rem;
      border-radius: var(--radius-circle);
      font-family: var(--font-mono);
      font-size: 0.5625rem;
      letter-spacing: var(--mono-letter-spacing);
      text-transform: uppercase;
      display: flex;
      align-items: center;
      padding-inline: var(--space-xs);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      background: var(--band-bg);
      color: var(--band-fg);
      border: 1px solid var(--band-border);
      z-index: 2;
    }
    .strip__band--prep {
      --band-bg: repeating-linear-gradient(
        135deg,
        color-mix(in oklch, var(--c) 13%, transparent) 0 6px,
        transparent 6px 12px
      );
      --band-border: color-mix(in oklch, var(--c) 30%, var(--border-color-light));
      --band-fg: color-mix(in oklch, var(--c) 45%, var(--text-muted));
      border-radius: var(--radius-s);
    }
    .strip__band--blackout {
      --band-bg: color-mix(in oklch, var(--info) 13%, transparent);
      --band-fg: color-mix(in oklch, var(--info) 45%, var(--text-muted));
    }
    .strip__band--blackout.strip__band--company {
      --band-bg: color-mix(in oklch, var(--neutral) 10%, transparent);
      --band-fg: var(--text-muted);
    }
    .strip__band--blackout.strip__band--tent {
      --band-bg: repeating-linear-gradient(
        135deg,
        color-mix(in oklch, var(--info) 11%, transparent) 0 5px,
        transparent 5px 10px
      );
      --band-border: var(--border-color-light);
      border-style: dashed;
    }
    .strip__band--away {
      --band-bg: transparent;
      --band-fg: var(--text-faint);
      --band-border: var(--border-color-dark);
      border-style: dotted;
    }

    /* ── Cross-lane conflict connector (ADR-080 §7) ───────────────────── */
    .strip__conn {
      position: absolute;
      inline-size: 3px;
      padding: 0;
      border: none;
      border-radius: var(--radius-s);
      background: var(--danger);
      cursor: pointer;
      z-index: 5;
    }
    .strip__conn::before,
    .strip__conn::after {
      content: '!';
      position: absolute;
      left: 50%;
      transform: translate(-50%, -50%);
      inline-size: 1rem;
      block-size: 1rem;
      border-radius: var(--radius-50);
      background: var(--danger);
      color: var(--white);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-mono);
      font-size: 0.5625rem;
    }
    .strip__conn::before {
      top: 0;
    }
    .strip__conn::after {
      top: 100%;
    }
    .strip__conn--possible {
      background: var(--neutral-semi-light);
    }
    .strip__conn--possible::before,
    .strip__conn--possible::after {
      content: '?';
      background: var(--bg-ultra-light);
      color: var(--text-muted);
      border: 1px dashed var(--border-color-dark);
    }

    /* ── The Loom (Agrupa per Persona) ────────────────────────────────── */
    .strip__legend {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs) var(--space-m);
      padding-block-end: var(--space-s);
      position: sticky;
      left: 0;
      inline-size: fit-content;
    }
    .strip__leg {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .strip__leg-th {
      inline-size: 1.875rem;
      block-size: 0.5625rem;
      border-radius: var(--radius-circle);
      flex: none;
    }
    .strip__leg-th--avail {
      block-size: 2px;
      background: var(--border-color-dark);
    }
    .strip__leg-th--commit {
      background: var(--neutral);
    }
    .strip__leg-th--hold {
      block-size: 0.5rem;
      background: repeating-linear-gradient(
        90deg,
        var(--neutral) 0 5px,
        transparent 5px 9px
      );
    }
    .strip__leg-th--out {
      block-size: 0.875rem;
      border-radius: var(--radius-s);
      background: repeating-linear-gradient(
        135deg,
        color-mix(in oklch, var(--info) 14%, transparent) 0 4px,
        transparent 4px 8px
      );
      border: 1px dashed var(--border-color-dark);
    }
    .strip__leg-th--knot {
      inline-size: 0.875rem;
      block-size: 0.875rem;
      border-radius: var(--radius-50);
      background: var(--bg-ultra-light);
      border: 2.5px solid var(--danger);
    }

    .strip__grp {
      display: flex;
      border-block-start: 1px solid var(--border-color-light);
      padding-block: var(--space-xs) var(--space-2xs);
      position: relative;
      z-index: 1;
    }
    .strip__grp:first-of-type {
      border-block-start: none;
    }
    .strip__grp-name {
      position: sticky;
      left: 0;
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      background: var(--bg);
      padding-inline-end: var(--space-s);
    }
    .strip__grp-sq {
      inline-size: 0.5625rem;
      block-size: 0.5625rem;
      border-radius: var(--radius-s);
      background: var(--c);
      flex: none;
    }

    .strip__lane--thread {
      border-block-end: none;
    }
    .strip__lab--person {
      font-size: var(--text-s);
      color: var(--text-muted);
    }
    .strip__lab--shared {
      color: var(--text-color);
      font-weight: 500;
    }
    .strip__lab--ghost {
      color: var(--text-faint);
      font-style: italic;
    }
    .strip__badge {
      font-family: var(--font-mono);
      font-size: 0.5rem;
      letter-spacing: var(--mono-letter-spacing);
      text-transform: uppercase;
      color: var(--text-faint);
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-circle);
      padding: 1px var(--space-xs);
      flex: none;
    }

    .strip__thread {
      position: absolute;
      top: 50%;
      left: 0;
      right: 0;
      block-size: 2px;
      transform: translateY(-50%);
      background: var(--border-color-dark);
    }
    .strip__thread--ghost {
      background: repeating-linear-gradient(
        90deg,
        var(--border-color-dark) 0 4px,
        transparent 4px 8px
      );
    }
    .strip__seg {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      block-size: 0.5625rem;
      border-radius: var(--radius-circle);
      background: var(--c);
      min-inline-size: 0.5rem;
    }
    .strip__seg--hold {
      background: repeating-linear-gradient(90deg, var(--c) 0 5px, transparent 5px 9px);
      block-size: 0.5rem;
    }
    .strip__seg--prep {
      opacity: 0.5;
    }
    .strip__out {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      block-size: 1.25rem;
      border-radius: var(--radius-s);
      background: color-mix(in oklch, var(--info) 12%, transparent);
      border: 1px dashed color-mix(in oklch, var(--info) 30%, var(--border-color-light));
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-mono);
      font-size: 0.5rem;
      letter-spacing: var(--mono-letter-spacing);
      text-transform: uppercase;
      color: color-mix(in oklch, var(--info) 45%, var(--text-muted));
      overflow: hidden;
      white-space: nowrap;
      z-index: 2;
    }
    .strip__out--tent {
      background: repeating-linear-gradient(
        135deg,
        color-mix(in oklch, var(--info) 12%, transparent) 0 5px,
        transparent 5px 10px
      );
    }
    .strip__knot {
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%);
      inline-size: 1rem;
      block-size: 1rem;
      border-radius: var(--radius-50);
      background: var(--bg-ultra-light);
      border: 2.5px solid var(--danger);
      z-index: 5;
    }
    .strip__knot::after {
      content: '';
      position: absolute;
      inset: 3px;
      border-radius: var(--radius-50);
      background: var(--danger);
    }
    .strip__kflag {
      position: absolute;
      top: 1px;
      transform: translateX(-50%);
      font-family: var(--font-mono);
      font-size: 0.5rem;
      letter-spacing: var(--mono-letter-spacing);
      text-transform: uppercase;
      color: var(--danger);
      white-space: nowrap;
      z-index: 6;
    }

    .strip__empty {
      padding-block: var(--space-l);
      font-size: var(--text-s);
      color: var(--text-faint);
      font-style: italic;
    }
  }
</style>
