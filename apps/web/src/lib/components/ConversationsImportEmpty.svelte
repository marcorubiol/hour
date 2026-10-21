<script lang="ts">
  /**
   * ConversationsImportEmpty: what Conversations says the first time, when
   * the scope has no conversation at all («Trae tu agenda»). One home for the
   * table (a view by tag) and the feed (Todas): an empty that only a filter
   * or a search makes says «nothing matches» instead, each in its own place.
   * It speaks in the voice of every other empty (EmptyLine, ADR-139 § 2).
   */
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import { t, type Locale } from '$lib/i18n';

  let { locale }: { locale: Locale } = $props();
</script>

<EmptyLine text={`${t('conversations.empty_title', locale)} ${t('conversations.empty_body', locale)}`} />
