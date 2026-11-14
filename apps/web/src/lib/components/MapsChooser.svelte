<script lang="ts">
  /**
   * «Abrir con»: the short sheet the first «Mapa» opens when this device has
   * no map app saved (ADR-206). The frame is `Dialog`, which is a sheet from
   * below on a phone.
   *
   * Each option is a real link to its app, so the map opens inside the same
   * tap (iOS blocks an `open()` that comes after a wait); the click also
   * saves the choice and closes the sheet. One line says it is remembered
   * and where it changes: Settings in the app, «Cambiar» on a road sheet.
   */
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import { MAPS_APPS, MAPS_APP_NAME, mapsHref, type MapsApp } from '$lib/ahora';
  import { setMapsApp } from '$lib/maps-app.svelte';
  import { appLocale, t } from '$lib/i18n';

  interface Props {
    open?: boolean;
    parts: readonly (string | null | undefined)[];
    /** Where the choice changes later: Settings (signed in) or «Cambiar» by the button. */
    changeIn: 'settings' | 'here';
    /** The app saved now, marked; null when asking for the first time. */
    current?: MapsApp | null;
  }

  let { open = $bindable(false), parts, changeIn, current = null }: Props = $props();

  const locale = appLocale();

  function pick(app: MapsApp) {
    setMapsApp(app);
    open = false;
  }
</script>

<Dialog bind:open size="s" title={t('maps.choose_title', locale)}>
  <ul class="maps-choose" role="list" data-testid="maps-chooser">
    {#each MAPS_APPS as app (app)}
      <li>
        <a
          class="maps-choose__app"
          href={mapsHref(parts, app)}
          target="_blank"
          rel="noopener noreferrer"
          aria-current={current === app ? 'true' : undefined}
          data-testid="maps-choose-{app}"
          onclick={() => pick(app)}>{MAPS_APP_NAME[app]}</a
        >
      </li>
    {/each}
  </ul>
  <p class="maps-choose__hint">
    {changeIn === 'settings' ? t('maps.choose_hint_settings', locale) : t('maps.choose_hint_here', locale)}
  </p>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (open = false)}>{t('maps.cancel', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  .maps-choose {
    display: grid;
    gap: var(--space-xs);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .maps-choose__app {
    display: flex;
    align-items: center;
    min-block-size: calc(var(--touch-target) + var(--space-s));
    padding-inline: var(--space-m);
    border: var(--line-hairline) solid var(--border-color-dark);
    border-radius: var(--radius-m);
    color: var(--heading-color);
    text-decoration: none;
  }

  .maps-choose__app[aria-current='true'] {
    border-color: var(--heading-color);
  }

  /* Not on touch: a tapped option would stay marked as if it were the saved one. */
  @media (hover: hover) {
    .maps-choose__app:hover {
      border-color: var(--heading-color);
    }
  }

  .maps-choose__hint {
    margin-block: var(--space-s) 0;
    font-size: var(--text-s);
    color: var(--text-muted);
  }
</style>
