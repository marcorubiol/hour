<script lang="ts">
  /**
   * AccentSwatchPicker — the accent selector shared by the create dialogs
   * (workspace / project / line) and the identity editors. A single hue slider
   * IS the control: a pale bar carrying the hue wheel 0→360 across its width,
   * with 10 equidistant PRESET ticks and a draggable pin beneath it. Drag/click
   * to any hue; the pin MAGNETS to a tick when it comes within a few degrees
   * (that lands a preset), otherwise it's a custom hue. "auto" clears back to
   * the hash-from-name colour.
   *
   * The pin shows the real accent colour; the bar is the pale "background"
   * preview of the range. Stored as '1'..'10', 'h<0-360>', or null (auto).
   * Lightness + chroma are fixed by the palette tokens so any colour stays soft
   * and adapts light/dark (see $lib/utils/accent).
   */

  import {
    ACCENT_COUNT,
    PALETTE_HUES,
    accentIndex,
    accentVarFor,
    customAccent,
    customHue,
    hueDistance,
    isCustomAccent,
  } from '$lib/utils/accent';

  interface Props {
    /** Selected accent: "1".."10", a custom hue "h<0-360>", or null for auto. */
    accent?: string | null;
    /** Slug the server would hash when accent is null (auto preview). */
    autoSlug: string;
    /** Slider accessible name, e.g. "Line color". */
    label: string;
    disabled?: boolean;
    /** Visually hide the "Color" legend (kept for screen readers). */
    hideLegend?: boolean;
  }

  let { accent = $bindable(null), autoSlug, label, disabled = false, hideLegend = false }: Props =
    $props();

  const SNAP_DEG = 7; // magnet radius around each preset tick

  let isCustom = $derived(isCustomAccent(accent));
  // Palette index the pin rests on when not custom: the chosen preset, else the
  // hash-derived one (auto). Old out-of-range indices wrap in.
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

  let trackEl: HTMLDivElement | undefined = $state();
  let dragging = $state(false);

  function hueAt(clientX: number): number {
    if (!trackEl) return hue;
    const r = trackEl.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return Math.min(359, Math.round(f * 360));
  }
  function nearestPresetIndex(raw: number): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < PALETTE_HUES.length; i++) {
      const d = hueDistance(raw, PALETTE_HUES[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
  function onPointerDown(e: PointerEvent) {
    if (disabled) return;
    dragging = true;
    trackEl?.setPointerCapture(e.pointerId);
    // A click lands on the nearest PRESET — precise colours only. Dragging off
    // it (below) is what reaches a custom hue in between.
    accent = String(nearestPresetIndex(hueAt(e.clientX)) + 1);
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging || disabled) return;
    // Now dragging: magnet to a tick within SNAP_DEG, else a free custom hue.
    const raw = hueAt(e.clientX);
    const i = nearestPresetIndex(raw);
    accent = hueDistance(raw, PALETTE_HUES[i]) <= SNAP_DEG ? String(i + 1) : customAccent(raw);
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
</script>

<fieldset class="picker">
  <legend class:legend--hidden={hideLegend}>Color</legend>

  <div
    class="track"
    bind:this={trackEl}
    role="slider"
    tabindex={disabled ? -1 : 0}
    aria-label={label}
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
    <div class="track__bar" aria-hidden="true"></div>
    {#each PALETTE_HUES as h, i (i)}
      <span class="track__tick" style={`left: ${(h / 360) * 100}%`} aria-hidden="true"></span>
    {/each}
    <div
      class="track__thumb"
      style={`left: ${(hue / 360) * 100}%; --thumb: ${currentColor}`}
      aria-hidden="true"
    >
      <span class="track__chip"></span>
    </div>
  </div>

  <p class="picker__hint">
    {#if isCustom}
      <span class="hint-state">
        <span class="hint-dot" style={`background: ${currentColor}`} aria-hidden="true"></span>
        Custom {hue}°
      </span>
    {:else}
      <span></span>
    {/if}
    {#if accent}
      <button type="button" class="hint-reset" onclick={() => (accent = null)} {disabled}
        >auto</button
      >
    {/if}
  </p>
</fieldset>

<style>
  @layer components {
    .picker {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      border: 0;
      padding: 0;
      margin: 0;
    }

    .picker > legend {
      padding: 0;
      font-size: var(--text-xs);
      color: var(--text-dark-muted);
    }

    .picker > legend.legend--hidden {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    /* The slider itself is the whole control: a pale hue bar with preset ticks
       and a pin hanging beneath it. */
    .track {
      position: relative;
      block-size: 54px;
      cursor: pointer;
      touch-action: none;
    }
    .track:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 4px;
      border-radius: var(--radius-m);
    }

    .track__bar {
      position: absolute;
      inset-inline: 0;
      inset-block-start: 2px;
      block-size: 20px;
      border-radius: 999px;
      pointer-events: none;
      box-shadow: 0 0 0 1px var(--border-color-light) inset;
      /* Pale pastel preview of the hue wheel (high L, low C — see --accent-track-*). */
      background: linear-gradient(
        to right,
        oklch(var(--accent-track-l) var(--accent-track-c) 0),
        oklch(var(--accent-track-l) var(--accent-track-c) 45),
        oklch(var(--accent-track-l) var(--accent-track-c) 90),
        oklch(var(--accent-track-l) var(--accent-track-c) 135),
        oklch(var(--accent-track-l) var(--accent-track-c) 180),
        oklch(var(--accent-track-l) var(--accent-track-c) 225),
        oklch(var(--accent-track-l) var(--accent-track-c) 270),
        oklch(var(--accent-track-l) var(--accent-track-c) 315),
        oklch(var(--accent-track-l) var(--accent-track-c) 360)
      );
    }

    /* Preset ticks — the 10 standard colours, marked on the pale bar. */
    .track__tick {
      position: absolute;
      inset-block-start: 6px;
      block-size: 12px;
      inline-size: 2px;
      transform: translateX(-50%);
      border-radius: 1px;
      pointer-events: none;
      background: color-mix(in oklch, var(--text-color) 18%, transparent);
    }

    /* The pin hangs below the bar: a light frame with a coloured ring, holding
       the current-colour chip inside (a thing within a thing), and a triangle
       pointing up at its hue. */
    .track__thumb {
      position: absolute;
      inset-block-start: 28px;
      transform: translateX(-50%);
      padding: 3px;
      border-radius: 8px;
      pointer-events: none;
      /* The frame fills with the identity mark's own soft tint (same recipe as
         IdentityMark's --_bg), so the pin previews the identity. */
      background: color-mix(in oklch, var(--thumb, var(--accent-1)) 16%, var(--bg-ultra-light));
      box-shadow:
        0 0 0 2px var(--thumb, var(--accent-1)),
        0 1px 3px color-mix(in oklch, var(--text-color) 28%, transparent);
    }
    .track__thumb::before {
      content: '';
      position: absolute;
      inset-block-start: -6px;
      inset-inline-start: 50%;
      transform: translateX(-50%);
      border-inline: 6px solid transparent;
      border-block-end: 6px solid var(--thumb, var(--accent-1));
    }
    .track__chip {
      display: block;
      inline-size: 16px;
      block-size: 16px;
      border-radius: 5px;
      background: var(--thumb, var(--accent-1));
    }

    .picker__hint {
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

    .hint-reset {
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
    .hint-reset:hover {
      color: var(--text-color);
    }
  }
</style>
