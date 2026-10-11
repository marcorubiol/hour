<script lang="ts">
  /**
   * Pantalla 3: el tablón del día de un bolo de tres funciones (ADR-099 §6).
   *  (a) todo cuelga del bolo; técnica marca de qué función habla.
   *  (b) por faceta: general, logística, comidas y dinero en el bolo;
   *      técnica en cada función.
   * Mismos mensajes en las dos; solo cambia dónde cuelgan.
   */
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Avatar from '$lib/components/Avatar.svelte';
  import Pill from '$lib/components/Pill.svelte';
  import { FACETS, board, bolo, performances, type BoardMessage, type Facet } from './data';

  type Variant = 'lado' | 'bolo' | 'faceta';
  const VARIANTS: { id: Variant; label: string }[] = [
    { id: 'lado', label: 'Lado a lado' },
    { id: 'bolo', label: 'a · Todo en el bolo' },
    { id: 'faceta', label: 'b · Por faceta' },
  ];
  let variant = $derived<Variant>(
    VARIANTS.find((v) => v.id === page.url.searchParams.get('variante'))?.id ?? 'lado',
  );
  function setVariant(v: Variant) {
    const url = new URL(page.url);
    url.searchParams.set('variante', v);
    void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
  }

  const BOLO_FACETS: Facet[] = ['general', 'tecnica', 'logistica', 'comidas', 'dinero'];
  const BOLO_FACETS_B: Facet[] = ['general', 'logistica', 'comidas', 'dinero'];

  function of(facet: Facet, performance?: string): BoardMessage[] {
    return board.filter((m) => m.facet === facet && (!performance || m.performance === performance));
  }
  function perfLabel(id?: string): string {
    const p = performances.find((x) => x.id === id);
    return p ? `${p.day} · ${p.time}` : '';
  }
</script>

<section class="day">
  <header class="day__mast">
    <p class="eyebrow">Bolo · {bolo.venue} · {bolo.city}</p>
    <h1 class="day__title"><em>{bolo.title}</em></h1>
    <p class="day__sub">
      <span>{bolo.days}</span>
      <span>3 funciones: {performances.map((p) => `${p.day} ${p.time}`).join(', ')}</span>
      <span>{bolo.team.length} del equipo</span>
    </p>
  </header>

  <div class="day__switch" role="group" aria-label="Variante">
    {#each VARIANTS as v (v.id)}
      <Pill size="sm" active={variant === v.id} ariaPressed={variant === v.id} onclick={() => setVariant(v.id)}>
        {v.label}
      </Pill>
    {/each}
  </div>

  <div class="day__cols" class:day__cols--one={variant !== 'lado'}>
    {#if variant !== 'faceta'}
      <section class="col" aria-labelledby="col-a">
        <header class="col__head">
          <h2 id="col-a" class="col__title">a · Todo colgado del bolo</h2>
          <p class="col__note">Un tablón para las tres funciones. Técnica dice de qué función habla.</p>
        </header>
        <div class="container">
          <p class="container__name">Bolo · {bolo.days}</p>
          {#each BOLO_FACETS as f (f)}
            {@render thread(f, of(f), true)}
          {/each}
        </div>
      </section>
    {/if}

    {#if variant !== 'bolo'}
      <section class="col" aria-labelledby="col-b">
        <header class="col__head">
          <h2 id="col-b" class="col__title">b · Por faceta</h2>
          <p class="col__note">Comidas y logística en el bolo; técnica en cada función, junto a su hoja de ruta.</p>
        </header>
        <div class="container">
          <p class="container__name">Bolo · {bolo.days}</p>
          {#each BOLO_FACETS_B as f (f)}
            {@render thread(f, of(f), false)}
          {/each}
        </div>
        {#each performances as p (p.id)}
          <div class="container container--perf">
            <p class="container__name">
              Función · {p.day} · {p.time}
              <a class="link-arrow" href="#hoja-{p.id}" id="hoja-{p.id}">Hoja de ruta →</a>
            </p>
            {@render thread('tecnica', of('tecnica', p.id), false)}
          </div>
        {/each}
      </section>
    {/if}
  </div>
</section>

{#snippet thread(facet: Facet, msgs: BoardMessage[], markPerf: boolean)}
  <article class="thread">
    <header class="thread__head">
      <h3 class="thread__name">{FACETS[facet].label}</h3>
      <span class="thread__count">{msgs.length}</span>
      <span class="thread__aud">{FACETS[facet].audience}</span>
    </header>
    {#if msgs.length === 0}
      <p class="thread__empty">Sin mensajes.</p>
    {:else}
      <ol class="thread__list">
        {#each msgs as m (m.id)}
          <li class="msg">
            <Avatar size="xs" name={m.by} tone="neutral" />
            <div>
              <p class="msg__head">
                <span class="msg__by">{m.by}</span>
                <span>{m.when}</span>
                {#if markPerf && m.performance}<span class="msg__perf">{perfLabel(m.performance)}</span>{/if}
              </p>
              <p class="msg__text">{m.body}</p>
            </div>
          </li>
        {/each}
      </ol>
    {/if}
  </article>
{/snippet}

<style>
  @layer components {
    .day {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }
    .day__mast {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .day__mast p,
    .day__title {
      margin: 0;
    }
    .day__sub {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs) var(--space-s);
      color: var(--text-muted);
      font-size: var(--text-s);
    }
    .day__sub > * + *::before {
      content: '·';
      margin-inline-end: var(--space-s);
      color: var(--text-faint);
    }
    .day__switch {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
    }

    .day__cols {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-xl);
      align-items: start;
    }
    .day__cols--one {
      grid-template-columns: minmax(0, 46rem);
    }
    @media (max-width: 63.999rem) {
      .day__cols {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .col {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }
    .col__head {
      padding-block-end: var(--space-xs);
      border-block-end: 1px solid var(--border-color-dark);
    }
    .col__title {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--h3);
      font-style: italic;
      font-weight: 400;
    }
    .col__note {
      margin: var(--space-2xs) 0 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }

    .container {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }
    .container__name {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-s);
      margin: 0;
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
    }
    .container__name .link-arrow {
      font-family: var(--font-sans);
      letter-spacing: normal;
      text-transform: none;
    }

    .thread {
      padding: var(--space-s) var(--space-m);
      background: var(--bg-ultra-light);
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius);
    }
    .thread__head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs);
      padding-block-end: var(--space-xs);
      border-block-end: 1px solid var(--border-color-light);
    }
    .thread__name {
      margin: 0;
      color: var(--heading-color);
      font-family: var(--font-sans);
      font-size: var(--text-s);
      font-weight: 500;
      letter-spacing: normal;
    }
    .thread__count {
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
    }
    .thread__aud {
      margin-inline-start: auto;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .thread__empty {
      margin: var(--space-s) 0 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .thread__list {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      list-style: none;
      margin: var(--space-s) 0 0;
      padding: 0;
    }

    .msg {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: var(--space-s);
      align-items: start;
    }
    .msg p {
      margin: 0;
    }
    .msg__head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs);
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .msg__by {
      color: var(--heading-color);
      font-weight: 500;
    }
    .msg__perf {
      padding-inline: var(--space-xs);
      color: var(--tag-blue-fg);
      background: var(--tag-blue-bg);
      border-radius: var(--radius-s);
      font-family: var(--font-mono);
      letter-spacing: var(--mono-letter-spacing);
    }
    .msg__text {
      font-size: var(--text-s);
    }
  }
</style>
