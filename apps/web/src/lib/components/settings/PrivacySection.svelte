<script lang="ts">
  import Segmented from '$lib/components/Segmented.svelte';
  import Switch from '$lib/components/Switch.svelte';
  import RecordHead from '$lib/components/RecordHead.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import { t, appLocale } from '$lib/i18n';
  import ConversationPrivacyDefault from './ConversationPrivacyDefault.svelte';

  let { workspaceId }: { workspaceId?: string } = $props();

  const locale = appLocale();

  // ─── privacy state ────────────────────────────────────────────────────
  let privTasksDefault = $state<'shared' | 'private'>('shared');
  let privMoneyVis = $state<'me-only' | 'project' | 'all'>('me-only');
  let privNotesPrivate = $state(true);
  let privDistribution = $state<'me-only' | 'distributors' | 'all'>('me-only');
</script>

<RecordHead crumbs={[{ label: t('settings.title', locale) }, { label: t('settings.priv_kicker', locale) }]} title={t('settings.nav_privacy', locale)}>
  {#snippet facts()}<span>{t('settings.priv_sub', locale)}</span>{/snippet}
</RecordHead>

<ConversationPrivacyDefault {workspaceId} />

<section class="set-group">
  <BlockHead title={t('settings.priv_defaults', locale)} />
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.priv_tasks', locale)}</div>
        <div class="set-row__hint">{t('settings.priv_tasks_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <Segmented
          ariaLabel={t('settings.priv_tasks', locale)}
          options={[{ value: 'shared', label: t('settings.priv_shared', locale) }, { value: 'private', label: t('settings.priv_private', locale) }]}
          bind:value={privTasksDefault}
        />
      </div>
    </div>

    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.priv_money', locale)}</div>
        <div class="set-row__hint">{t('settings.priv_money_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <Segmented
          ariaLabel={t('settings.priv_money', locale)}
          options={[{ value: 'me-only', label: t('settings.priv_only_me', locale) }, { value: 'project', label: t('settings.priv_per_project', locale) }, { value: 'all', label: t('settings.priv_all_collab', locale) }]}
          bind:value={privMoneyVis}
        />
      </div>
    </div>

    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.priv_notes', locale)}</div>
        <div class="set-row__hint">{t('settings.priv_notes_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <Switch
          checked={privNotesPrivate}
          label={t('settings.priv_notes', locale)}
          onchange={() => (privNotesPrivate = !privNotesPrivate)}
        />
      </div>
    </div>

    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.priv_outreach', locale)}</div>
        <div class="set-row__hint">{t('settings.priv_outreach_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <Segmented
          ariaLabel={t('settings.priv_outreach', locale)}
          options={[{ value: 'me-only', label: t('settings.priv_only_me', locale) }, { value: 'distributors', label: t('settings.priv_distributors_only', locale) }, { value: 'all', label: t('settings.priv_everyone', locale) }]}
          bind:value={privDistribution}
        />
      </div>
    </div>
  </div>
</section>
