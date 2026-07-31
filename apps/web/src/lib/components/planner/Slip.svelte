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

  {#if slip.city}
    <span class="slip__c"
      >{slip.city}{#if showCountry && slip.country}<i class="slip__cc">{slip.country}</i>{/if}</span
    >
  {/if}

  <!-- THE SECOND CLOCK IS A GLOSS: its own line, so it can never push an hour
       out of its box, and the first thing the cell drops when it runs short. -->
  {#if slip.time?.secondary}
    <span class="slip__tz">{slip.time.secondary}</span>
  {/if}
{/snippet}

{#if slip.href}
  <a
    class="slip"
    data-family={slip.cert}
    data-kind={slip.kind}
    data-clash={clash === 'none' ? undefined : clash}
    style={slip.project ? `--c: ${accentVarFor(slip.project)}` : undefined}
    href={slip.href}
    title={slip.title}>{@render body()}</a
  >
{:else if onOpen}
  <button
    type="button"
    class="slip"
    data-family={slip.cert}
    data-kind={slip.kind}
    data-clash={clash === 'none' ? undefined : clash}
    style={slip.project ? `--c: ${accentVarFor(slip.project)}` : undefined}
    title={slip.title}
    onclick={onOpen}>{@render body()}</button
  >
{:else}
  <span
    class="slip"
    data-family={slip.cert}
    data-kind={slip.kind}
    data-clash={clash === 'none' ? undefined : clash}
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
      border: 1px solid var(--border-color-light);
      /* 3px, not the 4 of `--radius-s`: «solo un poquito en redondito».
         At the size of a month cell the extra point reads as a chip. */
      border-radius: 3px;
      color: var(--text-color);
    }
    .slip + :global(.slip) {
      margin-block-start: 3px;
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
    .slip__t {
      font-family: var(--font-mono);
      font-size: 9px;
      color: var(--text-muted);
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

    /* ── name · clamps to three lines, never one with an ellipsis ─────── */
    .slip__n {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      line-clamp: 3;
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
      -webkit-line-clamp: 2;
      line-clamp: 2;
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
    .slip[data-family='hold']::before,
    .slip[data-family='proposed']::before {
      content: '';
      position: absolute;
      inset: 0;
      z-index: -1;
      opacity: 0.62;
      background-image: radial-gradient(
        color-mix(in oklch, var(--text-color) 22%, transparent) 0.75px,
        transparent 1.4px
      );
      background-size: 7px 7px;
      -webkit-mask-image: linear-gradient(150deg, #000 0 20%, transparent 82%);
      mask-image: linear-gradient(150deg, #000 0 20%, transparent 82%);
    }
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

    /* ══ THE CLASH · one red rule down the two slips it is between ══════
       Red is conflict, and ONLY conflict — the one place in the Planner it is
       allowed to sit still. The rule is painted on exactly the pair the data
       names, never on «every gig on this day»: three things can sit on one
       date and only two of them are the collision.

       It survives the option's dashed edge because the two say different
       things — the edge says «not sure», the rule says «not both» — and it
       takes the LEFT edge, which is the only edge no other state uses.

       GRAVITY, NOT CERTAINTY. Two holds colliding is a collision of two
       maybes: the rule is drawn, but dashed. The moment one of them is inked
       it goes solid and full weight. A running deadline does NOT promote it:
       when the clock matters the hold chip says so, in words. */
    /* THIN. The rule is a hairline that says «not both», not a bar that
       competes with the card it is attached to — at 2/3px it read as a status
       stripe and became the loudest thing in the cell. 1.5 dashed and 2 solid
       keep the step between «two maybes» and «one is real» while staying a
       rule. */
    /* IT IS THE CARD'S OWN EDGE, and it keeps the card's corners. The design
       squares them, and squaring them is what made Marco read the rule as a
       rail bolted to the outside: a box rounded on two corners and square on
       the other two looks like two objects. Curved with the rest of the
       outline it is unmistakably one — the same edge, in another colour,
       saying another thing. */
    .slip[data-clash] {
      border-inline-start: 1.5px dashed
        color-mix(in oklch, var(--danger) 62%, var(--border-color-light));
    }
    .slip[data-clash='hard'] {
      border-inline-start-width: 2px;
      border-inline-start-style: solid;
      border-inline-start-color: var(--danger);
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
