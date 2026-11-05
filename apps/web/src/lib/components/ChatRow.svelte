<script lang="ts">
  /**
   * Una fila de la lista de Conversaciones con forma de chat (ADR-176): el
   * monograma de con quién (la organización, ADR-102: cuadrado; una persona
   * sola, redondo, ADR-177 § 3) o, en un hilo de bolo, el `IdentityMark` de su
   * espectáculo, porque el grupo es nuestro; su nombre con qué es y dónde
   * («sala · Girona», «por libre · Lleida», ADR-177 § 2) y cuándo; lo último
   * que se dijo y cuántos sin leer. Dos líneas, como un chat; una tercera,
   * pequeña y en la letra del cuerpo, sólo con el contexto que la lista no
   * dice ya (el turno donde no lo dice una sección o un chip, la etiqueta si
   * la lista las mezcla, el proyecto, el bolo). Su acción (`act`: «Ya está»)
   * ocupa el hueco de la hora. La misma fila para una conversación y para un
   * hilo del equipo.
   *
   * El nombre es el enlace de la fila y la cubre entera. `active` marca la
   * que está abierta al lado (escritorio, dos paneles). En modo selección la
   * casilla ocupa la fila.
   */
  import type { Snippet } from 'svelte';
  import ChatMonogram from '$lib/components/ChatMonogram.svelte';
  import IdentityMark from '$lib/components/IdentityMark.svelte';

  interface Props {
    href: string | null;
    title: string;
    /** Persona (redondo) u organización (cuadrado); ADR-177 § 3. */
    shape?: 'person' | 'organization';
    /** Qué es y dónde, tras el nombre («sala», «Girona»). */
    words?: string[];
    /** Un hilo de un bolo: es nuestro, lleva el `IdentityMark` de su espectáculo. */
    mark?: { accent: string; initials?: string | null; name: string } | null;
    /** Sin `mark`, un hilo de bolo aún lleva el monograma de trazo discontinuo. */
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
    /** Una acción de la fila, al final de la línea de contexto, por encima del enlace. */
    act?: Snippet;
    /**
     * Dentro de la fila de otra lista («Te espera» de Hoy, las fichas): sin
     * su relleno ni su fondo al pasar, que pone quien la aloja.
     */
    flush?: boolean;
  }

  let {
    href,
    title,
    shape = 'organization',
    words = [],
    mark = null,
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
    act,
    flush = false,
  }: Props = $props();

</script>

<div
  class="chat"
  class:is-new={unread > 0}
  class:is-active={active}
  class:is-picked={picked}
  class:chat--picking={picking && !!pick}
  class:chat--flush={flush}
  class:chat--act={!!act}
  data-group={group || undefined}
