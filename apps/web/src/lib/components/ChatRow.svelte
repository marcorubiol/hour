<script lang="ts">
  /**
   * Una fila de la lista de Conversaciones con forma de chat (ADR-176): el
   * monograma de con quién (la organización, ADR-102; un hilo de bolo, con
   * trazo discontinuo: es un grupo), su nombre y cuándo; lo último que se
   * dijo y cuántos sin leer; y una línea pequeña de contexto (el turno, sólo
   * «te toca» en tinta, la etiqueta, el proyecto, el bolo). Tres líneas, la
   * misma fila para una conversación y para un hilo del equipo.
   *
   * El nombre es el enlace de la fila y la cubre entera. `active` marca la
   * que está abierta al lado (escritorio, dos paneles). En modo selección la
   * casilla ocupa la fila.
   */
  import type { Snippet } from 'svelte';
  import ChatMonogram from '$lib/components/ChatMonogram.svelte';

  interface Props {
    href: string | null;
    title: string;
    /** Un hilo de un bolo: monograma de trazo discontinuo. */
    group?: boolean;
    /** ISO del último movimiento y cómo se lee. */
    at?: string | null;
    when?: string;
    /** Sin leer: el número; 0, nada. */
    unread?: number;
    /** Su nombre para el lector de pantalla («2 nuevos»). */
    unreadLabel?: string | null;
    /** Quién dijo lo último («Tú», «Laia», «Llamada»). */
    lead?: string | null;
    last?: string | null;
    /** La línea de contexto; `ink` la pone en tinta (te toca). */
    context?: { text: string; ink?: boolean }[];
    active?: boolean;
    /** Abrir al lado en vez de navegar (escritorio): recibe el clic del enlace. */
    onopen?: (event: MouseEvent) => void;
    picking?: boolean;
    pick?: Snippet;
    picked?: boolean;
  }

  let {
    href,
    title,
    group = false,
    at = null,
    when = '',
    unread = 0,
    unreadLabel = null,
    lead = null,
    last = null,
    context = [],
    active = false,
    onopen,
    picking = false,
    pick,
    picked = false,
  }: Props = $props();

</script>

<div
  class="chat"
  class:is-new={unread > 0}
  class:is-active={active}
  class:is-picked={picked}
  class:chat--picking={picking && !!pick}
  data-group={group || undefined}
>
  {#if picking && pick}<span class="chat__pick">{@render pick()}</span>{/if}
  <span class="chat__mono"><ChatMonogram name={title} {group} /></span>
  <span class="chat__top">
    {#if href}
      <a class="chat__title" {href} aria-current={active ? 'true' : undefined} data-peek={onopen ? 'off' : undefined} onclick={onopen}
        >{title}</a
      >
    {:else}
      <span class="chat__title">{title}</span>
    {/if}
    {#if at}<time class="chat__when" datetime={at}>{when}</time>{/if}
  </span>
  <span class="chat__mid">
    <span class="chat__last"
      >{#if lead}<span class="chat__lead">{lead}{last ? ':' : ''}</span>{#if last}{' '}{/if}{/if}{last ?? ''}</span
    >
    {#if unread > 0}<span class="chat__unread" title={unreadLabel ?? undefined}
        ><span aria-hidden="true">{unread}</span>{#if unreadLabel}<span class="visually-hidden">{unreadLabel}</span>{/if}</span
      >{/if}
  </span>
  {#if context.length > 0}
    <span class="chat__ctx">
      {#each context as c, i (i)}<span class:is-ink={c.ink}>{c.text}</span>{/each}
    </span>
  {/if}
</div>

<style>
  @layer components {
    .chat {
      position: relative;
      display: grid;
      grid-template-columns: [mono] auto [body] minmax(0, 1fr);
      grid-template-areas:
        'mono top'
        'mono mid'
        'mono ctx';
      column-gap: var(--space-s);
      row-gap: var(--space-2xs);
      align-items: baseline;
      padding: var(--space-s);
      transition: background-color var(--transition);
    }
    .chat:hover,
    .chat.is-picked {
      background: var(--bg-ultra-light);
    }
    .chat.is-active {
      background: var(--bg-light);
    }

    .chat--picking {
      grid-template-columns: [pick] auto [mono] auto [body] minmax(0, 1fr);
      grid-template-areas:
        'pick mono top'
        'pick mono mid'
        'pick mono ctx';
    }
    .chat__pick {
      grid-area: pick;
      grid-row: 1 / -1;
      align-self: center;
    }
    /* Picking: the checkbox's label is the whole row, as in the old row. */
    .chat--picking .chat__pick :global(.check__row) {
      position: static;
    }
    .chat--picking .chat__pick :global(.check__row)::after {
      content: '';
      position: absolute;
      inset: 0;
      z-index: var(--z-raised);
      cursor: pointer;
    }

    .chat__mono {
      grid-area: mono;
      grid-row: 1 / -1;
      align-self: start;
      display: flex;
    }

    .chat__top,
    .chat__mid {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-s);
      min-inline-size: 0;
    }
    .chat__top {
      grid-area: top;
    }
    .chat__mid {
      grid-area: mid;
    }
    .chat__title {
      min-inline-size: 0;
      overflow: hidden;
      color: var(--text-color);
      font-size: var(--text-m);
      text-decoration: none;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .is-new .chat__title {
      font-weight: 500;
    }
    /* The title is the row's link: its area is the whole row. */
    a.chat__title::after {
      content: '';
      position: absolute;
      inset: 0;
    }
    a.chat__title:focus-visible {
      outline: none;
    }
    a.chat__title:focus-visible::after {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: calc(-1 * var(--focus-width));
    }
    .chat__when {
      flex-shrink: 0;
      font-size: var(--text-xs);
      color: var(--text-faint);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .is-new .chat__when {
      color: var(--info-dark);
    }

    .chat__last {
      min-inline-size: 0;
      overflow: hidden;
      font-size: var(--text-s);
      color: var(--text-muted);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chat__lead {
      color: var(--text-color);
    }
    /* Sin leer: una cifra en un círculo, el único color de la fila. */
    .chat__unread {
      flex-shrink: 0;
      display: inline-grid;
      place-items: center;
      min-inline-size: var(--chat-badge);
      block-size: var(--chat-badge);
      padding-inline: var(--space-2xs);
      border-radius: var(--radius-circle);
      background: var(--tone-info-bg);
      color: var(--tone-info-fg);
      font-weight: 500;
      font-size: var(--text-xs);
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }

    .chat__ctx {
      grid-area: ctx;
      min-inline-size: 0;
      overflow: hidden;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chat__ctx > * + *::before {
      content: '·';
      margin-inline: var(--space-xs);
    }
    .chat__ctx .is-ink {
      color: var(--text-color);
    }
  }
</style>
