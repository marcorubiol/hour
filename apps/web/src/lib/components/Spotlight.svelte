<script lang="ts">
  /**
   * Spotlight: el «Enséñame» de una tarjeta de bienvenida (ayuda contextual,
   * enfoque A). Tres pasos como mucho y sin capa oscura: cada paso resalta los
   * bloques marcados con `data-help-step="<target>"` (puede ser más de uno),
   * los trae al centro y dice su frase justo debajo del primero; si debajo no
   * cabe, encima; si el bloque es más alto que la pantalla, al pie. En el
   * móvil eso es «el texto debajo del bloque, no flotando» (investigación § 3).
   *
   * Los pasos llegan ya filtrados (`presentSteps`): un bloque que no está no
   * es un paso. Escape, «Hecho» o salir de la página lo terminan.
   */
  import { tick } from 'svelte';
  import { t, appLocale } from '$lib/i18n';
  import type { TourStep } from '$lib/help';

  interface Props {
    steps: TourStep[];
    ondone: () => void;
  }
  let { steps, ondone }: Props = $props();

  const locale = appLocale();
  const id = $props.id();
  let at = $state(0);
  let panel: HTMLElement | undefined = $state();
  let nextEl: HTMLButtonElement | undefined = $state();
  /** Where the words sit: beside the block, or at the foot when it is taller than the screen. */
  let docked = $state(false);

  const FOCUS = 'data-help-focus';
  const targets = (target: string) => [...document.querySelectorAll<HTMLElement>(`[data-help-step="${target}"]`)];

  function clearFocus() {
    for (const el of document.querySelectorAll(`[${FOCUS}]`)) el.removeAttribute(FOCUS);
  }

  /** Under the block and aligned with it; above when below does not fit; else docked. */
  function place() {
    const el = targets(steps[at]?.target ?? '')[0];
    if (!el || !panel) return;
    const r = el.getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const gap = rem / 2;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    // As wide as the block, never narrower than a readable line (18rem) or wider than the screen.
    const room = vw - 2 * gap;
    const w = Math.min(room, Math.max(r.width, 18 * rem));
    panel.style.setProperty('--spot-w', `${w}px`);
    const h = panel.offsetHeight;
    const left = Math.max(gap, Math.min(r.left, vw - w - gap));
    let top: number | null = null;
    if (r.bottom + gap + h <= vh - gap) top = r.bottom + gap;
    else if (r.top - gap - h >= gap) top = r.top - gap - h;
    docked = top === null;
    panel.style.setProperty('--spot-x', `${left}px`);
    panel.style.setProperty('--spot-y', `${top ?? 0}px`);
  }

  function show() {
    clearFocus();
    const els = targets(steps[at].target);
    for (const el of els) el.setAttribute(FOCUS, '');
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    els[0]?.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
    place();
  }

  function next() {
    if (at + 1 >= steps.length) return finish();
    at += 1;
    show();
  }

  function finish() {
    clearFocus();
    ondone();
  }

  // The panel exists first: the room it makes is what lets the last step reach the middle.
  $effect(() => {
    tick().then(() => {
      show();
      nextEl?.focus({ preventScroll: true });
    });
    const follow = () => place();
    window.addEventListener('scroll', follow, { capture: true, passive: true });
    window.addEventListener('resize', follow, { passive: true });
    return () => {
      window.removeEventListener('scroll', follow, { capture: true });
      window.removeEventListener('resize', follow);
      clearFocus();
    };
  });
</script>

<div
  class="spot"
  class:spot--docked={docked}
  role="dialog"
  aria-modal="false"
  tabindex="-1"
  aria-labelledby={`${id}-step`}
  data-help-tour
  bind:this={panel}
  onkeydown={(e) => {
    if (e.key === 'Escape') finish();
  }}
>
  <p class="spot__text" id={`${id}-step`}>
    <span class="spot__n">{at + 1}/{steps.length}</span>
    {steps[at].text}
  </p>
  <button type="button" class="btn--outline btn--s" bind:this={nextEl} onclick={next}>
    {at + 1 >= steps.length ? t('help.tour_done', locale) : t('help.tour_next', locale)}
  </button>
</div>

<style>
  @layer components {
    /* The step's words, set under the block they name by the script. No
       veil: the page stays the page. */
    .spot {
      position: fixed;
      inset-block-start: var(--spot-y, auto);
      inset-inline-start: var(--spot-x, var(--space-m));
      z-index: var(--z-toast);
      box-sizing: border-box;
      inline-size: var(--spot-w, auto);
      max-inline-size: 36rem;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s) var(--space-m);
      padding: var(--space-s) var(--space-m);
      border: var(--border);
      border-radius: var(--radius-s);
      background: var(--bg-light);
      box-shadow: var(--box-shadow-2);
    }
    /* A block taller than the screen: the words wait at its foot. */
    .spot--docked {
      inset-block-start: auto;
      inset-block-end: var(--space-m);
      inset-inline: var(--space-m);
      inline-size: auto;
      margin-inline: auto;
    }
    .spot__text {
      flex: 1 1 14rem;
      margin: 0;
      color: var(--text-color);
      font-size: var(--text-s);
    }
    .spot__n {
      margin-inline-end: var(--space-xs);
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
    }
    /* While a step is up the page gets room under its last block, so the
       last step can come up to the middle too, and what is scrolled into
       view keeps clear of the words (the `.action-bar` rule, base.css). */
    :global(:root:has([data-help-tour])) {
      --help-tour-room: calc(2 * var(--control-size-m) + 2 * var(--space-m));
      scroll-padding-block-end: var(--help-tour-room);
    }
    :global(main:has([data-help-tour])) {
      padding-block-end: var(--help-tour-room);
    }
    /* The block a step names: the focus ring's colour, drawn off its edge. */
    :global([data-help-focus]) {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: var(--space-2xs);
      border-radius: var(--radius-s);
    }
  }
</style>
