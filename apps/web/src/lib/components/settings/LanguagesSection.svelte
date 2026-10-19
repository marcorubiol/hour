<script lang="ts">
  /**
   * The space's trade (ADR-128 § 2). The interface-language picker that used
   * to open this section kept nothing (the session language is the
   * browser's, `appLocale()`; `user_profile.locale` has no reader on the
   * client), so it is hidden until it saves. The section id stays
   * `languages` so old links still land here.
   */
  import RecordHead from '$lib/components/RecordHead.svelte';
  import { t, appLocale } from '$lib/i18n';
  import WorkspaceTrade from './WorkspaceTrade.svelte';

  let { workspaceId }: { workspaceId?: string } = $props();

  const locale = appLocale();
</script>

<RecordHead crumbs={[{ label: t('settings.title', locale) }, { label: t('settings.lang_kicker', locale) }]} title={t('settings.nav_languages', locale)}>
  {#snippet facts()}<span>{t('settings.lang_sub', locale)}</span>{/snippet}
</RecordHead>

<WorkspaceTrade {workspaceId} />