>
  {#if picking && pick}<span class="chat__pick">{@render pick()}</span>{/if}
  <span class="chat__mono"
    >{#if mark}<IdentityMark accent={mark.accent} initials={mark.initials} name={mark.name} size="var(--chat-mono)" />{:else}<ChatMonogram
        name={title}
        {shape}
        {group}
      />{/if}</span
  >
  <span class="chat__name">
    {#if href}
      <a class="chat__title" {href} aria-current={active ? 'true' : undefined} data-peek={onopen ? 'off' : undefined} onclick={onopen}
        >{title}</a
      >
    {:else}
      <span class="chat__title">{title}</span>
    {/if}
    {#if words.length > 0}<span class="chat__words">{words.join(' · ')}</span>{/if}
  </span>
  {#if at}<time class="chat__when" datetime={at}>{when}</time>{/if}
  {#if act}<span class="chat__act">{@render act()}</span>{/if}
  {#if lead || last}
    <span class="chat__last"
      >{#if lead}<span class="chat__lead">{lead}{last ? ':' : ''}</span>{#if last}{' '}{/if}{/if}{last ?? ''}</span
    >
  {/if}
  {#if unread > 0}<span class="chat__unread" title={unreadLabel ?? undefined}
      ><span aria-hidden="true">{unread}</span>{#if unreadLabel}<span class="visually-hidden">{unreadLabel}</span>{/if}</span
    >{/if}
  {#if context.length > 0}
    <span class="chat__ctx">
      {#each context as c, i (i)}<span class:is-ink={c.ink}>{c.text}</span>{/each}
    </span>
  {/if}
</div>

<style>
  @layer components {
    /* Two lines, as a messaging app draws a chat (ADR-176; diseño 2026-11-05):
       who and when; what was said last and how many are new. The right
       column is two slots on one vertical: the time over the figure. «Ya
       está» takes the time's slot, on hover or focus where there is a
       pointer, always on a touch screen. A third, quiet line only when the
       row has context the list does not already say. */
    .chat {
      position: relative;
      display: grid;
      grid-template-columns: [mono] auto [body] minmax(0, 1fr) [side] auto;
      grid-template-areas:
        'mono name when'
        'mono last count';
      column-gap: var(--space-s);
      row-gap: 0;
      align-items: baseline;
      padding: var(--space-xs) var(--space-s);
      border-radius: var(--radius-m);
      line-height: var(--chat-line-height);
      transition: background-color var(--transition);
    }
    .chat:hover,
    .chat.is-picked {
      background: var(--bg-ultra-light);
    }
    .chat.is-active {
      background: var(--bg-light);
    }
    /* Inside another list's row: that row draws the padding and the lines. */
    .chat--flush {
      padding: 0;
      border-radius: 0;
    }
    .chat--flush:hover {
      background: none;
    }

    .chat--picking {
      grid-template-columns: [pick] auto [mono] auto [body] minmax(0, 1fr) [side] auto;
      grid-template-areas:
        'pick mono name when'
        'pick mono last count';
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
      align-self: center;
      display: flex;
    }

    .chat__name {
      grid-area: name;
      display: flex;
      align-items: baseline;
      gap: var(--space-xs);
      min-inline-size: 0;
    }
    .chat__title {
      flex-shrink: 1;
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
      border-radius: inherit;
    }
    /* Qué es y dónde (ADR-177 § 2): cede antes que el nombre. */
    .chat__words {
      flex-shrink: 3;
      min-inline-size: 0;
      overflow: hidden;
      font-size: var(--text-s);
      color: var(--text-faint);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .chat__when,
    .chat__act {
      grid-area: when;
      justify-self: end;
    }
    .chat__when {
      font-size: var(--text-xs);
      color: var(--text-faint);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .is-new .chat__when {
      color: var(--text-color);
    }
    .chat__act {
      position: relative;
      z-index: var(--z-raised);
      align-self: center;
    }
    /* With a pointer the act waits for the row: the time keeps its slot
       until the row is hovered or holds the focus. */
    @media (hover: hover) and (pointer: fine) {
      .chat__act {
        opacity: 0;
        pointer-events: none;
        transition: opacity var(--transition);
      }
      .chat:hover .chat__act,
      .chat:focus-within .chat__act {
        opacity: 1;
        pointer-events: auto;
      }
      .chat--act:hover .chat__when,
      .chat--act:focus-within .chat__when {
        opacity: 0;
      }
    }
    @media not ((hover: hover) and (pointer: fine)) {
      .chat--act .chat__when {
        display: none;
      }
    }

    .chat__last {
      grid-area: last;
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
      grid-area: count;
      justify-self: end;
      align-self: center;
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

    /* Context the list does not say already: the body's voice, small and
       quiet (mono capitals are for a block's head, never inside a row). */
    .chat__ctx {
      grid-column: body / -1;
      grid-row: 3;
      min-inline-size: 0;
      overflow: hidden;
      font-size: var(--text-xs);
      color: var(--text-faint);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chat--picking .chat__ctx {
      grid-column: body / -1;
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
