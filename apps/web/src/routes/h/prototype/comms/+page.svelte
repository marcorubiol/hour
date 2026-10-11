<script lang="ts">
  /**
   * Maqueta de comms (ADR-099, puntos 5 y 6). No es funcionalidad: datos
   * inventados en `data.ts`, nada habla con el servidor. Ruta de prototipo,
   * sin enlace desde la navegación. La vista va en `?vista=` y la variante
   * del tablón en `?variante=`, para poder enlazar y capturar cada pantalla.
   */
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Pill from '$lib/components/Pill.svelte';
  import ConversationMock from './ConversationMock.svelte';
  import MailboxesMock from './MailboxesMock.svelte';
  import DayBoardMock from './DayBoardMock.svelte';

  type View = 'conversacion' | 'buzones' | 'tablon';
  const VIEWS: { id: View; label: string }[] = [
    { id: 'conversacion', label: 'Conversación' },
    { id: 'buzones', label: 'Buzones' },
    { id: 'tablon', label: 'Tablón del día' },
  ];

  let view = $derived<View>(
    VIEWS.find((v) => v.id === page.url.searchParams.get('vista'))?.id ?? 'conversacion',
  );

  function show(id: View) {
    const url = new URL(page.url);
    url.searchParams.set('vista', id);
    url.searchParams.delete('variante');
    url.searchParams.delete('lectura');
    void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
  }
</script>

<svelte:head>
  <title>Comms, maqueta · Hour</title>
</svelte:head>

<div class="proto">
  <header class="proto__mast">
    <p class="eyebrow">Maqueta · ADR-099 · datos inventados</p>
    <div class="proto__switch" role="group" aria-label="Pantalla">
      {#each VIEWS as v (v.id)}
        <Pill size="sm" active={view === v.id} ariaPressed={view === v.id} onclick={() => show(v.id)}>
          {v.label}
        </Pill>
      {/each}
    </div>
  </header>

  {#if view === 'conversacion'}
    <ConversationMock />
  {:else if view === 'buzones'}
    <MailboxesMock />
  {:else}
    <DayBoardMock />
  {/if}
</div>

<style>
  @layer components {
    .proto {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
    }
    .proto__mast {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s);
      padding-block-end: var(--space-s);
      border-block-end: 1px dashed var(--border-color-dark);
    }
    .proto__switch {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
    }
  }
</style>
