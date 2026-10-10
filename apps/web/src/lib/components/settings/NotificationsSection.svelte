<script lang="ts">
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

<header class="set-mast">
  <p class="eyebrow set-mast__kicker">{t('settings.notif_kicker', locale)}</p>
  <h1 class="set-mast__title"><em>{t('settings.nav_notifications', locale)}</em></h1>
  <p class="set-mast__sub">{t('settings.notif_sub', locale)}</p>
</header>

<section class="set-group">
  <div class="set-group__head">
    <span class="eyebrow set-group__kicker">{t('settings.notif_digest', locale)}</span>
  </div>
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.notif_daily_digest', locale)}</div>
        <div class="set-row__hint">{t('settings.notif_daily_digest_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <div class="set-seg">
          <button
            type="button"
            class={notifDigest === 'off' ? 'is-on' : ''}
            onclick={() => (notifDigest = 'off')}
          >{t('settings.notif_off', locale)}</button>
          <button
            type="button"
            class={notifDigest === 'weekday' ? 'is-on' : ''}
            onclick={() => (notifDigest = 'weekday')}
          >{t('settings.notif_weekdays', locale)}</button>
          <button
            type="button"
            class={notifDigest === 'daily' ? 'is-on' : ''}
            onclick={() => (notifDigest = 'daily')}
          >{t('settings.notif_every_day', locale)}</button>
        </div>
      </div>
    </div>

    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.notif_weekly_review', locale)}</div>
        <div class="set-row__hint">{t('settings.notif_weekly_review_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <button
          type="button"
          class={['set-toggle', notifWeeklyReview && 'is-on'].filter(Boolean).join(' ')}
          aria-label={t('settings.notif_weekly_review', locale)}
          aria-pressed={notifWeeklyReview}
          onclick={() => (notifWeeklyReview = !notifWeeklyReview)}
        >
          <span class="set-toggle__dot"></span>
        </button>
      </div>
    </div>
  </div>
</section>

<section class="set-group">
  <div class="set-group__head">
    <span class="eyebrow set-group__kicker">{t('settings.notif_priority', locale)}</span>
  </div>
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.notif_warm_reply', locale)}</div>
        <div class="set-row__hint">{t('settings.notif_warm_reply_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <button
          type="button"
          class={['set-toggle', notifWarmReply && 'is-on'].filter(Boolean).join(' ')}
          aria-label={t('settings.notif_warm_reply', locale)}
          aria-pressed={notifWarmReply}
          onclick={() => (notifWarmReply = !notifWarmReply)}
        >
          <span class="set-toggle__dot"></span>
        </button>
      </div>
    </div>
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.notif_money_in', locale)}</div>
        <div class="set-row__hint">{t('settings.notif_money_in_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <button
          type="button"
          class={['set-toggle', notifMoneyIn && 'is-on'].filter(Boolean).join(' ')}
          aria-label={t('settings.notif_money_in', locale)}
          aria-pressed={notifMoneyIn}
          onclick={() => (notifMoneyIn = !notifMoneyIn)}
        >
          <span class="set-toggle__dot"></span>
        </button>
      </div>
    </div>
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.notif_money_overdue', locale)}</div>
        <div class="set-row__hint">{t('settings.notif_money_overdue_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <button
          type="button"
          class={['set-toggle', notifMoneyOverdue && 'is-on'].filter(Boolean).join(' ')}
          aria-label={t('settings.notif_money_overdue', locale)}
          aria-pressed={notifMoneyOverdue}
          onclick={() => (notifMoneyOverdue = !notifMoneyOverdue)}
        >
          <span class="set-toggle__dot"></span>
        </button>
      </div>
    </div>
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.notif_day_of_show', locale)}</div>
        <div class="set-row__hint">{t('settings.notif_day_of_show_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <button
          type="button"
          class={['set-toggle', notifDayOfShow && 'is-on'].filter(Boolean).join(' ')}
          aria-label={t('settings.notif_day_of_show', locale)}
          aria-pressed={notifDayOfShow}
          onclick={() => (notifDayOfShow = !notifDayOfShow)}
        >
          <span class="set-toggle__dot"></span>
        </button>
      </div>
    </div>
  </div>
</section>

<section class="set-group">
  <div class="set-group__head">
    <span class="eyebrow set-group__kicker">{t('settings.notif_channels', locale)}</span>
  </div>
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.email', locale)}</div>
        <div class="set-row__hint">{userEmail || '—'}</div>
      </div>
      <div class="set-row__ctrl">
        <button
          type="button"
          class={['set-toggle', notifEmail && 'is-on'].filter(Boolean).join(' ')}
          aria-label={t('settings.notif_email_aria', locale)}
          aria-pressed={notifEmail}
          onclick={() => (notifEmail = !notifEmail)}
        >
          <span class="set-toggle__dot"></span>
        </button>
      </div>
    </div>
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.notif_push', locale)}</div>
        <div class="set-row__hint">{t('settings.notif_push_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <button
          type="button"
          class={['set-toggle', notifPush && 'is-on'].filter(Boolean).join(' ')}
          aria-label={t('settings.notif_push_aria', locale)}
          aria-pressed={notifPush}
          onclick={() => (notifPush = !notifPush)}
        >
          <span class="set-toggle__dot"></span>
        </button>
      </div>
    </div>
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.notif_quiet_hours', locale)}</div>
        <div class="set-row__hint">{t('settings.notif_quiet_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <div class="set-hours">
          <input class="input--tight" type="text" bind:value={quietStart} />
          <span class="sep">→</span>
          <input class="input--tight" type="text" bind:value={quietEnd} />
        </div>
      </div>
    </div>
  </div>
</section>

<section class="set-group">
  <div class="set-group__head">
    <span class="eyebrow set-group__kicker">{t('settings.notif_browser_memory', locale)}</span>
  </div>
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">Master View</div>
        <div class="set-row__hint">{t('settings.notif_master_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <button
          type="button"
          class={['set-toggle', masterViewEnabled && 'is-on']
            .filter(Boolean)
            .join(' ')}
          aria-label={t('settings.notif_master_aria', locale)}
          aria-pressed={masterViewEnabled}
          onclick={() => toggleMasterView(!masterViewEnabled)}
        >
          <span class="set-toggle__dot"></span>
        </button>
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
            class="btn--outline btn--s"
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
