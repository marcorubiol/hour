<script lang="ts">
  /**
   * FirstVisitCard: la tarjeta de bienvenida de una sección (ayuda contextual,
   * enfoque A). Dentro de la página, arriba, la primera vez: qué responde la
   * sección, «Entendido» y, si hay pasos, «Enséñame». Sale una vez por persona
   * (`help_seen`) y vuelve con el «?» de la cabecera (`LensHeader`).
   *
   * «Enséñame» es un recorrido de tres pasos como mucho, sin capa oscura:
   * cada paso resalta los bloques marcados con `data-help-step="<target>"`
   * (puede ser más de uno) y dice su frase en una barra al pie, que no tapa
   * el bloque porque el bloque se trae al centro. Un paso cuyo bloque no
   * está dibujado se salta. Al acabar, o con «Entendido», queda vista.
   */
  import { tick } from 'svelte';
  import { t, appLocale } from '$lib/i18n';
  import { cardKey, cardVisible, presentSteps, type HelpSection, type TourStep } from '$lib/help';
  import { help, ensureHelp, markHelpSeen } from '$lib/help-seen.svelte';

  interface Props {
    section: HelpSection;
    /** Los `data-help-step` de cada paso, en orden; sin ellos no hay «Enséñame». */
    steps?: readonly string[];
    /** Antes del recorrido: lleva la página a donde están los bloques (la Temporada del Planificador). */
    onbeforetour?: () => void | Promise<void>;
  }
  let { section, steps = [], onbeforetour }: Props = $props();

  const locale = appLocale();
  const id = $props.id();
  let key = $derived(cardKey(section));
  let visible = $derived(cardVisible(help, key));

  let headEl: HTMLElement | undefined = $state();
  let nextEl: HTMLButtonElement | undefined = $state();
  let tour = $state<TourStep[] | null>(null);
  let at = $state(0);

  $effect(() => {
    void ensureHelp();
  });

  // The «?» opened it: the reader goes where it opened.
  $effect(() => {
    if (help.reopened === key) tick().then(() => headEl?.focus());
  });

  const FOCUS = 'data-help-focus';
  const targets = (target: string) => document.querySelectorAll<HTMLElement>(`[data-help-step="${target}"]`);

  function clearFocus() {
    for (const el of document.querySelectorAll(`[${FOCUS}]`)) el.removeAttribute(FOCUS);
  }

  function show(step: TourStep) {
    clearFocus();
    const els = [...targets(step.target)];
    for (const el of els) el.setAttribute(FOCUS, '');
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    els[0]?.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  }

  async function startTour() {
    await onbeforetour?.();
    await tick();
    const list = presentSteps(
      steps.map((target, i) => ({ target, text: t(`help.card.${section}_step_${i + 1}`, locale) })),
      (target) => targets(target).length > 0,
    );
    if (list.length === 0) return done();
    tour = list;
    at = 0;
    // The bar first: the room it makes is what lets the step reach the middle.
    await tick();
    show(list[0]);
    nextEl?.focus({ preventScroll: true });
  }

  function next() {
    if (!tour) return;
    if (at + 1 >= tour.length) return done();
    at += 1;
    show(tour[at]);
  }

  function done() {
    clearFocus();
    tour = null;
    markHelpSeen(key);
    // Back to the «?» that brings it back, so the keyboard is not dropped on the body.
    tick().then(() => document.getElementById(`help-${section}`)?.focus({ preventScroll: true }));
  }

  // A tour left by navigating away takes its marks with it.
  $effect(() => () => clearFocus());
</script>

{#if tour}
  <div
    class="tour"
    data-help-tour
    role="dialog"
    aria-modal="false"
    tabindex="-1"
    aria-labelledby={`${id}-step`}
    onkeydown={(e) => {
      if (e.key === 'Escape') done();
    }}
  >
    <p class="tour__text" id={`${id}-step`}>
      <span class="tour__n">{at + 1}/{tour.length}</span>
      {tour[at].text}
    </p>
    <button type="button" class="btn--outline btn--s" bind:this={nextEl} onclick={next}>
      {at + 1 >= tour.length ? t('help.tour_done', locale) : t('help.tour_next', locale)}
    </button>
  </div>
{:else if visible}
  <aside class="welcome" aria-labelledby={`${id}-h`} data-testid="first-visit-card" data-section={section}>
    <h2 class="welcome__title" id={`${id}-h`} tabindex="-1" bind:this={headEl}>{t(`help.card.${section}`, locale)}</h2>
    <p class="welcome__body">{t(`help.card.${section}_body`, locale)}</p>
    <p class="welcome__acts">
      <button type="button" class="btn--primary btn--s" onclick={done}>{t('help.got_it', locale)}</button>
      {#if steps.length > 0}
        <button type="button" class="btn--outline btn--s" onclick={startTour}>{t('help.show_me', locale)}</button>
      {/if}
    </p>
  </aside>
{/if}

<style>
  @layer components {
    /* The welcome is the page's own paper, a step quieter than a card: it
       sits above the dashboard and says what the section answers. */
    .welcome {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      padding: var(--space-m);
      border: var(--border);
      border-radius: var(--radius-s);
      background: var(--bg-ultra-light);
    }
    .welcome__title {
      margin: 0;
      font-family: var(--font-display);
      font-style: italic;
      font-weight: 400;
      font-size: var(--text-l);
      color: var(--heading-color);
    }
    .welcome__title:focus {
      outline: none;
    }
    .welcome__title:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: var(--focus-offset);
    }
    .welcome__body {
      margin: 0;
      max-inline-size: 60ch;
      color: var(--text-dark-muted);
      font-size: var(--text-s);
    }
    .welcome__acts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
      margin: var(--space-2xs) 0 0;
    }

    /* The tour's bar: at the foot of the screen, never over the block it
       names (the block is brought to the middle). No veil: the page stays
       the page. */
    .tour {
      position: fixed;
      inset-inline: var(--space-m);
      inset-block-end: var(--space-m);
      z-index: var(--z-toast);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s) var(--space-m);
      max-inline-size: 36rem;
      margin-inline: auto;
      padding: var(--space-s) var(--space-m);
      border: var(--border);
      border-radius: var(--radius-s);
      background: var(--bg-light);
      box-shadow: var(--box-shadow-2);
    }
    .tour__text {
      flex: 1 1 16rem;
      margin: 0;
      color: var(--text-color);
      font-size: var(--text-s);
    }
    .tour__n {
      margin-inline-end: var(--space-xs);
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
    }
    /* While the bar is up the page gets room under its last block, so the
       last step can come up to the middle too, and what is scrolled into
       view stops above the bar (the `.action-bar` rule, base.css). */
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
