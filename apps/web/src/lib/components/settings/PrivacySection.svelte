<script lang="ts">
  import { t, appLocale } from '$lib/i18n';

  const locale = appLocale();

  // ─── privacy state ────────────────────────────────────────────────────
  let privTasksDefault = $state<'shared' | 'private'>('shared');
  let privMoneyVis = $state<'me-only' | 'project' | 'all'>('me-only');
  let privNotesPrivate = $state(true);
  let privDistribution = $state<'me-only' | 'distributors' | 'all'>('me-only');
</script>

<header class="set-mast">
  <p class="eyebrow set-mast__kicker">{t('settings.priv_kicker', locale)}</p>
  <h1 class="set-mast__title"><em>{t('settings.nav_privacy', locale)}</em></h1>
  <p class="set-mast__sub">{t('settings.priv_sub', locale)}</p>
</header>

<section class="set-group">
  <div class="set-group__head">
    <span class="eyebrow set-group__kicker">{t('settings.priv_defaults', locale)}</span>
  </div>
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.priv_tasks', locale)}</div>
        <div class="set-row__hint">{t('settings.priv_tasks_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <div class="set-seg">
          <button
            type="button"
            class={privTasksDefault === 'shared' ? 'is-on' : ''}
            onclick={() => (privTasksDefault = 'shared')}
          >{t('settings.priv_shared', locale)}</button>
          <button
            type="button"
            class={privTasksDefault === 'private' ? 'is-on' : ''}
            onclick={() => (privTasksDefault = 'private')}
          >{t('settings.priv_private', locale)}</button>
        </div>
      </div>
    </div>

    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.priv_money', locale)}</div>
        <div class="set-row__hint">{t('settings.priv_money_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <div class="set-seg">
          <button
            type="button"
            class={privMoneyVis === 'me-only' ? 'is-on' : ''}
            onclick={() => (privMoneyVis = 'me-only')}
          >{t('settings.priv_only_me', locale)}</button>
          <button
            type="button"
            class={privMoneyVis === 'project' ? 'is-on' : ''}
            onclick={() => (privMoneyVis = 'project')}
          >{t('settings.priv_per_project', locale)}</button>
          <button
            type="button"
            class={privMoneyVis === 'all' ? 'is-on' : ''}
            onclick={() => (privMoneyVis = 'all')}
          >{t('settings.priv_all_collab', locale)}</button>
        </div>
      </div>
    </div>

    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.priv_notes', locale)}</div>
        <div class="set-row__hint">{t('settings.priv_notes_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <button
          type="button"
          class={['set-toggle', privNotesPrivate && 'is-on']
            .filter(Boolean)
            .join(' ')}
          aria-label={t('settings.priv_notes', locale)}
          aria-pressed={privNotesPrivate}
          onclick={() => (privNotesPrivate = !privNotesPrivate)}
        >
          <span class="set-toggle__dot"></span>
        </button>
      </div>
    </div>

    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.priv_distribution', locale)}</div>
        <div class="set-row__hint">{t('settings.priv_distribution_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <div class="set-seg">
          <button
            type="button"
            class={privDistribution === 'me-only' ? 'is-on' : ''}
            onclick={() => (privDistribution = 'me-only')}
          >{t('settings.priv_only_me', locale)}</button>
          <button
            type="button"
            class={privDistribution === 'distributors' ? 'is-on' : ''}
            onclick={() => (privDistribution = 'distributors')}
          >{t('settings.priv_distributors_only', locale)}</button>
          <button
            type="button"
            class={privDistribution === 'all' ? 'is-on' : ''}
            onclick={() => (privDistribution = 'all')}
          >{t('settings.priv_everyone', locale)}</button>
        </div>
      </div>
    </div>
  </div>
</section>
