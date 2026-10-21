<script lang="ts">
  /**
   * SettingsSectionSelect: the settings sections as one dropdown at the top
   * of the page, under 1024px, where the nav column beside the rail would
   * leave the page too narrow (at 768 it left 208px). Same catalog and same
   * `?section=` URL as <SettingsNav />: the shell hides that nav below 64rem
   * and this select shows only there (one breakpoint, two sides).
   */
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { t, appLocale } from '$lib/i18n';
  import Select from './Select.svelte';
  import { SECTIONS, sectionFrom } from './SettingsNav.svelte';

  const locale = appLocale();

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let active = $derived(sectionFrom(page.url.searchParams.get('section')));
  let options = $derived(SECTIONS.map((s) => ({ value: s.id, label: t(s.labelKey, locale) })));

  function choose(event: Event) {
    const id = (event.currentTarget as HTMLSelectElement).value;
    void goto(`/h/${workspaceSlug}/settings?section=${id}`);
  }
</script>

<div class="set-picker">
  <Select
    id="settings-section"
    label={t('settings.section_label', locale)}
    value={active}
    {options}
    onchange={choose}
  />
</div>

<style>
  @layer components {
    @media (min-width: 64rem) {
      .set-picker {
        display: none;
      }
    }
  }
</style>
