<script lang="ts">
  /**
   * READING THE MARKS — three entries, and only three (ADR-095 §3).
   *
   * This used to be the month's colour key AND the month's filter: one row per
   * project, click to mute. Both halves are gone, for different reasons.
   *
   * The FILTER died because the app already has a machine for narrowing and it
   * is called scope, one line above — a second one underneath teaches that this
   * lens reasons differently from the rest of the tool.
   *
   * The PROJECT ROWS died with it: they WERE the filter's controls, and a
   * colour key listing every project keys something the monogram already says
   * on every single card.
   *
   * What is left is the grammar the drawing genuinely cannot say on its own —
   * solid / dashed / `!` — and that grammar is not the month's, it belongs to
   * all four views. So it leaves the sheet and lives in the Planner's overflow,
   * reachable from every one of them. A legend at the foot of a drawing three
   * screens tall is exactly where nobody who needs teaching will ever arrive;
   * and a legend of six entries is a confession that the vocabulary is not
   * evident yet.
   */
  interface Props {
    /** «it is real» */
    confirmedLabel: string;
    /** «asked for — not real yet» */
    holdLabel: string;
    /** «there is a call to make here» */
    clashLabel: string;
  }

  let { confirmedLabel, holdLabel, clashLabel }: Props = $props();
</script>

<dl class="marks">
  <div class="marks__row">
    <dt class="marks__swatch marks__swatch--firm" aria-hidden="true"></dt>
    <dd class="marks__word">{confirmedLabel}</dd>
  </div>
  <div class="marks__row">
    <dt class="marks__swatch marks__swatch--held" aria-hidden="true"></dt>
    <dd class="marks__word">{holdLabel}</dd>
  </div>
  <div class="marks__row">
    <dt class="marks__swatch marks__swatch--clash" aria-hidden="true">!</dt>
    <dd class="marks__word">{clashLabel}</dd>
  </div>
</dl>

<style>
  @layer components {
    .marks {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
      padding: 0;
    }
    .marks__row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .marks__swatch {
      flex: none;
      inline-size: 22px;
      block-size: 14px;
      border-radius: var(--radius-s);
      border: 1px solid var(--border-color-light);
    }
    /* it IS real — clean ground, full ink, no mark at all */
    .marks__swatch--firm {
      background: var(--bg-ultra-light);
      border-color: color-mix(in oklch, var(--text-color) 22%, transparent);
    }
    /* asked for — the dashed edge has to be READ, the grain is just SEEN */
    .marks__swatch--held {
      border-style: dashed;
      background-image: radial-gradient(
        color-mix(in oklch, var(--text-color) 22%, transparent) 0.75px,
        transparent 1.4px
      );
      background-size: 7px 7px;
    }
    /* a call to make. ONE shape and ONE colour: WHICH two collide is the red
       rule on the slips, and WHY is a sentence on the decision card. */
    .marks__swatch--clash {
      display: flex;
      align-items: center;
      justify-content: center;
      border: 0;
      font-family: var(--font-mono);
      font-size: var(--text-s);
      color: var(--info);
    }
    .marks__word {
      margin: 0;
      font-size: var(--text-s);
      color: var(--text-muted);
    }
  }
</style>
