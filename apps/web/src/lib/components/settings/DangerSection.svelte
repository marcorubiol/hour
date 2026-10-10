<script lang="ts">
  import { t, appLocale } from '$lib/i18n';

  const locale = appLocale();
</script>

<header class="set-mast">
  <p class="eyebrow set-mast__kicker">{t('settings.danger_kicker', locale)}</p>
  <h1 class="set-mast__title"><em>{t('settings.nav_danger', locale)}</em></h1>
  <p class="set-mast__sub">{t('settings.danger_sub', locale)}</p>
</header>

<section class="set-group">
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.danger_export', locale)}</div>
        <div class="set-row__hint">{t('settings.danger_export_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <button type="button" class="btn--outline btn--s">{t('settings.danger_request_export', locale)}</button>
      </div>
    </div>
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.danger_leave_all', locale)}</div>
        <div class="set-row__hint">{t('settings.danger_leave_all_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <button type="button" class="btn--outline btn--s is-warn">{t('settings.danger_leave_all_btn', locale)}</button>
      </div>
    </div>
    <div class="set-row is-danger">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.danger_delete', locale)}</div>
        <div class="set-row__hint">{t('settings.danger_delete_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <button type="button" class="btn--danger btn--s">
          {t('settings.danger_delete_btn', locale)}
        </button>
      </div>
    </div>
  </div>
</section>
