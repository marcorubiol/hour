<script lang="ts">
  /**
   * AccentSwatchPicker — the accent selector shared by the create dialogs
   * (workspace / project / line) and the identity editors: a row of the 7
   * curated palette swatches with an always-visible hue slider beneath it. The
   * SLIDER is the source of truth — a lens carrying the hue wheel 0→360 across
   * its full width — and the 7 swatches are equidistant samples of it, laid out
   * (space-around) so each swatch sits exactly above its hue on the slider.
   *
   * Pick a swatch for a preset, or drag/arrow the slider to fine-tune into a
   * custom hue; "back to presets" returns to auto. The custom picker stores
   * only a hue ('h<0-360>'); lightness + chroma are fixed by the palette tokens
   * so any colour stays soft and adapts light/dark (see $lib/utils/accent).
   */

  import {
    ACCENT_COUNT,
    PALETTE_HUES,
    accentIndex,
    accentVarFor,
    customAccent,
    customHue,
    isCustomAccent,
  } from '$lib/utils/accent';

  interface Props {
    /** Selected accent: "1".."7", a custom hue "h<0-360>", or null for auto. */
    accent?: string | null;
    /** Slug the server would hash when accent is null (auto preview). */
    autoSlug: string;
    /** Radiogroup accessible name, e.g. "Line color". */
    label: string;
    disabled?: boolean;
    /** Visually hide the "Color" legend (kept for screen readers). */
    hideLegend?: boolean;
  }

  let { accent = $bindable(null), autoSlug, label, disabled = false, hideLegend = false }: Props =
    $props();

  const swatches = Array.from({ length: ACCENT_COUNT }, (_, i) => i + 1);

  let isCustom = $derived(isCustomAccent(accent));
  // Palette index the slider rests on when not custom: the chosen preset, else
  // the hash-derived one (auto). Old out-of-range indices wrap in.
  let baseIndex = $derived(
    accent && /^\d+$/.test(accent)
      ? (((Number(accent) - 1) % ACCENT_COUNT) + ACCENT_COUNT) % ACCENT_COUNT
      : accentIndex(autoSlug) - 1,
  );
  let hue = $derived(isCustom ? (customHue(accent) ?? PALETTE_HUES[baseIndex]) : PALETTE_HUES[baseIndex]);
  let currentColor = $derived(
    isCustom
      ? `oklch(var(--accent-custom-l) var(--accent-custom-c) ${hue})`
      : accentVarFor({ slug: autoSlug, accent }),
  );

  // ── Custom hue slider (own pointer/keyboard handling so the thumb sits at
  //    an exact fraction; a native <input range> insets the thumb and would
  //    break the swatch alignment). ─────────────────────────────────────────
  let trackEl: HTMLDivElement | undefined = $state();
  let dragging = $state(false);

  function hueFromClientX(clientX: number): number {
    if (!trackEl) return hue;
    const r = trackEl.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return Math.min(359, Math.round(f * 360));
  }
  function onPointerDown(e: PointerEvent) {
    if (disabled) return;
    dragging = true;
    trackEl?.setPointerCapture(e.pointerId);
    accent = customAccent(hueFromClientX(e.clientX));
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging || disabled) return;
    accent = customAccent(hueFromClientX(e.clientX));
  }
  function endDrag(e: PointerEvent) {
    dragging = false;
    trackEl?.releasePointerCapture?.(e.pointerId);
  }
  function onKey(e: KeyboardEvent) {
    if (disabled) return;
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      accent = customAccent(hue + step);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      accent = customAccent(hue - step);
    }
  }

  function selectPreset(n: number) {
    accent = accent === String(n) ? null : String(n);
  }
</script>

