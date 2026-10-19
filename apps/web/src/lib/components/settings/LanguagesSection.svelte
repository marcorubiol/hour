<script lang="ts">
  import Segmented from '$lib/components/Segmented.svelte';
  import RecordHead from '$lib/components/RecordHead.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import { t, appLocale, LOCALES, type Locale } from '$lib/i18n';
  import WorkspaceTrade from './WorkspaceTrade.svelte';

  let { workspaceId }: { workspaceId?: string } = $props();

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

<RecordHead crumbs={[{ label: t('settings.title', locale) }, { label: t('settings.lang_kicker', locale) }]} title={t('settings.nav_languages', locale)}>
  {#snippet facts()}<span>{t('settings.lang_sub', locale)}</span>{/snippet}
</RecordHead>

<!-- "Working languages" list killed: it's metadata of the Person
     entity (which languages Marco speaks), not an app setting.
     Belongs on the Person profile when that page exists. -->

<section class="set-group">
  <BlockHead title={t('settings.lang_interface', locale)} />
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('settings.lang_app', locale)}</div>
        <div class="set-row__hint">{t('settings.lang_app_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <Segmented
          ariaLabel={t('settings.lang_app', locale)}
          options={LOCALES.map((code) => ({ value: code, label: NATIVE_NAME[code] }))}
          bind:value={appLanguage}
        />
      </div>
    </div>
  </div>
</section>

<WorkspaceTrade {workspaceId} />
