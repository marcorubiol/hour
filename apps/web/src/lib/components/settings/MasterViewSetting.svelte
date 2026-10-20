<script lang="ts">
  /**
   * Master View (D-PRE-05): Hour reopens the last view you left, kept in
   * this browser. The one real control of the old Notifications section;
   * the rest (digest, alerts, channels, quiet hours) kept nothing and is
   * hidden until Hour sends a notification that is real.
   */
  import Switch from '$lib/components/Switch.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import { onMount } from 'svelte';
  import { t, appLocale } from '$lib/i18n';
  import {
    isMasterViewEnabled,
    getMasterViewPath,
    setMasterViewEnabled,
    clearMasterViewPath,
  } from '$lib/master-view';

  const locale = appLocale();

  let masterViewEnabled = $state(false);
  let masterViewPath = $state<string | null>(null);

  function refreshMasterView() {
    masterViewEnabled = isMasterViewEnabled();
    masterViewPath = getMasterViewPath();
  }

  onMount(refreshMasterView);

  function toggleMasterView(next: boolean) {
    masterViewEnabled = next;
    setMasterViewEnabled(next);
    refreshMasterView();
  }

  function clearMasterView() {
    clearMasterViewPath();
    refreshMasterView();
  }
</script>

<section class="set-group">
  <BlockHead title={t('settings.notif_browser_memory', locale)} />
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Master View</div>
        <div class="set-row__hint">{t('settings.notif_master_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <Switch
          checked={masterViewEnabled}
          label={t('settings.notif_master_aria', locale)}
          onchange={() => toggleMasterView(!masterViewEnabled)}
        />
      </div>
    </div>
    {#if masterViewEnabled && masterViewPath}
      <div class="set-row">
        <div class="set-row__lead">
          <div class="set-row__label">{t('settings.notif_saved_view', locale)}</div>
          <div class="set-row__hint">
            {t('settings.notif_will_open_before', locale)}
            <code class="set-codeline">{masterViewPath}</code>
            {t('settings.notif_will_open_after', locale)}
          </div>
        </div>
        <div class="set-row__ctrl">
          <button type="button" class="btn--secondary btn--s" onclick={clearMasterView}
            >{t('settings.notif_clear_view', locale)}</button
          >
        </div>
      </div>
    {/if}
  </div>
</section>

<style>
  .set-codeline {
    font-family: var(--font-mono);
    font-size: 0.95em;
    background: var(--bg-light);
    padding-block: var(--line-hairline);
    padding-inline: var(--space-xs);
    border-radius: var(--radius-s);
  }
</style>