<fieldset class="swatches">
  <legend class:legend--hidden={hideLegend}>Color</legend>

  <div class="swatch-grid" role="radiogroup" aria-label={label}>
    {#each swatches as n (n)}
      {@const isOn = accent === String(n)}
      <button
        type="button"
        role="radio"
        aria-checked={isOn}
        class={['swatch', isOn && 'swatch--on'].filter(Boolean).join(' ')}
        style={`left: ${(PALETTE_HUES[n - 1] / 360) * 100}%; background: var(--accent-${n})`}
        aria-label={`Color ${n}`}
        {disabled}
        onclick={() => selectPreset(n)}
      ></button>
    {/each}
  </div>

  <div
    class="hue"
    bind:this={trackEl}
    role="slider"
    tabindex={disabled ? -1 : 0}
    aria-label="Custom hue"
    aria-valuemin="0"
    aria-valuemax="359"
    aria-valuenow={hue}
    aria-disabled={disabled || undefined}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={endDrag}
    onpointercancel={endDrag}
    onkeydown={onKey}
  >
    <div class="hue-lens" aria-hidden="true"></div>
    <div
      class="hue-thumb"
      style={`left: ${(hue / 360) * 100}%; background: ${currentColor}`}
      aria-hidden="true"
    ></div>
  </div>

  <p class="swatch-hint">
    {#if isCustom}
      <span class="hint-state">
        <span class="hint-dot" style={`background: ${currentColor}`} aria-hidden="true"></span>
        Custom {hue}°
      </span>
      <button type="button" class="swatch-clear" onclick={() => (accent = null)} {disabled}
        >back to presets</button
      >
    {:else if accent}
      <span></span>
      <button type="button" class="swatch-clear" onclick={() => (accent = null)} {disabled}
        >Clear · use auto</button
      >
    {:else}
      <span class="hint-state">
        <span class="hint-dot" style={`background: ${currentColor}`} aria-hidden="true"></span>
        Auto from name
      </span>
    {/if}
  </p>
</fieldset>

<style>
  @layer components {
    .swatches {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      border: 0;
      padding: 0;
      margin: 0;
    }

    .swatches > legend {
      padding: 0;
      font-size: var(--text-xs);
      color: var(--text-dark-muted);
    }

    .swatches > legend.legend--hidden {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    /* Each swatch is placed at the SAME fraction the slider maps its hue to
       (hue/360), with the same translateX(-50%) as the thumb, so it sits
       exactly above it — space-around only approximated the fraction. */
    .swatch-grid {
      position: relative;
      block-size: 26px;
    }

    .swatch {
      position: absolute;
      inset-block-start: 0;
      inline-size: 26px;
      block-size: 26px;
      padding: 0;
      border: 0;
      border-radius: var(--radius-50);
      cursor: pointer;
      transform: translateX(-50%);
      box-shadow: 0 0 0 1px var(--border-color-light) inset;
      transition:
        box-shadow var(--transition),
        transform var(--transition);
    }

    .swatch:hover:not(:disabled) {
      transform: translateX(-50%) scale(1.08);
    }

    .swatch:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 2px;
    }

    .swatch--on {
      box-shadow:
        0 0 0 2px var(--bg),
        0 0 0 4px var(--text-color);
    }

    .swatch:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Hue slider: a lens carrying the hue wheel; the thumb is positioned by an
       exact fraction (hue/360) so it tracks the swatches above. */
    .hue {
      position: relative;
      block-size: 26px;
      cursor: pointer;
      touch-action: none;
    }

    .hue:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 4px;
      border-radius: var(--radius-50);
    }

    .hue-lens {
      position: absolute;
      inset-inline: 0;
      inset-block-start: 50%;
      block-size: 16px;
      transform: translateY(-50%);
      pointer-events: none;
      clip-path: polygon(
        0% 50%,
        12% 22%,
        30% 6%,
        50% 0%,
        70% 6%,
        88% 22%,
        100% 50%,
        88% 78%,
        70% 94%,
        50% 100%,
        30% 94%,
        12% 78%
      );
      background: linear-gradient(
        to right,
        oklch(var(--accent-custom-l) var(--accent-custom-c) 0),
        oklch(var(--accent-custom-l) var(--accent-custom-c) 60),
        oklch(var(--accent-custom-l) var(--accent-custom-c) 120),
        oklch(var(--accent-custom-l) var(--accent-custom-c) 180),
        oklch(var(--accent-custom-l) var(--accent-custom-c) 240),
        oklch(var(--accent-custom-l) var(--accent-custom-c) 300),
        oklch(var(--accent-custom-l) var(--accent-custom-c) 360)
      );
    }

    .hue-thumb {
      position: absolute;
      inset-block-start: 50%;
      inline-size: 22px;
      block-size: 22px;
      transform: translate(-50%, -50%);
      border-radius: var(--radius-50);
      pointer-events: none;
      box-shadow:
        0 0 0 3px var(--bg),
        0 0 0 4px color-mix(in oklch, var(--text-color) 22%, transparent),
        0 1px 2px color-mix(in oklch, var(--text-color) 30%, transparent);
    }

    .swatch-hint {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--text-faint);
      min-block-size: 1.2em;
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-s);
    }

    .hint-state {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      color: var(--text-muted);
    }

    .hint-dot {
      inline-size: 9px;
      block-size: 9px;
      border-radius: var(--radius-50);
      box-shadow: 0 0 0 1px var(--border-color-light) inset;
      flex: none;
    }

    .swatch-clear {
      background: transparent;
      border: 0;
      padding: 0;
      font-family: inherit;
      font-size: var(--text-xs);
      color: var(--text-muted);
      cursor: pointer;
      text-decoration: underline dotted;
      text-underline-offset: 2px;
      white-space: nowrap;
    }

    .swatch-clear:hover {
      color: var(--text-color);
    }
  }
</style>
