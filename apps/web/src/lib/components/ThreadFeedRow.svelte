<script lang="ts">
  /**
   * One thread as «De qué se habla» draws it (ADR-116): its name in mono, the
   * title, «N new», the time; where, and the last message under it. The «Del
   * equipo» block of the dashboard is a preview of that list, so it renders
   * this same row (`dense`, without «where»): the two projections of ADR-106
   * read as one thing (diseño M5).
   */
  import Badge from '$lib/components/Badge.svelte';
  import { t, type Locale } from '$lib/i18n';
  import { feedThreadName, feedTitle, messageWhen, type FeedThread } from '$lib/threads';

  interface Props {
    th: FeedThread;
    href: string | null;
    author: string;
    /** Project and deal; the block leaves it out. */
    where?: string;
    /** The dashboard's row rhythm: no inline padding, the board's block padding. */
    dense?: boolean;
    locale: Locale;
    tz: string;
  }

  let { th, href, author, where, dense = false, locale, tz }: Props = $props();
</script>

<svelte:element this={href ? 'a' : 'div'} {href} class="feed__link" class:feed__link--dense={dense} class:is-new={th.unread_count > 0}>
  <span class="feed__head">
    <span class="feed__name">{feedThreadName(th, locale)}</span>
    <span class="feed__title">{feedTitle(th)}</span>
    {#if th.unread_count > 0}
      <Badge tone="info" size="xs">{t(th.unread_count === 1 ? 'threads.unread_one' : 'threads.unread', locale, { n: th.unread_count })}</Badge>
    {/if}
  </span>
  <time class="feed__when" datetime={th.last_message_at}>{messageWhen(th.last_message_at, locale, tz)}</time>
  {#if where}<span class="feed__where">{where}</span>{/if}
  <span class="feed__last"><span class="feed__author">{author}:</span> {th.last_message.body}</span>
</svelte:element>

<style>
  @layer components {
    /* Cabecera y hora en la primera línea; dónde y el último mensaje debajo. */
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
