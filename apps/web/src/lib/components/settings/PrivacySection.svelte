<script lang="ts">
  /**
   * Visibility and privacy. Only what is kept: whether new conversations are
   * born private (ADR-099). The other defaults that used to sit here (tasks,
   * money, notes, outreach) moved locally and saved nothing; they come back
   * when each has a writer, one at a time.
   */
  import RecordHead from '$lib/components/RecordHead.svelte';
  import { t, appLocale } from '$lib/i18n';
  import ConversationPrivacyDefault from './ConversationPrivacyDefault.svelte';

  let { workspaceId }: { workspaceId?: string } = $props();

  const locale = appLocale();
</script>

<RecordHead crumbs={[{ label: t('settings.title', locale) }, { label: t('settings.priv_kicker', locale) }]} title={t('settings.nav_privacy', locale)}>
  {#snippet facts()}<span>{t('settings.priv_sub', locale)}</span>{/snippet}
</RecordHead>

<ConversationPrivacyDefault {workspaceId} />
