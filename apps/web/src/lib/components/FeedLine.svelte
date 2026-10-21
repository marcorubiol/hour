<script lang="ts">
  /**
   * One row of the Conversations lists (ADR-116, ADR-138 fase 3): its name in
   * mono, the title, «N new», the time; where, and the last word under it.
   * A thread (ThreadFeedRow) and a conversation of the common list draw the
   * same row, so the two entities read as one list (plan § 2: «filas iguales»).
   */
  import Badge from '$lib/components/Badge.svelte';

  interface Props {
    href: string | null;
    /** The mono word before the title: the facet, «Equipo», or the tags. */
    name: string;
    title: string;
    /** «2 nuevos»; null when there is nothing new. */
    unread: string | null;
    /** ISO instant of the last movement, and how it reads. */
    at: string | null;
    when: string;
    /** Project and deal or contact; the block leaves it out. */
    where?: string;
    /** The lead of the last line: who wrote, or whose turn it is. */
    lead?: string | null;
    /** The last line itself: the message, or the subject. */
    last?: string | null;
    /** The dashboard's row rhythm: no inline padding, the board's block padding. */
    dense?: boolean;
  }

  let { href, name, title, unread, at, when, where, lead = null, last = null, dense = false }: Props = $props();
</script>

<svelte:element this={href ? 'a' : 'div'} {href} class="feed__link" class:feed__link--dense={dense} class:is-new={unread !== null}>
  <span class="feed__head">
    <span class="feed__name">{name}</span>
    <span class="feed__title">{title}</span>
    {#if unread}<Badge tone="info" size="xs">{unread}</Badge>{/if}
  </span>
  {#if at}<time class="feed__when" datetime={at}>{when}</time>{/if}
  {#if where}<span class="feed__where">{where}</span>{/if}
  {#if lead || last}
    <span class="feed__last"
      >{#if lead}<span class="feed__author">{lead}{last ? ':' : ''}</span>{/if}{#if lead && last}{' '}{/if}{last ?? ''}</span
    >
  {/if}
</svelte:element>

<style>
  @layer components {
    /* Cabecera y hora en la primera línea; dónde y lo último debajo. */
    .feed__link {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-2xs) var(--space-m);
      padding: var(--space-s) var(--space-2xs);
      color: inherit;
      text-decoration: none;
      transition: background-color var(--transition);
    }
    .feed__link--dense {
      padding: var(--space-xs) 0;
    }
    a.feed__link:hover {
      background: var(--bg-ultra-light);
    }

    .feed__head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs);
      min-inline-size: 0;
    }

    .feed__name {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
      color: var(--text-faint);
    }

    .feed__title {
      font-size: var(--text-m);
      color: var(--text-muted);
    }
    /* Con nuevos, el título en tinta: el único peso que cambia. */
    .is-new .feed__title {
      color: var(--text-color);
    }

    .feed__when {
      font-size: var(--text-xs);
      color: var(--text-faint);
      white-space: nowrap;
    }

    .feed__where {
      grid-column: 1 / -1;
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .feed__last {
      grid-column: 1 / -1;
      font-size: var(--text-s);
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .feed__author {
      color: var(--text-color);
    }
  }
</style>
