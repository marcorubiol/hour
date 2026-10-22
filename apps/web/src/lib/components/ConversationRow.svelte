<script lang="ts">
  /**
   * One row of the Conversations lens (plan `build/plans/2026-10-22-
   * conversations-list.md` § 3; ADR-139 § 4 «una fila de lista compartida»):
   * the same two lines under every chip, for a conversation of the list, a
   * conversation of «Todas» and a thread of the team (ThreadFeedRow).
   *
   *   TURNO     Con quién  •2 ✓ tags         Relación   Bolos        cuándo
   *   desde     contacto, papel · ciudad     lo último                paso
   *
   * The first line decides (turn, who, relation, when), the second remembers
   * (contact, the last word, the step). The row owns the layout; the caller
   * passes what goes in each place, and what it leaves out is not drawn (a
   * contacted venue with nothing else is two short lines, not seven cells).
   *
   * The title is the row's link (the peek opens it, ADR-139 § 1) and covers the
   * whole row; the controls of the row (relation menu, bolo, history, next
   * step, the pick) sit above it. Columns are fixed per list, so they line up
   * by construction: the list sets `--crow-relation` and `--crow-bolos`.
   *
   * Widths, by the list's container: from 64 rem every column; from 48 rem the
   * bolos join the relation; under 48 rem a card of lines.
   */
  import type { Snippet } from 'svelte';
  import Badge from '$lib/components/Badge.svelte';

  interface Props {
    href: string | null;
    title: string;
    /** The mono word of the left column: TE TOCA, SEGUIMIENTO, LES TOCA, EQUIPO, a facet. */
    turn?: string | null;
    /** Under it: since when, or the follow-up's day. */
    since?: string | null;
    /** `ours` in ink, `late` in the house's warning tone, `theirs` and the rest in a low voice. */
    tone?: 'ours' | 'late' | 'theirs' | null;
    /** «2 nuevos»; null when there is nothing new. */
    unread?: string | null;
    /** After the title: the acquaintance mark, the tags. */
    titleAside?: Snippet;
    /** Under the title: the contact and its role, the city, the project, the line. */
    meta?: Snippet;
    /** The same, as plain text (a thread: project and deal). */
    where?: string;
    /** The relation's pill (and its menu). */
    relation?: Snippet;
    /** The nearest live bolo and its first day. */
    bolos?: Snippet;
    /** The lead of the last line: who wrote. */
    lead?: string | null;
    /** The last line: the subject, the message, the last mailout. */
    last?: string | null;
    /** ISO instant of the last movement, and how it reads. */
    at?: string | null;
    when?: string;
    /** In place of the time: a button that opens the history. */
    whenCell?: Snippet;
    /** The next step, with its button. */
    next?: Snippet;
    /** Selection mode: the row is a checkbox (its label then covers the row). */
    picking?: boolean;
    /** The checkbox, drawn only while picking. */
    pick?: Snippet;
    picked?: boolean;
  }

  let {
    href,
    title,
    turn = null,
    since = null,
    tone = null,
    unread = null,
    titleAside,
    meta,
    where,
    relation,
    bolos,
    lead = null,
    last = null,
    at = null,
    when = '',
    whenCell,
    next,
    picking = false,
    pick,
    picked = false,
  }: Props = $props();
</script>

