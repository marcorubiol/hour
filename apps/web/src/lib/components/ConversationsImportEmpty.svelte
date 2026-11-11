<script lang="ts">
  /**
   * ConversationsImportEmpty: what Conversations says the first time, when
   * the scope has no conversation at all. It states, it does not instruct
   * (ADR-154: «Trae tu agenda.» asked for something Hour cannot do; tarea 130). One home for the
   * table (a view by tag) and the feed (Todas): an empty that only a filter
   * or a search makes says «nothing matches» instead, each in its own place.
   * It speaks in the voice of every other empty (EmptyLine, ADR-139 § 2).
   * No «import your spreadsheet» after it: there is no import (ADR-161 § 5,
   * ADR-154 § 16), and a screen does not promise what Hour does not do.
   */
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import { t, type Locale } from '$lib/i18n';

  let { locale }: { locale: Locale } = $props();
</script>

<EmptyLine text={t('conversations.empty_none', locale)} />
