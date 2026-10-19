<script lang="ts">
  import Segmented from '$lib/components/Segmented.svelte';
  import Switch from '$lib/components/Switch.svelte';
  import Field from '$lib/components/Field.svelte';
  import RecordHead from '$lib/components/RecordHead.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import { onMount } from 'svelte';
  import { session } from '$lib/session.svelte';
  import { t, appLocale } from '$lib/i18n';
  import {
    isMasterViewEnabled,
    getMasterViewPath,
    setMasterViewEnabled,
    clearMasterViewPath,
  } from '$lib/master-view';

  const locale = appLocale();

  let userEmail = $derived(session.user?.email ?? '');

  // ─── notifications state ──────────────────────────────────────────────
  let notifDigest = $state<'off' | 'weekday' | 'daily'>('weekday');
  let notifWeeklyReview = $state(true);
  let notifWarmReply = $state(true);
  let notifMoneyIn = $state(true);
  let notifMoneyOverdue = $state(true);
  let notifDayOfShow = $state(true);
  let notifEmail = $state(true);
  let notifPush = $state(true);
  let quietStart = $state('22:00');
  let quietEnd = $state('08:00');

  // ─── Master View (D-PRE-05) — real wire ───────────────────────────────
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

<RecordHead crumbs={[{ label: t('settings.title', locale) }, { label: t('settings.notif_kicker', locale) }]} title={t('settings.nav_notifications', locale)}>
  {#snippet facts()}<span>{t('settings.notif_sub', locale)}</span>{/snippet}
</RecordHead>

<section class="set-group">
  <BlockHead title={t('settings.notif_digest', locale)} />
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.notif_daily_digest', locale)}</div>
        <div class="set-row__hint">{t('settings.notif_daily_digest_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <Segmented
          ariaLabel={t('settings.notif_daily_digest', locale)}
          options={[{ value: 'off', label: t('settings.notif_off', locale) }, { value: 'weekday', label: t('settings.notif_weekdays', locale) }, { value: 'daily', label: t('settings.notif_every_day', locale) }]}
          bind:value={notifDigest}
        />
      </div>
    </div>

    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.notif_weekly_review', locale)}</div>
        <div class="set-row__hint">{t('settings.notif_weekly_review_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <Switch
          checked={notifWeeklyReview}
          label={t('settings.notif_weekly_review', locale)}
          onchange={() => (notifWeeklyReview = !notifWeeklyReview)}
        />
      </div>
    </div>
  </div>
</section>

<section class="set-group">
  <BlockHead title={t('settings.notif_priority', locale)} />
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.notif_warm_reply', locale)}</div>
        <div class="set-row__hint">{t('settings.notif_warm_reply_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <Switch
          checked={notifWarmReply}
          label={t('settings.notif_warm_reply', locale)}
          onchange={() => (notifWarmReply = !notifWarmReply)}
        />
      </div>
    </div>
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.notif_money_in', locale)}</div>
        <div class="set-row__hint">{t('settings.notif_money_in_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <Switch
          checked={notifMoneyIn}
          label={t('settings.notif_money_in', locale)}
          onchange={() => (notifMoneyIn = !notifMoneyIn)}
        />
      </div>
    </div>
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.notif_money_overdue', locale)}</div>
        <div class="set-row__hint">{t('settings.notif_money_overdue_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <Switch
          checked={notifMoneyOverdue}
          label={t('settings.notif_money_overdue', locale)}
          onchange={() => (notifMoneyOverdue = !notifMoneyOverdue)}
        />
      </div>
    </div>
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.notif_day_of_show', locale)}</div>
        <div class="set-row__hint">{t('settings.notif_day_of_show_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <Switch
          checked={notifDayOfShow}
          label={t('settings.notif_day_of_show', locale)}
          onchange={() => (notifDayOfShow = !notifDayOfShow)}
        />
      </div>
    </div>
  </div>
</section>

<section class="set-group">
  <BlockHead title={t('settings.notif_channels', locale)} />
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.email', locale)}</div>
        <div class="set-row__hint">{userEmail || '—'}</div>
      </div>
      <div class="set-row__ctrl">
        <Switch
          checked={notifEmail}
          label={t('settings.notif_email_aria', locale)}
          onchange={() => (notifEmail = !notifEmail)}
        />
      </div>
    </div>
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.notif_push', locale)}</div>
        <div class="set-row__hint">{t('settings.notif_push_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <Switch
          checked={notifPush}
          label={t('settings.notif_push_aria', locale)}
          onchange={() => (notifPush = !notifPush)}
        />
      </div>
    </div>
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.notif_quiet_hours', locale)}</div>
        <div class="set-row__hint">{t('settings.notif_quiet_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <div class="set-hours">
          <Field id="quiet-start">
            <input id="quiet-start" type="text" aria-label={t('settings.notif_quiet_hours', locale)} bind:value={quietStart} />
          </Field>
          <span class="sep">→</span>
          <Field id="quiet-end">
            <input id="quiet-end" type="text" aria-label={t('settings.notif_quiet_hours', locale)} bind:value={quietEnd} />
          </Field>
        </div>
      </div>
    </div>
  </div>
</section>

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
          <button
            type="button"
            class="btn--secondary btn--s"
            onclick={clearMasterView}
          >{t('settings.notif_clear_view', locale)}</button>
        </div>
      </div>
    {/if}
  </div>
</section>

<style>
  .set-hours {
    display: inline-flex;
    align-items: center;
    gap: var(--space-s);
  }
  .set-hours > :global(.field) {
    --field-value-min: 4rem;
    inline-size: 5rem;
  }
  .set-hours .sep {
    color: var(--text-faint);
    font-family: var(--font-mono);
  }
  .set-codeline {
    font-family: var(--font-mono);
    font-size: 0.95em;
    background: var(--bg-light);
    padding-block: 1px;
    padding-inline: var(--space-xs);
    border-radius: var(--radius-s);
  }
</style>
