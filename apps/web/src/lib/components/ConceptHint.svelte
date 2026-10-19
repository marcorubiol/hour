<script lang="ts">
  /**
   * ConceptHint: la «i» pegada a una palabra de Hour (ayuda contextual,
   * enfoque A). Un toque, un clic, Enter o Espacio la abren; tocar fuera,
   * Escape o volver a pulsarla la cierran. No se guarda nunca: está siempre.
   *
   * Es el `popover` del navegador, no uno hecho a mano: el abrir y cerrar con
   * teclado y con el dedo, el cierre al tocar fuera, el foco que vuelve al
   * botón y la capa superior (ninguna celda lo recorta) vienen del medio. Aquí
   * solo se coloca el panel bajo la «i», dentro de la pantalla.
   *
   * El panel es `span` para poder vivir dentro de una línea de texto o de una
   * leyenda. Se pone FUERA de un encabezado o un enlace: un botón dentro de
   * un `h2` le cambiaría el nombre, y dentro de un `a` no es válido.
   */
  import { t, appLocale } from '$lib/i18n';
  import { conceptKeys, type HelpConcept } from '$lib/help';

  interface Props {
    concept: HelpConcept;
  }
  let { concept }: Props = $props();

  const locale = appLocale();
  const id = $props.id();
  let keys = $derived(conceptKeys(concept));
  let title = $derived(t(keys.title, locale));

  let open = $state(false);
  let button: HTMLButtonElement | undefined = $state();
  let panel: HTMLElement | undefined = $state();

  /** Bajo la «i», alineado con ella; si no cabe debajo, encima; nunca fuera. */
  function place() {
    if (!button || !panel) return;
    const b = button.getBoundingClientRect();
    // Half a rem from the edges and from the «i», as the panel's max width says.
    const gap = parseFloat(getComputedStyle(document.documentElement).fontSize) / 2;
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const left = Math.max(gap, Math.min(b.left, vw - w - gap));
    const below = b.bottom + gap;
    const top = below + h <= vh - gap || b.top - gap - h < gap ? below : b.top - gap - h;
    panel.style.setProperty('--hint-x', `${left}px`);
    panel.style.setProperty('--hint-y', `${top}px`);
  }

  function ontoggle(e: ToggleEvent) {
    open = e.newState === 'open';
    if (open) place();
  }

  $effect(() => {
    if (!open) return;
    const follow = () => place();
    window.addEventListener('scroll', follow, { capture: true, passive: true });
    window.addEventListener('resize', follow, { passive: true });
    return () => {
      window.removeEventListener('scroll', follow, { capture: true });
      window.removeEventListener('resize', follow);
    };
  });
</script>

<button
  type="button"
  class="hint"
  bind:this={button}
  popovertarget={id}
  aria-expanded={open}
  aria-label={t('help.hint_aria', locale, { name: title })}
  data-concept={concept}
><span aria-hidden="true">i</span></button><span
  {id}
  class="hint__panel"
  popover="auto"
  role="note"
  bind:this={panel}
  {ontoggle}
  ><strong class="hint__title">{title}</strong> <span class="hint__body">{t(keys.body, locale)}</span></span
>

<style>
  @layer components {
    /* The «i»: a small ring in the line's own size, quiet until you look for
       it. A finger gets the system's target by padding, never by type. */
    .hint {
      position: relative;
      display: inline-grid;
      place-items: center;
      inline-size: 1.4em;
      block-size: 1.4em;
      margin-inline-start: var(--space-2xs);
      padding: 0;
      border: var(--border-width) solid var(--border-color-dark);
      border-radius: var(--radius-circle);
      background: none;
      color: var(--text-faint);
      font-family: var(--font-display);
      font-style: italic;
      font-size: var(--text-xs);
      line-height: 1;
      letter-spacing: normal;
      text-transform: none;
      vertical-align: middle;
      cursor: pointer;
      transition:
        color var(--transition),
        border-color var(--transition);
    }
    .hint:hover,
    .hint[aria-expanded='true'] {
      color: var(--text-color);
      border-color: var(--text-muted);
    }
    .hint:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: var(--focus-offset);
    }
    /* The finger's target is a ring of nothing around the drawn one: zero
       for a mouse, the system's 44 on a coarse pointer (`--touch-target`). */
    .hint::before {
      content: '';
      position: absolute;
      inset: min(0em, calc((1.4em - var(--touch-target)) / 2));
    }

    /* The panel: the browser's popover, set beside its «i» by the script. */
    .hint__panel {
      position: fixed;
      inset: auto;
      inset-block-start: var(--hint-y, 0);
      inset-inline-start: var(--hint-x, 0);
      margin: 0;
      box-sizing: border-box;
      inline-size: max-content;
      max-inline-size: min(22rem, calc(100vw - 1rem));
      padding: var(--space-s) var(--space-m);
      border: var(--border);
      border-radius: var(--radius-s);
      background: var(--bg-light);
      box-shadow: var(--box-shadow-2);
      color: var(--text-dark-muted);
      font-family: var(--font-sans);
      font-style: normal;
      font-size: var(--text-s);
      font-weight: 400;
      line-height: 1.45;
      letter-spacing: normal;
      text-transform: none;
      text-align: start;
      white-space: normal;
    }
    .hint__panel:not(:popover-open) {
      display: none;
    }
    .hint__title {
      display: block;
      margin-block-end: var(--space-2xs);
      color: var(--heading-color);
      font-weight: 600;
    }
  }
</style>
