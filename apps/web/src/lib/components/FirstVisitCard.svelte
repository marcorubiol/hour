<script lang="ts">
  /**
   * FirstVisitCard: la tarjeta de bienvenida de una sección (ayuda contextual,
   * enfoque A). Dentro de la página, arriba, la primera vez: qué responde la
   * sección, «Entendido» y, si hay pasos, «Enséñame». Sale una vez por persona
   * (`help_seen`) y vuelve con el «?» de la cabecera (`LensHeader`).
   *
   * «Enséñame» es el `Spotlight`: tres pasos como mucho sobre los bloques
   * marcados con `data-help-step`. Un paso cuyo bloque no está dibujado se
   * salta. Al acabar, o con «Entendido», queda vista.
   */
  import { tick } from 'svelte';
  import { t, appLocale } from '$lib/i18n';
  import { cardKey, cardVisible, presentSteps, type HelpSection, type TourStep } from '$lib/help';
  import { help, ensureHelp, markHelpSeen } from '$lib/help-seen.svelte';
  import Spotlight from '$lib/components/Spotlight.svelte';

  interface Props {
    section: HelpSection;
    /** Los `data-help-step` de cada paso, en orden; sin ellos no hay «Enséñame». */
    steps?: readonly string[];
    /** Antes del recorrido: lleva la página a donde están los bloques (la Temporada del Planificador). */
    onbeforetour?: () => void | Promise<void>;
    /** Una línea más, ya traducida, para quien la necesita (en Cuentas, quien administra). */
    note?: string | null;
  }
  let { section, steps = [], onbeforetour, note = null }: Props = $props();

  const locale = appLocale();
  const id = $props.id();
  let key = $derived(cardKey(section));
  let visible = $derived(cardVisible(help, key));

  let headEl: HTMLElement | undefined = $state();
  let tour = $state<TourStep[] | null>(null);

  $effect(() => {
    void ensureHelp();
  });

  // The «?» opened it: the reader goes where it opened.
  $effect(() => {
    if (help.reopened === key) tick().then(() => headEl?.focus());
  });

  async function startTour() {
    await onbeforetour?.();
    await tick();
    const list = presentSteps(
      steps.map((target, i) => ({ target, text: t(`help.card.${section}_step_${i + 1}`, locale) })),
      (target) => document.querySelector(`[data-help-step="${target}"]`) !== null,
    );
    if (list.length === 0) return done();
    tour = list;
  }

  function done() {
    tour = null;
    markHelpSeen(key);
    // Back to the «?» that brings it back, so the keyboard is not dropped on the body.
    tick().then(() => document.getElementById(`help-${section}`)?.focus({ preventScroll: true }));
  }
</script>

{#if tour}
  <Spotlight steps={tour} ondone={done} />
{:else if visible}
  <aside class="welcome" aria-labelledby={`${id}-h`} data-testid="first-visit-card" data-section={section}>
    <h2 class="welcome__title" id={`${id}-h`} tabindex="-1" bind:this={headEl}>{t(`help.card.${section}`, locale)}</h2>
    <p class="welcome__body">{t(`help.card.${section}_body`, locale)}</p>
    {#if note}<p class="welcome__body">{note}</p>{/if}
    <p class="welcome__acts">
      <button type="button" class="btn--primary btn--s" onclick={done}>{t('help.got_it', locale)}</button>
      {#if steps.length > 0}
        <button type="button" class="btn--secondary btn--s" onclick={startTour}>{t('help.show_me', locale)}</button>
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
  }
</style>
