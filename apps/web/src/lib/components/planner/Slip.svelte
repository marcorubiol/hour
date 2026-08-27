<script lang="ts">
  /**
   * THE SLIP · one vocabulary, four placings (ADR-095 §0).
   *
   * Everything that happens draws as this: the month cell, the board cell, the
   * flow row and the day card carry the SAME fields in the SAME order — pack
   * (whose · what) · hour · state · name · city · gloss. The only thing that
   * differs between placings is WHERE THE HOUR LIVES, and that is the caller's
   * business, not this component's.
   *
   * It replaces `PerfChip` and `DateChip`, and it is the object the board must
   * render too. Three implementations of one card is how the month came to
   * print a country code the board could not, and how a held gig and a
   * tentative rehearsal ended up with two ways of saying the same doubt.
   *
   * THE HEAD LINE, and this is the law that moved most: the PACK opens it —
   * monogram + the kind word, `flex: none`, never yielding — and the CLOCK
   * follows immediately. Not the right edge, which is what the month did.
   * A right-aligned clock column promises its members are commensurable
   * measurements of one kind, and they are not: `19h–20h30` is a span, `22h`
   * is an instant, and NO HOUR AT ALL is a real, frequent state. It offers a
   * scan it cannot support, for a question nobody asks here — in a month you
   * are reading commitments, and the hour is a detail you check after you have
   * found the date. Beside the pack it is a sentence: `MM SHOW? 18h30`.
   *
   * If something has to go it is the END TIME; the pack never yields, because
   * `SHOW` vs `PRESS` vs `TRAVEL` is not recoverable from anything else and a
   * half-glyph is worse than a second line.
   *
   * Styles live HERE and not in a parent's `:global` block — that is what let
   * the board invent its own grammar in the first place. The host cell owns
   * only `container-type: inline-size`, so the CELL decides what a slip can
   * afford. Width is measured, never declared: «that cell does not give the
   * width» is true at 85px and false at 143px.
   */
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import { accentVarFor } from '$lib/utils/accent';
  import type { Slip, SlipKind } from '$lib/month-events';
  import type { ProjectLite } from '$lib/month-events';

  interface Props {
    slip: Slip;
    /** The kind word — `show`, `rehearsal`, `travel`… Caller owns the words. */
    kindLabel: (kind: SlipKind) => string;
    /**
     * The state line. A hold says its rank and its deadline in PLAIN TEXT
     * («1st hold · expires Mon»); released says `let go`. A FIRM SHOW SAYS
     * NOTHING — the clean box, the full ink and the serif already say it three
     * times, so a word there is the fourth (ADR-095 §4).
     */
    stateLabel: (slip: Slip) => string | null;
    /** True while the hold's clock is actually running — the one thing on a
        held card that is not a maybe, so it is the one thing that takes ink. */
    stateUrgent?: boolean;
    /** The month drops the ISO code (the cell gives 57px, city+code needs
        58–70); the board and the day print it. The DRAWING decides. */
    showCountry?: boolean;
    /** Monogram click — opens the identity quick panel (ADR-081, «las siete» §7). */
    onMarkOpen?: (e: MouseEvent, project: ProjectLite | null) => void;
    /**
     * Opens the thing. A slip with no page of its own (a `date`) still has to
     * be openable — that is where its edit dialog lives — so it becomes a
     * BUTTON, which is what the prototype draws for every slip anyway
     * (`<button class="ag3me">`). Without this a date drawn on the month is
     * inert, and the only way to change a rehearsal's hour disappears.
     */
    onOpen?: () => void;
    /**
     * THE CLASH, drawn on exactly the two slips it is between.
     *
     * `soft` — two maybes colliding is a collision of maybes: the rule is
     * drawn, but dashed. `hard` — one of the two is inked, so the collision
     * stopped being hypothetical and the rule goes solid and full weight.
     * GRAVITY, NOT CERTAINTY: a running deadline does not promote it — when
     * the clock matters the hold chip says so, in words.
     */
    clash?: 'none' | 'soft' | 'hard';
    /**
     * The collision is about a PERSON — the same human booked twice, or
     * booked across an absence they wrote down. It is the one case where an
     * alarm is honest, so it is the one case that takes red.
     *
     * Two axes, two props, because they are two facts: `clash` is how certain
     * the collision is (the STROKE), this is how bad it is (the COLOUR).
     * Folding them into one value is how a «solid» started meaning «urgent».
     */
    clashPeople?: boolean;
    /**
     * WHERE THIS SLIP IS BEING DRAWN — and the ONLY thing that differs
     * between the four placings (ADR-095 §0).
     *
     * `cell` (month, board): the clock sits BESIDE the pack, so the head
     * reads as a sentence — `MM SHOW? 18h30`.
     * `row` (the diary): the clock sits UNDER the pack in a fixed column, so
     * it aligns down the page and time can be scanned with the eye. That is
     * the one difference the design grants, and it is a difference of
     * PLACING, not of object: same markup, same fields, same order.
     *
     * It is a variant and not a second component because a second component
     * is exactly how the month came to print a country code the board could
     * not — and how the diary grew an `ag__row` that had drifted from this
     * one in five ways by the time anybody compared them.
     */
    placing?: 'cell' | 'row';
    /**
     * WHETHER THERE IS A CARD UNDER IT.
     *
     * A second axis from `placing`, and two props because they are two facts:
     * the placing decides where the clock lives, this decides whether the
     * slip sits on paper. `bare` drops the ground, the edge and the padding
     * and keeps every word exactly as it is — which is what the shell rail
     * needs, where the slip is a sentence in a column of furniture and not an
     * object you can point at.
     *
     * It is a prop and not a copy of the type rules somewhere else, because
     * copying them is precisely how the month came to print a country code
     * the board could not (see the header). The rail asked for «the card's
     * text, without its box»; this is that, and it stays one component.
     */
    ground?: 'card' | 'bare';
    /** The verbs — `confirm`, `let go`. Drawn in the row placing's third
        column, which is reserved for them and empty everywhere else. */
    actions?: import('svelte').Snippet;
  }

  let {
    slip,
    kindLabel,
    stateLabel,
    stateUrgent = false,
    showCountry = false,
    onMarkOpen,
    onOpen,
    clash = 'none',
    clashPeople = false,
    placing = 'cell',
    ground = 'card',
    actions,
  }: Props = $props();

  let state = $derived(stateLabel(slip));
  let held = $derived(slip.cert === 'hold' || slip.cert === 'proposed');
