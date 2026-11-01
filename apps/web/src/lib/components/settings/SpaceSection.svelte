<script lang="ts">
  /**
   * What the space decides for everyone in it (ADR-156, folding ADR-128 § 2's
   * trade and ADR-099's privacy default): how Hour names things, and whether
   * new conversations are born private. The old `?section=privacy` and
   * `?section=languages` land here (`sectionFrom`). An admin changes them;
   * the rest see them.
   */
  import RecordHead from '$lib/components/RecordHead.svelte';
  import { t, appLocale } from '$lib/i18n';
  import WorkspaceTrade from './WorkspaceTrade.svelte';
  import ConversationPrivacyDefault from './ConversationPrivacyDefault.svelte';

  let { workspaceId }: { workspaceId?: string } = $props();

  const locale = appLocale();
</script>

<RecordHead crumbs={[{ label: t('settings.title', locale) }, { label: t('settings.space_kicker', locale) }]} title={t('settings.nav_space', locale)}>
  {#snippet facts()}<span>{t('settings.space_sub', locale)}</span>{/snippet}
</RecordHead>

<WorkspaceTrade {workspaceId} />
<ConversationPrivacyDefault {workspaceId} />
