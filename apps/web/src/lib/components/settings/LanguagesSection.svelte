<script lang="ts">
  import { t, appLocale, LOCALES, type Locale } from '$lib/i18n';

  const locale = appLocale();

  // Each language is named in itself, so these never go through t(): a
  // Catalan reader looking for "English" must find "English".
  const NATIVE_NAME: Record<Locale, string> = {
    ca: 'Català',
    es: 'Castellano',
    en: 'English',
    fr: 'Français',
  };

  // ─── languages state ──────────────────────────────────────────────────
  // Working languages (which langs the user speaks) deferred: it's Person
  // metadata, not an app setting. Only the app-interface language remains.
  //
  // NOT PERSISTED: picking a language here changes nothing yet. The session
  // language is the browser's (`appLocale()`); the intended source,
  // user_profile.locale, is not wired to the client. Until it is, this
  // control only starts on the active language and moves locally.
  let appLanguage = $state<Locale>(locale);
</script>

<header class="set-mast">
  <p class="eyebrow set-mast__kicker">{t('settings.lang_kicker', locale)}</p>
  <h1 class="set-mast__title"><em>{t('settings.nav_languages', locale)}</em></h1>
  <p class="set-mast__sub">{t('settings.lang_sub', locale)}</p>
</header>

<!-- "Working languages" list killed: it's metadata of the Person
     entity (which languages Marco speaks), not an app setting.
     Belongs on the Person profile when that page exists. -->

<section class="set-group">
  <div class="set-group__head">
    <span class="eyebrow set-group__kicker">{t('settings.lang_interface', locale)}</span>
  </div>
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.lang_app', locale)}</div>
        <div class="set-row__hint">{t('settings.lang_app_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <div class="set-seg">
          {#each LOCALES as code (code)}
            <button
              type="button"
              lang={code}
              class={appLanguage === code ? 'is-on' : ''}
              aria-pressed={appLanguage === code}
              onclick={() => (appLanguage = code)}
            >{NATIVE_NAME[code]}</button>
          {/each}
        </div>
      </div>
    </div>
  </div>
</section>