<div class="crow" class:is-new={unread !== null} class:is-picked={picked} class:crow--picking={picking && !!pick} data-tone={tone ?? undefined}>
  {#if picking && pick}<span class="crow__pick">{@render pick()}</span>{/if}
  {#if turn || since}
    <span class="crow__lead">
      <span class="crow__turn">{turn ?? ''}</span>
      {#if since}<span class="crow__since">{since}</span>{/if}
    </span>
  {/if}
  <span class="crow__head">
    {#if href}<a class="crow__title" {href}>{title}</a>{:else}<span class="crow__title">{title}</span>{/if}
    {#if unread}<Badge tone="info" size="xs">{unread}</Badge>{/if}
    {@render titleAside?.()}
  </span>
  {#if meta}
    <span class="crow__meta">{@render meta()}</span>
  {:else if where}
    <span class="crow__meta">{where}</span>
  {/if}
  {#if relation || bolos}
    <span class="crow__state">
      {#if relation}<span class="crow__rel">{@render relation()}</span>{/if}
      {#if bolos}<span class="crow__bolos">{@render bolos()}</span>{/if}
    </span>
  {/if}
  {#if lead || last}
    <span class="crow__last"
      >{#if lead}<span class="crow__author">{lead}{last ? ':' : ''}</span>{/if}{#if lead && last}{' '}{/if}{last ?? ''}</span
    >
  {/if}
  {#if whenCell}
    <span class="crow__when">{@render whenCell()}</span>
  {:else if at}
    <time class="crow__when" datetime={at}>{when}</time>
  {/if}
  {#if next}<span class="crow__next">{@render next()}</span>{/if}
</div>

<style>
  @layer components {
    /* Desktop (the list's container from 64 rem): every column in its place.
       A column a row does not use is simply empty: the tracks are the list's. */
    .crow {
      position: relative;
      display: grid;
      grid-template-columns:
        [pick] auto [turn] var(--crow-turn, auto) [who] minmax(0, 1fr) [rel] var(--crow-relation, auto)
        [bolos] var(--crow-bolos, auto) [end] var(--crow-end, auto);
      grid-template-areas:
        'pick turn  head rel  bolos when'
        'pick since meta last last  next';
      column-gap: var(--space-m);
      row-gap: var(--space-2xs);
      align-items: baseline;
      padding: var(--space-s) var(--space-2xs);
      transition: background-color var(--transition);
    }
    .crow:hover,
    .crow.is-picked {
      background: var(--bg-ultra-light);
    }

    .crow__pick {
      grid-area: pick;
      grid-row: 1 / -1;
      align-self: center;
    }
    /* Picking: the checkbox's label is the whole row (móvil #2, now at every width). */
    .crow--picking .crow__pick :global(.check__row)::after {
      content: '';
      position: absolute;
      inset: 0;
      z-index: var(--z-raised);
      cursor: pointer;
    }

    .crow__lead {
      display: contents;
    }
    .crow__turn {
      grid-area: turn;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-faint);
      text-wrap: balance;
    }
    .crow__since {
      grid-area: since;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-faint);
      white-space: nowrap;
    }
    [data-tone='ours'] .crow__turn,
    [data-tone='late'] .crow__turn {
      color: var(--text-color);
      font-weight: 500;
    }
    /* Late (ADR-126 § 1): the house's warning tone, on the date only. */
    [data-tone='late'] .crow__since {
      color: var(--warning-dark);
    }

    .crow__head {
      grid-area: head;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs);
      min-inline-size: 0;
    }
    .crow__title {
      font-size: var(--text-m);
      color: var(--text-muted);
      text-decoration: none;
      overflow-wrap: anywhere;
    }
    /* The title is the row's link: its area is the whole row. */
    a.crow__title::after {
      content: '';
      position: absolute;
      inset: 0;
    }
    a.crow__title:hover {
      text-decoration: underline;
      text-underline-offset: 0.2em;
    }
    a.crow__title:focus-visible {
      outline: none;
    }
    a.crow__title:focus-visible::after {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: calc(-1 * var(--focus-width));
    }
    /* With new ones, the title in ink: the only weight that changes. */
    .is-new .crow__title {
      color: var(--text-color);
    }

    /* Everything a row can act on sits above its link. */
    .crow__head > :global(:not(.crow__title)),
    .crow__meta :global(a),
    .crow__state,
    .crow__when,
    .crow__next {
      position: relative;
      z-index: var(--z-raised);
    }
    .crow--picking .crow__state,
    .crow--picking .crow__when,
    .crow--picking .crow__next {
      z-index: calc(var(--z-raised) + 1);
    }

    .crow__meta {
      grid-area: meta;
      min-inline-size: 0;
      font-size: var(--text-xs);
      color: var(--text-faint);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Relation and bolos: each in its column on desktop. */
    .crow__state {
      display: contents;
    }
    .crow__rel {
      grid-area: rel;
      min-inline-size: 0;
    }
    .crow__bolos {
      grid-area: bolos;
      min-inline-size: 0;
      font-size: var(--text-s);
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .crow__last {
      grid-area: last;
      min-inline-size: 0;
      font-size: var(--text-s);
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .crow__author {
      color: var(--text-color);
    }

    .crow__when {
      grid-area: when;
      justify-self: end;
      font-size: var(--text-xs);
      color: var(--text-faint);
      white-space: nowrap;
    }
    .crow__next {
      grid-area: next;
      justify-self: end;
      min-inline-size: 0;
      max-inline-size: 100%;
    }

    /* Tablet (48 to 64 rem): the bolos join the relation, after it. */
    @container (max-width: 63.999rem) {
      .crow {
        grid-template-columns: [pick] auto [turn] var(--crow-turn, auto) [who] minmax(0, 1fr) [rel] var(--crow-state, auto) [end] var(--crow-end, auto);
        grid-template-areas:
          'pick turn  head rel  when'
          'pick since meta last next';
      }
      .crow__state {
        grid-area: rel;
        display: flex;
        align-items: baseline;
        gap: var(--space-xs);
        min-inline-size: 0;
      }
      .crow__rel,
      .crow__bolos {
        grid-area: auto;
      }
    }

    /* A list without relations (the team's threads, «Todas» read from the
       feed): the last word under the meta, in the title's column, as the
       feed always read; the time and the step at the end. */
    @container (min-width: 48rem) {
      :global(.crow-list:not(.crow-list--relation)) .crow {
        grid-template-columns: [pick] auto [turn] var(--crow-turn, auto) [who] minmax(0, 1fr) [end] var(--crow-end, auto);
        grid-template-areas:
          'pick turn  head when'
          'pick since meta next'
          'pick .     last next';
      }
    }

    /* Phone (under 48 rem): a card of lines, in reading order. A line with
       nothing on it is not drawn. */
    @container (max-width: 47.999rem) {
      .crow {
        grid-template-columns: [pick] auto [main] minmax(0, 1fr);
        grid-template-areas: none;
        row-gap: var(--space-2xs);
        padding: var(--space-s);
      }
      .crow > :not(.crow__pick) {
        grid-area: auto;
        grid-column: main;
        justify-self: start;
      }
      .crow__pick {
        grid-area: auto;
        grid-column: pick;
        grid-row: 1 / span 6;
      }
      /* «TE TOCA · ayer» on one line. */
      .crow__lead {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--space-xs);
      }
      .crow__turn:empty {
        display: none;
      }
      .crow__turn:not(:empty) + .crow__since::before {
        content: '·';
        margin-inline-end: var(--space-xs);
      }
      .crow__when {
        display: none;
      }
      .crow__state {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--space-2xs) var(--space-xs);
      }
      .crow__rel,
      .crow__bolos {
        grid-area: auto;
      }
      .crow__last {
        white-space: normal;
      }
      .crow__meta {
        white-space: normal;
      }
    }
  }
</style>