</script>

<!-- One body, two shells: a thing with a page of its own is a link, one
     without is inert. Written once so the grammar cannot fork. -->
{#snippet body()}
  <span class="slip__h">
    <!-- The pack. Indivisible: `flex: none` on the whole thing. -->
    <span class="slip__pack">
      {#if slip.project}
        {#if onMarkOpen}
          <span
            class="slip__mark"
            role="button"
            tabindex="0"
            onclick={(e) => onMarkOpen(e, slip.project)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onMarkOpen(e as unknown as MouseEvent, slip.project);
              }
            }}
          >
            <IdentityMark
              mini
              accent={accentVarFor(slip.project)}
              name={slip.project.name}
              initials={slip.project.initials}
            />
          </span>
        {:else}
          <IdentityMark
            mini
            accent={accentVarFor(slip.project)}
            name={slip.project.name}
            initials={slip.project.initials}
          />
        {/if}
      {/if}
      <span class="slip__kind" class:slip__kind--q={held}
        >{kindLabel(slip.kind)}{#if held}?{/if}</span
      >
    </span>
    {#if slip.time}
      <!-- The END HOUR is its own element so the CELL can drop it (see the
           container queries below). A start hour alone is a whole assertion;
           half a range is not, so nothing is ever cut mid-string. -->
      <span class="slip__t"
        >{slip.time.primary}{#if slip.time.end}<i>–{slip.time.end}</i>{/if}</span
      >
    {/if}
  </span>

  {#if state}
    <span class="slip__state" class:slip__state--due={stateUrgent}>{state}</span>
  {/if}

  <!-- A travel day's place is ambiguous on its own — «London» is a departure
       or an arrival depending on a column nobody can see — so the direction
       governs the name, in the margin voice. -->
  <span class="slip__n"
    >{#if slip.lead}<i class="slip__pre">{slip.lead}</i>{/if}{slip.name}</span
  >

  <!-- WHERE THE LEG BEGAN, under where it goes — the shape the design draws
       for a travel day: `to Brussels` over `from Barcelona`. It is deduced
       from the sheet, and absent rather than guessed when nothing precedes. -->
  {#if slip.origin}
    <span class="slip__c"><i class="slip__pre">from</i>{slip.origin}</span>
  {:else if slip.city}
    <span class="slip__c"
      >{slip.city}{#if showCountry && slip.country}<i class="slip__cc">{slip.country}</i>{/if}</span
    >
  {/if}

  <!-- THE SECOND CLOCK IS A GLOSS: its own line, so it can never push an hour
       out of its box, and the first thing the cell drops when it runs short. -->
  {#if slip.time?.secondary}
    <span class="slip__tz">{slip.time.secondary}</span>
  {/if}

  {#if actions}<span class="slip__acts">{@render actions()}</span>{/if}
{/snippet}

{#if slip.href}
  <a
    class="slip" class:grain={held}
    data-family={slip.cert}
    data-kind={slip.kind}
    data-placing={placing}
    data-ground={ground}
    data-clash={clash === 'none' ? undefined : clash}
    data-clash-people={clash !== 'none' && clashPeople ? '' : undefined}
    style={slip.project ? `--c: ${accentVarFor(slip.project)}` : undefined}
    href={slip.href}
    title={slip.title}>{@render body()}</a
  >
{:else if onOpen}
  <button
    type="button"
    class="slip" class:grain={held}
    data-family={slip.cert}
    data-kind={slip.kind}
    data-placing={placing}
    data-ground={ground}
    data-clash={clash === 'none' ? undefined : clash}
    data-clash-people={clash !== 'none' && clashPeople ? '' : undefined}
    style={slip.project ? `--c: ${accentVarFor(slip.project)}` : undefined}
    title={slip.title}
    onclick={onOpen}>{@render body()}</button
  >
{:else}
  <span
    class="slip" class:grain={held}
    data-family={slip.cert}
    data-kind={slip.kind}
    data-placing={placing}
    data-ground={ground}
    data-clash={clash === 'none' ? undefined : clash}
    data-clash-people={clash !== 'none' && clashPeople ? '' : undefined}
    style={slip.project ? `--c: ${accentVarFor(slip.project)}` : undefined}
    title={slip.title}>{@render body()}</span
  >
{/if}

<style>
  @layer components {
    .slip {
      position: relative;
      isolation: isolate;
      display: flex;
      flex-direction: column;
      gap: 0;
      width: 100%;
      min-width: 0;
      padding: 4px 6px;
      text-align: left;
      text-decoration: none;
      background: var(--bg-ultra-light);
      /* THE EDGE HAS TO BE THERE BEFORE YOU POINT AT IT. `--border-color-light`
         is the neutral at 9% alpha — a hairline meant for dividing rows of
         text, and on a white card over cream paper it is simply not visible.
         The card then appeared to gain its outline on hover, which reads as
         the hover DRAWING the box rather than darkening it. This is the
         prototype's own value: the ink mixed 15% into the line colour. */
      border: 1px solid color-mix(in oklch, var(--text-color) 15%, var(--border-color-light));
      /* 3px, not the 4 of `--radius-s`: «solo un poquito en redondito».
         At the size of a month cell the extra point reads as a chip. */
      border-radius: 3px;
      color: var(--text-color);
    }
    .slip + :global(.slip) {
      margin-block-start: 3px;
    }
    /* NO PAPER. Every word keeps its size, its ink and its order; only the
       object it was sitting on goes. `border: 0` and not a transparent edge
       because a bare slip is not a card pretending — the 2px it gives back
       matter in a 13rem rail. */
    .slip[data-ground='bare'] {
      background: none;
      border: 0;
      border-radius: 0;
      padding: 0;
    }

    /* ── the head line ──────────────────────────────────────────────── */
    .slip__h {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 1px 6px;
      width: 100%;
      min-width: 0;
      /* The wrapped head keeps a hairline: two 10px line boxes at 1.05 with
         no row-gap touch, and the board's slip wraps more often than the
         month's. 1px and 1.15 — still tight, never touching. */
      line-height: 1.15;
    }
    .slip__pack {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      flex: none; /* the pack NEVER yields — see the header note */
    }
    .slip__mark {
      display: inline-flex;
      cursor: pointer;
      border-radius: var(--radius-s);
    }
    .slip__mark:focus-visible {
      outline: 1px solid var(--text-muted);
      outline-offset: 1px;
    }
    /* ONE VOICE FOR THE PACK AND THE CLOCK. The hour sat one ink step above
       the kind word, so `SHOW 16h` read as a faint label with a loud number
       glued to it — and the head line is meant to be a SENTENCE («MM SHOW
       16h»), three tokens in one act of reading. Whatever the step was
       protecting, it was not a hierarchy anybody uses: you do not read the
       hour before you know what kind of thing it belongs to. */
    .slip__kind {
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-muted);
      white-space: nowrap;
    }
    /* An option LEANS: the kind word and its `?` are italic wherever they are
       drawn. The glyph never leans — it is a symbol, not a word. */
    .slip__kind--q {
      font-style: italic;
    }
    /* AN HOUR IS A FACT, AND IT TAKES FULL INK WHEREVER IT IS DRAWN. The run
       band's per-day hours are at full ink because they are the only thing
       that band says its title does not — and a slip's hour is exactly as
       much of a fact, so drawing it a step quieter made one clock louder than
       another for no reason a reader could name. The KIND word stays muted:
       it is a label on the hour, not a second measurement. */
    .slip__t {
      font-family: var(--font-mono);
      font-size: 9px;
      color: var(--text-color);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .slip__t i {
      font-style: normal;
    }
    /* `TO` / `FROM` — the margin voice, so it reads as a label on the place
       and never as part of the place's name. */
    .slip__pre {
      font-style: normal;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-faint);
      margin-inline-end: 4px;
    }

    /* ── state · plain text, never a pill ───────────────────────────────
       A pill outranks everything around it: in a cell it read louder than
       the venue you came there to read. Same words, same place, no box. */
    .slip__state {
      align-self: flex-start;
      margin-block: 0 1px;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-muted);
      /* Without the pill the chip is plain text, so in a narrow cell it has to
         be allowed to turn a line instead of running off the edge. `1st hold ·
         expires 25/08` does not fit 143px on one line, and clipping the
         DEADLINE is clipping the one thing on a held card that is not a maybe.
         Caught on screen, 2026-07-31: it printed `HOLD · EXPIRES 25/0…`. */
      white-space: normal;
      line-height: 1.2;
    }
    .slip__state--due {
      color: var(--info);
    }

    /* ── name · three lines here, but the BUDGET IS THE CALLER'S ────────
       A placing that cannot afford a wrap says so by narrowing
       `--slip-name-lines`; the treatment (box, clamp, ellipsis) stays here so
       there is one truncation in the app and not one per caller. The rail is
       the first to need it: at 13.25rem a venue name wraps, and ADR-096 says
       that block may not change height. See `RailPulse.svelte`. */
    .slip__n {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: var(--slip-name-lines, 3);
      line-clamp: var(--slip-name-lines, 3);
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
      font-size: 11px;
      line-height: 1.22;
      color: var(--text-color);
      /* Last-resort valve only: it fires when a single word cannot fit,
         never on ordinary text. */
      overflow-wrap: anywhere;
      word-break: normal;
      hyphens: none;
    }
    /* The gig keeps its step over every other kind at EVERY width: the agenda
       says it 16/13, the month says it 13/11. Flattening the two is the one
       place a show and a press call were drawn at the same weight. */
    .slip[data-kind='show'] .slip__n {
      font-family: var(--font-display);
      font-size: 13px;
    }

    .slip__c {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: var(--slip-city-lines, 2);
      line-clamp: var(--slip-city-lines, 2);
      overflow: hidden;
      text-overflow: ellipsis;
      margin-block-start: -1px;
      font-size: 9px;
      color: var(--text-faint);
      overflow-wrap: anywhere;
      word-break: normal;
    }
    .slip__cc {
      font-style: normal;
      margin-inline-start: 4px;
      letter-spacing: 0.06em;
      opacity: 0.8;
    }
    .slip__tz {
      display: block;
      margin-block-start: 2px;
      font-family: var(--font-mono);
      font-size: 9px;
      letter-spacing: 0.05em;
      color: var(--text-faint);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    /* ══ THE ROW PLACING · the diary ═══════════════════════════════════
       Same markup, placed differently. The identity column is fixed so the
       hours line up down the page — the whole reason the diary puts the
       clock under the pack instead of beside it — and the third column is
       reserved for the verbs whether or not a row has any, so a `confirm`
       appearing never shifts the name it belongs to. */
    .slip[data-placing='row'] {
      display: grid;
      grid-template-columns: 8.5rem minmax(0, 1fr) auto;
      /* START, NOT BASELINE. Baseline-aligning a 16px serif against a 9px
         mono makes the grid reserve the tallest line box in every row, so the
         name and its city sat sixteen pixels apart with a `row-gap` of four.
         The pack keeps its own alignment inside its column. */
      align-items: start;
      column-gap: var(--space-s);
      /* THE NAME AND ITS PLACE NEED AIR. At 1px the venue and the city
         touched — one block of text where there are two facts, and the row
         read as a paragraph instead of a line with a subtitle. The month cell
         gets away with `-1px` because its name is 13px in a 76px box; a
         diary row is 16px across a full page and the same leading reads as a
         collision. */
      row-gap: 2px;
      padding: 7px 8px;
      border: 0;
      border-radius: 0;
      background: none;
    }
    .slip[data-placing='row'] .slip__h {
      grid-column: 1;
      grid-row: 1;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
    }
    .slip[data-placing='row'] .slip__state {
      grid-column: 1;
      grid-row: 2;
      margin: 0;
    }
    .slip[data-placing='row'] .slip__n {
      grid-column: 2;
      grid-row: 1;
      -webkit-line-clamp: unset;
      line-clamp: unset;
      display: block;
    }
    .slip[data-placing='row'] .slip__c {
      grid-column: 2;
      grid-row: 2;
      margin: 0;
    }
    .slip[data-placing='row'] .slip__tz {
      grid-column: 2;
      grid-row: 3;
    }
    .slip[data-placing='row'] .slip__acts {
      grid-column: 3;
      grid-row: 1 / -1;
      align-self: center;
    }
    /* A ROW HAS THE WIDTH THE CELL NEVER HAD, so the gig takes the step the
       design gives it here: 16 over 13, where the month says 13 over 11. */
    .slip[data-placing='row'][data-kind='show'] .slip__n {
      font-size: 16px;
    }
    .slip[data-placing='row'] .slip__n {
      font-size: 13.5px;
    }
    .slip__acts {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
    }

    /* ══ THE CERTAINTY VOCABULARY ═══════════════════════════════════════
       Geometry states the certainty. A theme may repaint the material; it may
       never re-shape the geometry. */

    /* firm — it IS real: clean ground, full ink, no mark at all. */

    /* held / proposed — no solid edge, and the grain says it. The dashed edge
       has to be READ; the texture is just SEEN, and it is calibrated once so
       every drawing says "not sure" at the same volume. */
    .slip[data-family='hold'],
    .slip[data-family='proposed'] {
      border-style: dashed;
      border-color: color-mix(in oklch, var(--text-color) 13%, var(--border-color-light));
      background: var(--bg-ultra-light);
    }
    /* …BUT NOT IN THE DIARY, and the difference is what the slip IS in each
       placing. In a month cell it is an OBJECT sitting on a sheet, so it has
       a ground of its own and the grain lies on that ground. In the diary it
       is a LINE ON THE PAGE — there is no card, so the paper is the ground
       and a white fill turns the row into a floating box the design does not
       have. Marco caught it in the diary and, correctly, only there. */
    .slip[data-placing='row'][data-family='hold'],
    .slip[data-placing='row'][data-family='proposed'] {
      background: none;
    }
    /* The grain itself lives in styles/certainty.css (`.grain`) — one
       token, calibrated once, shared with the day strip's labels. */
    /* The title takes the quieter ink here and in every other drawing: one
       value for one state. And it leans — an option is written in italic
       wherever its name appears. */
    .slip[data-family='hold'] .slip__n,
    .slip[data-family='proposed'] .slip__n {
      color: var(--text-muted);
      font-style: italic;
    }
    .slip[data-family='proposed'] .slip__n {
      color: var(--text-faint);
    }

    /* released — WAS real, isn't. Kept as memory: dotted (a fourth line style,
       so it can never be read as held or firm), struck, faintest ink. */
    .slip[data-family='released'] {
      border-style: dotted;
      background: transparent;
    }
    /* ONLY THE NAME IS STRUCK. Three struck fields in a 76px box is a card
       drawn through, and it stops reading as a card at all — while the city
       and the hour are still TRUE of the thing that was let go, which is the
       whole reason the slip is kept as memory instead of removed. The strike
       is a verdict on the commitment, so it lands on the commitment's name. */
    .slip[data-family='released'] .slip__n {
      color: var(--text-faint);
      text-decoration: line-through;
      text-decoration-thickness: 1px;
    }
    .slip[data-family='released'] .slip__c,
    .slip[data-family='released'] .slip__t {
      color: var(--text-faint);
    }

    /* ══ THE CLASH · one rule down the two slips it is between ══════════
       IT IS BLUE BY DEFAULT, and that is a product decision: this app does
       not raise alarms. A collision on a calendar is a thing to DECIDE, and
       `--info` is already the colour that says exactly that here — the hold's
       running deadline wears it. Red everywhere was also inconsistent on its
       own terms: the mark on the day number is blue for the same fact, so one
       day printed two different levels of alarm about one collision.

       RED SURVIVES FOR ONE CASE, and it is bound to the mark's own test so
       the two can never disagree again: the collision is about a PERSON — the
       same human booked twice, or booked across an absence they wrote down.
       That is the one place an alarm is honest, and keeping it rare is what
       keeps it legible the day it fires.

       The rule is painted on exactly the pair the data names, never on «every
       gig on this day»: three things can sit on one date and only two of them
       are the collision. It survives the option's dashed EDGE because the two
       say different things — the edge says «not sure», the rule says «not
       both» — and it takes the LEFT edge, the only one no other state uses.

       ONE WIDTH. The certainty is in the STROKE — dashed while this is an
       option, solid once it is real — so the weight has nothing left to say.
       Colour and width doing one job is one variable too many. */
    .slip[data-clash] {
      --clash-ink: var(--info);
      border-inline-start: 1.5px dashed
        color-mix(in oklch, var(--clash-ink) 62%, var(--border-color-light));
    }
    .slip[data-clash-people] {
      --clash-ink: var(--danger);
    }
    .slip[data-clash='hard'] {
      border-inline-start-style: solid;
      border-inline-start-color: var(--clash-ink);
    }

    /* NO BRIDGE ACROSS THE GAP, and the reason is the corner. The design
       squares the two left corners and joins the pair with a straight 4px
       stub between the boxes. Once the corners keep their curve — which is
       what stopped the rule reading as a rail bolted on the outside — a
       straight stub at the border's own x protrudes past both curves and
       lands in the gap as a third mark that belongs to neither card. Marco
       saw it before I did.
       Three pixels apart, two rules in the same red at the same x already
       read as one; the stub was buying nothing and printing a defect. */

    /* hover — the edge darkens and the NAME underlines. Nothing else moves:
       a slip that changes shape on hover is a slip that flickers in a grid. */
    .slip:hover {
      border-color: var(--text-faint);
    }
    button.slip {
      font-family: inherit;
      cursor: pointer;
    }
    a.slip:hover .slip__n,
    button.slip:hover .slip__n {
      text-decoration: underline;
      text-decoration-color: var(--border-color-light);
      text-underline-offset: 2px;
    }

    /* ══ THE CELL DECIDES WHAT A SLIP CAN AFFORD ════════════════════════
       Measured, never declared. The host sets `container-type: inline-size`;
       these are the two steps the design measured on a real month cell. */
    @container (max-width: 142px) {
      /* THE END HOUR GOES, THE START STAYS — the range is still in the title.
         Half a range is not an assertion, so it is dropped whole rather than
         clipped: `10h–14h` becomes `10h`, never `10h–1…`. */
      .slip__t i {
        display: none;
      }
    }
    @container (max-width: 126px) {
      /* a gloss is the FIRST thing to go, and never the hour */
      .slip__tz {
        display: none;
      }
      .slip__kind,
      .slip__t,
      .slip__state {
        letter-spacing: 0;
      }
      .slip__n {
        line-height: 1.22;
      }
      /* AND THE GIG KEEPS ITS STEP OVER THE OTHER KINDS AT EVERY WIDTH.
         Flattening both to 11px here is the one place a show and a press call
         would be drawn at the same weight — the family swap would be carrying
         the distinction alone. 12/11 at this width, 13/11 above it. */
      .slip[data-kind='show'] .slip__n {
        font-size: 12px;
        line-height: 1.2;
      }
      /* Row gap tight, COLUMN gap not: the clock now sits immediately after
         the kind word, and 2px there is not separation — `SHOW?18h30` reads
         as one token. Six is a word space. */
      .slip__h {
        gap: 2px 6px;
      }
      .slip {
        padding: 4px 3px 5px;
      }
    }
  }
</style>
