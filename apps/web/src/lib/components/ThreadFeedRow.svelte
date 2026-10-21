<script lang="ts">
  /**
   * One thread as «De qué se habla» draws it (ADR-116): its name in mono, the
   * title, «N new», the time; where, and the last message under it. The row
   * itself is FeedLine, the one a conversation of the common list draws too
   * (ADR-138 fase 3).
   */
  import FeedLine from '$lib/components/FeedLine.svelte';
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

<FeedLine
  {href}
  name={feedThreadName(th, locale)}
  title={feedTitle(th)}
  unread={th.unread_count > 0 ? t(th.unread_count === 1 ? 'threads.unread_one' : 'threads.unread', locale, { n: th.unread_count }) : null}
  at={th.last_message_at}
  when={messageWhen(th.last_message_at, locale, tz)}
  {where}
  lead={author}
  last={th.last_message.body}
  {dense}
/>
