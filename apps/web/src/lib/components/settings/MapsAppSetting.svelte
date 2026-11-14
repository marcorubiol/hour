<script lang="ts">
  /**
   * «Abrir mapas con» (ADR-206): the map app «Mapa» opens on THIS device, or
   * «Preguntar» to get the chooser again. A device preference
   * (`$lib/maps-app.svelte`), so it saves at once, with no request.
   */
  import { onMount } from 'svelte';
  import Select from '$lib/components/Select.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import { MAPS_APPS, MAPS_APP_NAME, isMapsApp } from '$lib/ahora';
  import { mapsPref, restoreMapsApp, setMapsApp } from '$lib/maps-app.svelte';
  import { appLocale, t } from '$lib/i18n';

  const locale = appLocale();

  onMount(restoreMapsApp);

  const options = [
    { value: 'ask', label: t('maps.setting_ask', locale) },
    ...MAPS_APPS.map((app) => ({ value: app, label: MAPS_APP_NAME[app] })),
  ];
</script>

<section class="set-group" data-testid="maps-app-setting">
  <BlockHead title={t('maps.setting_title', locale)} />
  <div class="set-group__body">
    <div class="set-row maps-setting">
      <div class="set-row__lead">
        <div class="set-row__hint">{t('maps.setting_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        <Select
          ariaLabel={t('maps.setting_title', locale)}
          {options}
          value={mapsPref.app ?? 'ask'}
          onchange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            setMapsApp(isMapsApp(v) ? v : null);
          }}
        />
      </div>
    </div>
  </div>
</section>
