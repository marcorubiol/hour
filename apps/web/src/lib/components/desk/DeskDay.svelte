<script lang="ts">
  /**
   * THE DAY, Hoy's first block (ADR-202 § 2 to § 5, ADR-203 § 2 and § 4): the
   * one filled surface of the screen, with the day's agenda inside it.
   *
   *   ┌ MMI Lo siguiente ─────────────────────┐
   *   │ MaMeMi                            16h │  whose and its hour, one size
   *   │ Prensa · Ràdio Girona       en 2 h 10 │  what, where, and the countdown
   *   │ ───────────────────────────────────── │
   *   │ 10h   Ensayo · Sala 2                 │  the day, gone by dimmed
   *   │ 16h   Prensa · Ràdio Girona           │  the focus marked
   *   └───────────────────────────────────────┘
   *
   * TWO OR MORE PERFORMANCES TODAY, none weighs more (ADR-207): the headline
   * is their project, or «2 funciones»; every hour on the right at one size
   * («12h · 21h»), and under it when the first starts. The rows lose the
   * focus's weight and, with several projects, a show's row says whose.
   *
   * Doing something, the big hour is until when («→ 17h») and under it how
   * much is left. ON A GIG DAY it opens with what Ahora used to show
   * (ADR-146, that mode is gone): the venue's contact, the load, the hotel,
   * who goes, and Llamar, Mapa and Hoja across the whole width, for the
   * thumb. The rest of Ahora (the past of the running order, the legs with
   * their booking codes, the details, the board) is behind «Hoja».
   *
   * TODAY IS ALWAYS THE BIG PIECE (§ 3): with nothing left of it, the piece
   * stays in its place, hollow, says so and names what comes next, even when
   * that is also a tile of «Coming up».
   *
   * The truth is `$lib/day-agenda` (the pulse's rows, Ahora's headline rule);
   * this file words and draws. It follows the scope (§ 13): the page hands it
   * the scoped rows, and the line under it counts what of yours stays out.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import Button from '$lib/components/Button.svelte';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import MapLink from '$lib/components/MapLink.svelte';
  import { dualTime, hourMark, localeDayMonth, localeWeekdayShort } from '$lib/datetime';
  import { LOCALE_TAG, t, tradeFor, type Locale, type Voice } from '$lib/i18n';
  import { holdDeadlineLabel } from '$lib/performance';
  import { dayKeyInTz, statusWord } from '$lib/planner';
  import { momentWordKey, perfWorkspaceId, type DateEvent, type PerformanceEvent, type ProjectLite, type SlipContext, type SlipKind } from '$lib/month-events';
  import { stagePlace } from '$lib/travel-stage';
  import { timedStages, type PulseNext } from '$lib/pulse';
  import type { AgendaPoint, DayAgenda } from '$lib/day-agenda';
  import { nextWhen, piecePerformance, rowsSayCity, showsDay, yourStop } from '$lib/hoy';
  import { plusDays } from '$lib/set-aside';
  import { countdownParts, freshnessShown, logisticsLines, mapsHref, minutesTo, telHref, venueCall } from '$lib/ahora';
  import { ahoraRoadsheetQuery, roleFor, type AhoraRoadsheet } from '$lib/ahora-feeds.svelte';
  import { teamQueryOptions } from '$lib/nav-queries';
  import type { NavWorkspace } from '$lib/nav';
  import { pulseSlip } from '$lib/pulse-feeds.svelte';
  import { accentVarFor } from '$lib/utils/accent';

  interface Props {
    /** Today in order, with its focus (`dayAgenda`); null with nothing left of today. */
    agenda: DayAgenda | null;
    /** Today had something, all of it gone by: «Hoy, nada más en la agenda». */
    todayHad?: boolean;
    /** The first thing after today, however far: what the hollow piece names. */
    next?: PulseNext | null;
    /** «1 más hoy fuera de MaMeMi» (ADR-202 § 14), or null. */
    outside?: string | null;
    /** The line is a door: it takes the scope off (the frame's field), so
        what it counts comes into view. Without it, the line is only said. */
    onclearscope?: () => void;
    settled: boolean;
    errored: boolean;
    onretry: () => void;
    today: string;
    viewerTz: string;
    /** The viewer's clock (the page's minute tick). */
    now: Date;
    /** When the pulse's feeds last answered (ms), for the freshness line. */
    updatedAt?: number | null;
    /** New messages on the board of the piece's performance, 0 without. */
    boardNew?: number;
    slipCtx: SlipContext;
    /** For the road sheet's role (the preloaded cut, ADR-146 § 6). */
    workspaces: readonly NavWorkspace[];
    /** The viewer's person (`/api/me`): «tu hora» when the list names them (ADR-234). */
    me?: string | null;
    locale: Locale;
  }

  let {
    agenda,
    todayHad = false,
    next = null,
    outside = null,
    onclearscope,
    settled,
    errored,
    onretry,
    today,
    viewerTz,
    now,
    updatedAt = null,
    boardNew = 0,
    slipCtx,
    workspaces,
    me = null,
    locale,
  }: Props = $props();

  const kindLabel = (kind: SlipKind, voice?: Voice) => t(`planner.kind_${kind}`, locale, undefined, voice);
  const cap = (s: string) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);
  const hour = (iso: string, tz: string | null) => hourMark(dualTime(iso, tz, viewerTz).primary);
  const nbsp = (s: string) => s.replace(/ /g, ' ');
  /** «1 h 20 min», one figure that never breaks. */
  function duration(minutes: number): string {
    const { h, m } = countdownParts(minutes);
    return nbsp(h === 0 ? t('desk.dur_min', locale, { m }) : m === 0 ? t('desk.dur_h', locale, { h }) : t('desk.dur_hm', locale, { h, m }));
  }
  function inWords(minutes: number): string {
    const { h, m } = countdownParts(minutes);
    return nbsp(h === 0 ? t('ahora.in_min', locale, { m }) : m === 0 ? t('ahora.in_h', locale, { h }) : t('ahora.in_hm', locale, { h, m }));
  }

  /** What a point IS, in the house words: the moment, the mode, the kind. */
  function word(p: AgendaPoint): string {
    const w = p.what;
    if (w.of === 'stage') return t(`planner.mode_${w.mode}`, locale);
    if (w.of === 'date') return w.label || kindLabel((['show', 'rehearsal', 'residency', 'travel_day', 'press', 'day_off'].includes(w.kind) ? w.kind : 'other') as SlipKind);
    if (w.label) return w.label;
    return w.key ? t(momentWordKey(w.key), locale, undefined, tradeFor(perfWorkspaceId(p.ref.row))) : '';
  }
  /** Where a point is, small: the venue and city, a stage's route, a date's place.
   *  `city: false` leaves the city out (the day's rows in one city, `rowsSayCity`). */
  function placeParts(p: AgendaPoint, city = true): string[] {
    const w = p.what;
    const some = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => Boolean(x));
    if (w.of === 'stage') {
      const route = [stagePlace(w.stage.from_city, w.stage.from_place), stagePlace(w.stage.to_city, w.stage.to_place)].filter(Boolean).join(' → ');
      return some([route, w.stage.arrive_at ? t('ahora.arrives', locale, { time: hour(w.stage.arrive_at, w.stage.arrive_tz ?? p.tz) }) : null]);
    }
    const sl = pulseSlip(p.ref, agenda?.day ?? today, slipCtx);
    const title = p.ref.of === 'date' ? (p.ref.row as DateEvent).title : null;
    return some([title && title !== word(p) ? title : null, sl.name !== title ? sl.name : null, city && sl.city && sl.city !== sl.name ? sl.city : null]);
  }
  const place = (p: AgendaPoint, city = true) => placeParts(p, city).join(' · ');
  /* A hold says what it is in the house word («1.ª opción · vence lun»). */
  function holdLabel(p: AgendaPoint): string | null {
    const sl = pulseSlip(p.ref, agenda?.day ?? today, slipCtx);
    if (sl.cert !== 'hold' || !sl.hold) return null;
    const rank = statusWord(sl.hold.rank ? `hold_${sl.hold.rank}` : 'hold', locale);
    return sl.hold.expires ? `${rank} · ${holdDeadlineLabel(sl.hold.expires, today, locale, LOCALE_TAG[locale], true)}` : rank;
  }

  let focus = $derived(agenda && agenda.focus !== null ? agenda.points[agenda.focus] : null);
  let doing = $derived(agenda?.headline === 'doing');
  /** Two or more performances today (ADR-207), else null: the focus speaks. */
  let shows = $derived(agenda ? showsDay(agenda) : null);
  /* THE HOUR AT THE SIZE OF THE THING (ADR-202 § 4, ADR-207): whose on the
     left (the project; without one, the venue, else the city), its hour on
     the right; doing something, until when. The word of the moment goes
     down to the second line, with its «?» and where. */
  let lead = $derived.by(() => {
    if (!focus) return { what: '', sub: [] as string[] };
    const w = cap(word(focus)) + (focus.ref.tentative ? '?' : '');
    const parts = placeParts(focus);
    const name = focus.ref.row.project?.name;
    if (name) return { what: name, sub: [w, ...parts] };
    const sl = focus.ref.of === 'performance' ? pulseSlip(focus.ref, agenda?.day ?? today, slipCtx) : null;
    const by = sl ? sl.name || sl.city || '' : '';
    return by ? { what: by, sub: [w, ...parts.filter((x) => x !== by)] } : { what: w, sub: parts };
  });
  let what = $derived(lead.what);
  let at = $derived.by(() => {
    if (!focus) return '';
    if (doing && agenda?.until) return `→ ${hour(agenda.until, focus.tz)}`;
    return focus.at ? hour(focus.at, focus.tz) : t('planner.all_day', locale);
  });
  /* The second line: what and where, and how long (the countdown, or what is left). */
  let where = $derived(focus ? [...lead.sub, holdLabel(focus)].filter(Boolean).join(' · ') : '');
  let left = $derived.by(() => {
    if (!focus) return '';
    if (doing) return agenda?.until ? t('desk.piece_left', locale, { dur: duration(minutesTo(agenda.until, now)) }) : '';
    return focus.at ? inWords(minutesTo(focus.at, now)) : '';
  });
  /* The rows say their city only when the day goes through more than one:
     with one, the line under the title already says it. A leg is a route. */
  let rowsCity = $derived.by(() => {
    const a = agenda;
    if (!a) return false;
    return rowsSayCity(a.points.filter((p) => p.what.of !== 'stage').map((p) => pulseSlip(p.ref, a.day, slipCtx).city));
  });
  /* SEVERAL SHOWS (ADR-207): the headline is the day, not one of them. */
  /** The shows speak their spaces' trade (ADR-199): one, its own; several, the neutral word. */
  let showsVoice = $derived.by((): Voice => {
    const voices = new Set((shows?.shows ?? []).map((p) => tradeFor(perfWorkspaceId(p.ref.row))));
    return voices.size === 1 ? [...voices][0] : 'mixed';
  });
  /** «2 funciones», «2 shows». */
  const showsCount = (s: NonNullable<typeof shows>) => t('desk.shows_n', locale, { n: s.shows.length }, showsVoice);
  let showsWhat = $derived(shows ? (shows.oneProject ? shows.shows[0].ref.row.project!.name : showsCount(shows)) : '');
  let showsAt = $derived(
    shows ? shows.hours.map((p) => hour(p.at!, p.tz)).join(shows.shows.length > 2 ? ' … ' : ' · ') || t('planner.all_day', locale) : '',
  );
  let showsWhere = $derived.by(() => {
    const s = shows;
    if (!s || !agenda) return '';
    const cities = new Set(s.shows.map((p) => pulseSlip(p.ref, agenda.day, slipCtx).city).filter(Boolean));
    return [s.oneProject ? showsCount(s) : null, ...cities].filter(Boolean).join(' · ');
  });
  let showsLeft = $derived.by(() => {
    const s = shows;
    if (!s) return '';
    if (s.on) return agenda?.until ? t('desk.shows_on_until', locale, { time: hour(agenda.until, s.on.tz) }) : t('desk.shows_on', locale);
    const m = s.ahead?.at ? minutesTo(s.ahead.at, now) : 0;
    return m > 0 ? t(s.begun ? 'desk.shows_next' : 'desk.shows_first', locale, { dur: duration(m) }, showsVoice) : '';
  });
  let eye = $derived(
    shows ? (shows.on ? t('ahora.title', locale) : cap(t('desk.next_today', locale))) : focus ? t(doing ? 'ahora.title' : 'desk.band_next', locale) : '',
  );
  /** The overline's monogram: the focus's project, or the one project of the day's shows. */
  let eyeProject = $derived(shows ? (shows.oneProject ? shows.shows[0].ref.row.project : null) : focus?.ref.row.project);

  /* The piece's actions and facts are the performance's (`piecePerformance`):
     the focus when it is one, else the day's main event (on the train, the
     venue is where you are going); with several, the one on or next. */
  let actionPoint = $derived(agenda ? piecePerformance(agenda) : null);
  let actionPerf = $derived(actionPoint ? (actionPoint.ref.row as PerformanceEvent) : null);
  let actionSlip = $derived(actionPoint && agenda ? pulseSlip(actionPoint.ref, agenda.day, slipCtx) : null);
  /** A gig day: the day has a performance (its main event). */
  let gig = $derived(Boolean(agenda?.points.some((p) => p.main)));
  // The road sheet the /h frame preloads for today and tomorrow (ADR-146 § 3): one cache, no new read.
  const sheetQuery = createQuery(
    toStore(() => ({
      ...ahoraRoadsheetQuery(actionPerf?.id ?? '', actionPerf ? roleFor(actionPerf, workspaces) : 'full'),
      enabled: Boolean(actionPerf),
    })),
  );
  let sheet = $derived(actionPerf ? (($sheetQuery.data as AhoraRoadsheet | undefined)?.roadsheet ?? null) : null);
  let call = $derived(venueCall(sheet?.venue?.contacts));
  let lines = $derived(logisticsLines(sheet?.logistics));
  // Who goes, by name: the team feed (one cache with the pulse), else the sheet's people.
  const teamQuery = createQuery(toStore(() => teamQueryOptions(workspaces.map((w) => w.id), { enabled: gig })));
  let going = $derived.by(() => {
    if (!gig || !actionPerf) return '';
    const names = new Map(($teamQuery.data?.items ?? []).map((m) => [m.person_id, m.full_name]));
    const said = (actionPerf.commitments ?? []).filter((c) => c.state === 'going').map((c) => names.get(c.person_id)).filter(Boolean);
    if (said.length > 0) return said.join(' · ');
    return [...(sheet?.crew ?? []), ...(sheet?.cast ?? [])].map((c) => c.person?.full_name).filter(Boolean).join(' · ');
  });
  let facts = $derived(
    gig
      ? [
          call ? { k: t('ahora.venue', locale), v: [call.name, t(`ahora.contact_${call.by}`, locale)].filter(Boolean).join(', ') } : null,
          lines.load_access ? { k: t('ahora.load_access', locale), v: lines.load_access } : null,
          lines.hotel ? { k: t('ahora.hotel', locale), v: lines.hotel } : null,
          going ? { k: t('ahora.going', locale), v: going } : null,
        ].filter((f): f is { k: string; v: string } => f !== null)
      : [],
  );
  /** Where «Mapa» goes; the link picks the app (ADR-206). */
  let mapParts = $derived.by(() => {
    if (sheet) {
      const v = sheet.venue;
      return v?.address ? [v.address, v.city ?? sheet.city] : [v?.name ?? sheet.venue_name, v?.city ?? sheet.city];
    }
    if (focus?.what.of === 'stage') return [stagePlace(focus.what.stage.to_city, focus.what.stage.to_place)];
    if (actionPerf) return [actionPerf.venue_name, actionPerf.city];
    return [];
  });
  let map = $derived(mapsHref(mapParts) !== null);
  /** The headline's door (ADR-223): the pase of the thing that rules the piece, the
      focus when it has one, else the day's main performance. With several shows the
      headline is the day's, not one of them: no door. */
  let headHref = $derived.by(() => {
    if (!agenda || !focus || shows) return undefined;
    return pulseSlip(focus.ref, agenda.day, slipCtx).href ?? actionSlip?.href ?? undefined;
  });
  // Without its project (read through a bolo: a guest) nobody here edits «quién va».
  let whoHref = $derived(gig && actionSlip?.href && actionPerf?.project ? `${actionSlip.href}#who-goes` : null);
  /* «Tablón · 3 nuevos» (plan 2026-10-22 § 3.3): only when it has news. */
  let boardHref = $derived(actionSlip?.href && boardNew > 0 ? `${actionSlip.href}#board` : null);
  let acts = $derived(Boolean(call?.phone || map));

  /* «TU HORA» (ADR-234): the list of who goes names you, so the big hour is the
     first stop of the day, «Estás a las», until it comes. Not with several
     shows (the headline is the day's), nor once something is under way. */
  let stop = $derived(!shows && actionPerf && actionPoint ? yourStop(actionPerf, me) : null);
  /* Only while the piece is on the performance itself: a train before it
     stays the headline (it is what you do first). */
  let onPerf = $derived(Boolean(focus && actionPerf && focus.ref.of === 'performance' && focus.ref.row.id === actionPerf.id));
  let yours = $derived(stop && onPerf && !doing && Date.parse(stop.at) > now.getTime() ? stop : null);
  let yoursWord = $derived.by(() => {
    if (!yours || !actionPerf) return '';
    return cap(yours.label || (yours.key ? t(momentWordKey(yours.key), locale, undefined, tradeFor(perfWorkspaceId(actionPerf))) : ''));
  });

  let headEye = $derived(yours ? t('desk.you_at_eye', locale) : eye);
  let headWhat = $derived(yours ? yoursWord || what : shows ? showsWhat : what);
  let headAt = $derived(yours && actionPoint ? hour(yours.at, actionPoint.tz) : shows ? showsAt : at);
  let headSub = $derived(yours && actionPoint ? place(actionPoint) : shows ? showsWhere : where);
  let headRest = $derived(yours ? inWords(minutesTo(yours.at, now)) : shows ? showsLeft : left);

  /* «Mañana · sales a las 10h hacia Getxo» (ADR-234): inside the piece once
     nothing of today is still ahead, or today has no hours. */
  let tomorrowLine = $derived.by(() => {
    if (!agenda || !next || next.day !== plusDays(today, 1)) return '';
    const ahead = agenda.next !== null && agenda.points.some((p) => p.at);
    return ahead ? '' : nextWords(next, true);
  });

  // ── Freshness (ADR-146 § 3): one line, only without a network or with
  //    what is on screen over an hour old.
  let online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
  $effect(() => {
    const on = () => (online = true);
    const off = () => (online = false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  });
  let oldest = $derived.by(() => {
    const ats = [updatedAt, actionPerf ? $sheetQuery.dataUpdatedAt || null : null].filter((n): n is number => !!n);
    return ats.length ? Math.min(...ats) : null;
  });
  let fresh = $derived.by(() => {
    if (!oldest || !freshnessShown(oldest, now.getTime(), online)) return '';
    const iso = new Date(oldest).toISOString();
    const time = hourMark(dualTime(iso, null, viewerTz).primary);
    const d = dayKeyInTz(iso, viewerTz);
    return d === today
      ? t('ahora.fresh', locale, { time })
      : t('ahora.fresh_day', locale, { day: `${localeWeekdayShort(d, locale)} ${localeDayMonth(d, locale)}`, time });
  });

  // ── The hollow piece: «Hoy, nada en la agenda» and «Lo siguiente: …» (ADR-203 § 2) ──
  /** «mañana, tren a Girona», «martes, función? en Vic», «jue 19 nov, ensayo». */
  function nextWords(n: PulseNext, tomorrow = false): string {
    const when = nextWhen(n.day, today, locale);
    const sl = pulseSlip(n.ref, n.day, slipCtx);
    const held = sl.cert === 'hold' || sl.cert === 'proposed' ? '?' : '';
    const to = (p: string) => `${t('planner.slip_to', locale)} ${p}`;
    /* «Mañana · …» inside the piece (ADR-234) says its hour; the hollow piece
       draws it on the right. */
    const said = (what: string, where?: string) => {
      if (!tomorrow) return where ? t('desk.day_next_at', locale, { when, what, where }) : t('desk.day_next', locale, { when, what });
      const line = where ? t('desk.tomorrow_at', locale, { what, where }) : t('desk.tomorrow', locale, { what });
      return n.at ? `${line} · ${hour(n.at, n.ref.tz)}` : line;
    };
    // A trip says how it goes and where to when it has its legs: «tren a Girona».
    const leg = n.ref.of === 'date' ? timedStages(n.ref.row as DateEvent)[0] : undefined;
    const legTo = leg ? stagePlace(leg.to_city, leg.to_place) : null;
    if (leg && tomorrow && legTo && leg.depart_at)
      return t('desk.tomorrow_leaves', locale, { time: hour(leg.depart_at, leg.depart_tz ?? n.ref.tz), to: legTo });
    if (leg) return said([`${t(`planner.mode_${leg.mode}`, locale)}${held}`, legTo ? to(legTo) : null].filter(Boolean).join(' '));
    const kind = `${kindLabel(sl.kind, tradeFor(perfWorkspaceId(n.ref.row)))}${held}`;
    if (sl.lead) return said(`${kind} ${to(sl.name)}`);
    const w = sl.city || sl.name;
    return w ? said(kind, w) : said(kind);
  }
  let nextHref = $derived(next ? (pulseSlip(next.ref, next.day, slipCtx).href ?? undefined) : undefined);
  /** What comes names you: «estás a las 16h» instead of its own hour (ADR-234). */
  let nextStop = $derived(next && next.ref.of === 'performance' ? yourStop(next.ref.row as PerformanceEvent, me) : null);

  /** A row's own address: its record, else the day in the Planner. */
  const rowHref = (p: AgendaPoint) => pulseSlip(p.ref, agenda!.day, slipCtx).href ?? undefined;
</script>

<!-- WHOSE IT IS, at a glance: the project's monogram, glyph first (identity
     norms). Over the filled piece it retints through IdentityMark's own
     contract (`--identity-tint-base`, set on `.piece`). -->
{#snippet mark(project: ProjectLite | null | undefined)}
  {#if project}<span class="piece__mark"
      ><IdentityMark mini accent={accentVarFor(project)} name={project.name} initials={project.initials} /></span
    >{/if}
{/snippet}

<section class="dband day" aria-labelledby="desk-day-h">
  <h2 id="desk-day-h" class="visually-hidden">{cap(t('desk.next_today', locale))}</h2>

  {#if errored}
    <p class="load-fail" role="alert"><span>{t('desk.next_error', locale)}</span><Button size="xs" variant="secondary" onclick={onretry}>{t('ui.retry', locale)}</Button></p>
  {:else if !settled}
    <!-- The wait holds the piece's place: the blocks under it do not move. -->
    <div class="piece piece--hollow piece--wait" aria-hidden="true">
      <span class="piece__eye"><span class="ghost-line" style:inline-size="30%">&nbsp;</span></span>
      <span class="piece__lead"><span class="ghost-line" style:inline-size="60%">&nbsp;</span></span>
      <span class="piece__sub"><span class="ghost-line" style:inline-size="40%">&nbsp;</span></span>
    </div>
  {:else if agenda && focus}
    {@const sub = headSub}
    {@const rest = headRest}
    {@const leans = !shows && !yours && focus.ref.tentative}
    <div class="piece" class:piece--gig={gig} data-testid="desk-next">
      <span class="piece__eye" data-testid={yours ? 'desk-you-at' : undefined}>{@render mark(yours ? actionPerf?.project : eyeProject)}{headEye}</span>
      <!-- The headline is read again when the minute ticks: polite, never twice a minute.
           An option leans, the headline and the line under it (design-system
           rule 18); with several shows the headline is the day's: only a row leans. -->
      <div class="piece__lead" aria-live="polite" data-testid="desk-next-now">
        <svelte:element this={headHref ? 'a' : 'span'} href={headHref} class="piece__what" class:guess={leans} data-testid="desk-next-what"
          >{headWhat}</svelte:element
        >
        <span class="piece__at">{headAt}</span>
      </div>
      {#if sub || rest}
        <div class="piece__sub">
          <span class:guess={leans}>{sub}</span>
          {#if rest}<span class="piece__left">{rest}</span>{/if}
        </div>
      {/if}
      {#if fresh}<span class="piece__fresh" data-testid="desk-fresh">{fresh}</span>{/if}

      {#if agenda.points.length > 1}
        <ol class="piece__day" data-testid="desk-agenda">
          {#each agenda.points as p, i (p.key)}
            {@const href = rowHref(p)}
            {@const w = place(p, rowsCity)}
            <!-- Several projects' shows (ADR-207): a show's own row says whose, not «Show». -->
            {@const label = shows && !shows.oneProject && p.own && p.ref.row.project ? p.ref.row.project.name : cap(word(p))}
            <li
              class="piece__row"
              class:piece__row--past={agenda.past[i]}
              class:piece__row--on={!shows && i === agenda.focus}
              data-testid={p.main ? 'desk-agenda-main' : undefined}
            >
              <span class="piece__h">{p.at ? hour(p.at, p.tz) : t('planner.all_day', locale)}</span>
              <svelte:element this={href ? 'a' : 'span'} {href} class="piece__rowwhat">
                {@render mark(p.ref.row.project)}<span class:guess={p.ref.tentative}
                  >{label}{p.ref.tentative ? '?' : ''}{#if w}{' · '}{w}{/if}</span
                >
              </svelte:element>
            </li>
          {/each}
        </ol>
      {/if}

      {#if facts.length > 0}
        <dl class="piece__facts" data-testid="desk-facts">
          {#each facts as f (f.k)}<dt>{f.k}</dt><dd>{f.v}</dd>{/each}
        </dl>
      {/if}

      {#if boardHref || whoHref}
        <span class="piece__links">
          {#if boardHref}<a href={boardHref} data-testid="desk-next-board"
              >{boardNew === 1 ? t('desk.next_board_one', locale) : t('desk.next_board', locale, { n: boardNew })} →</a
            >{/if}
          {#if whoHref}<a href={whoHref}>{t('commitment.who_goes', locale)} →</a>{/if}
        </span>
      {/if}

      {#if acts}
        <!-- At the thumb (design-system rule 13): one row, the whole width, equal parts. -->
        <nav class="piece__acts" aria-label={t('ahora.actions', locale)} data-testid="desk-acts">
          {#if call?.phone}<a class="piece__act" href={telHref(call.phone)} aria-label={t('ahora.call_aria', locale, { name: call.name })}>{t('ahora.call', locale)}</a>{/if}
          {#if map}<MapLink class="piece__act" parts={mapParts} changeIn="settings">{t('ahora.map', locale)}</MapLink>{/if}
        </nav>
      {/if}

      {#if tomorrowLine}
        <p class="piece__tomorrow" data-testid="desk-tomorrow">
          {#if nextHref}<a href={nextHref}>{tomorrowLine}</a>{:else}{tomorrowLine}{/if}
        </p>
      {/if}
    </div>
  {:else}
    <!-- TODAY IS ALWAYS THE BIG PIECE (ADR-202 § 3): hollow, in its place. -->
    <div class="piece piece--hollow" data-testid="desk-hollow">
      <span class="piece__eye">{cap(t('desk.next_today', locale))}</span>
      <div class="piece__lead"><span class="piece__what">{t(todayHad ? 'desk.piece_done' : 'desk.piece_none', locale)}</span></div>
      {#if next}
        <div class="piece__sub">
          {#if nextHref}<a class="piece__next" href={nextHref}>{t('desk.piece_next', locale, { next: nextWords(next) })}</a
            >{:else}<span>{t('desk.piece_next', locale, { next: nextWords(next) })}</span>{/if}
          {#if nextStop}<span class="piece__left">{t('desk.you_at', locale, { time: hour(nextStop.at, next.ref.tz) })}</span
            >{:else if next.at}<span class="piece__left">{hour(next.at, next.ref.tz)}</span>{/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if outside && settled && !errored}
    {#if onclearscope}
      <p class="day__outside" data-testid="desk-outside">
        <button type="button" class="day__outside-door" onclick={onclearscope}
          >{outside}<span class="visually-hidden">. {t('desk.outside_clear', locale)}</span></button
        >
      </p>
    {:else}
      <p class="day__outside" data-testid="desk-outside">{outside}</p>
    {/if}
  {/if}
</section>

<style>
  .day {
    display: grid;
    gap: var(--space-s);
  }

  /* THE FILLED PIECE (design-system rules 1 and 2): the one surface of the
     screen with a fill, its own ink; what sits on it reads that ink. */
  .piece {
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
  .piece a {
    color: inherit;
    text-underline-offset: 3px;
  }
  /* The same piece with nothing in it: no fill, its edge (rule 4). */
  .piece--hollow {
    background: transparent;
    color: var(--text-color);
    border: var(--line-hairline) dashed var(--surface-hollow-edge);
    --identity-tint-base: var(--bg);
  }
  .piece--wait {
    color: var(--text-faint);
  }
  .piece__mark {
    display: inline-flex;
    flex: none;
    vertical-align: baseline;
    margin-inline-end: var(--space-xs);
  }
  .piece__eye {
    display: flex;
    align-items: center;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing-loose);
    text-transform: uppercase;
    color: var(--surface-focus-muted);
  }
  .piece--hollow .piece__eye {
    color: var(--text-faint);
  }
  /* What and its hour, one size (rule 6). */
  .piece__lead {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline;
    gap: var(--space-s);
    font-family: var(--font-display);
    font-size: var(--display-piece);
    line-height: 1.02;
  }
  .piece__what {
    text-wrap: balance;
  }
  /* The headline is a door without looking like a link: same ink, an underline only under the finger or the pointer. */
  a.piece__what {
    text-decoration: none;
  }
  a.piece__what:hover,
  a.piece__what:focus-visible {
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .piece__at {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  /* NOTHING TODAY, A SMALLER PIECE (ADR-234, amending ADR-202 § 3): still in
     its place and hollow, but what waits and what comes lead the screen. */
  .piece--hollow .piece__lead {
    color: var(--heading-color);
    font-size: var(--text-xl);
  }
  .piece--hollow {
    gap: var(--space-xs);
    padding-block: var(--space-s);
  }
  .piece__tomorrow {
    margin: 0;
    padding-block-start: var(--space-s);
    border-block-start: var(--line-hairline) solid color-mix(in oklch, var(--surface-focus-ink) 18%, transparent);
    font-size: var(--text-s);
    color: var(--surface-focus-muted);
  }
  .piece__tomorrow a {
    text-decoration: none;
  }
  .piece__tomorrow a:hover {
    text-decoration: underline;
  }
  .piece__sub {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-s);
    font-size: var(--text-m);
    color: var(--surface-focus-muted);
  }
  .piece--hollow .piece__sub {
    color: var(--text-muted);
  }
  .piece__left {
    white-space: nowrap;
  }
  .piece__next {
    text-decoration: none;
  }
  .piece__next:hover {
    text-decoration: underline;
  }
  .piece__fresh {
    font-size: var(--text-xs);
    color: var(--surface-focus-faint);
  }

  /* THE DAY inside the piece: hour · what, the hours in one column. */
  .piece__day,
  .piece__facts {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-xs) var(--space-s);
    margin: 0;
    padding: var(--space-s) 0 0;
    list-style: none;
    border-block-start: var(--line-hairline) solid var(--surface-focus-rule);
    font-size: var(--text-s);
  }
  .piece__row {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: baseline;
  }
  .piece__row--past {
    color: var(--surface-focus-faint);
  }
  .piece__row--on {
    font-weight: 600;
  }
  .piece__h,
  .piece__facts dt {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: var(--mono-letter-spacing);
    font-variant-numeric: tabular-nums;
    color: var(--surface-focus-faint);
  }
  .piece__row--on .piece__h {
    color: inherit;
  }
  .piece__facts dt {
    text-transform: uppercase;
  }
  .piece__facts dd {
    margin: 0;
    min-inline-size: 0;
  }
  .piece__rowwhat {
    min-inline-size: 0;
    text-decoration: none;
  }
  a.piece__rowwhat:hover {
    text-decoration: underline;
  }
  .piece__links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs) var(--space-m);
    font-size: var(--text-s);
  }
  .piece__acts {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: var(--space-s);
  }
  /* `:global`: «Mapa» is a MapLink, whose <a> this file does not own. */
  .piece__acts :global(.piece__act) {
    display: flex;
    align-items: center;
    justify-content: center;
    min-block-size: var(--touch-target);
    padding-block: var(--space-xs);
    border-radius: var(--radius-l);
    background: var(--surface-focus-act);
    color: inherit;
    font-size: var(--text-m);
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
  }
  .piece__acts :global(.piece__act:hover) {
    background: var(--surface-focus-act-hover);
  }

  .day__outside {
    margin: 0;
    padding-inline: var(--space-xs);
    font-size: var(--text-s);
    color: var(--text-muted);
  }
  /* A door that reads as the line it was: the muted text, underlined on
     hover, as `.link-arrow` does. */
  .day__outside-door {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  @media (hover: hover) {
    .day__outside-door:hover {
      color: var(--text-color);
      text-decoration: underline;
      text-underline-offset: 3px;
    }
  }
</style>
