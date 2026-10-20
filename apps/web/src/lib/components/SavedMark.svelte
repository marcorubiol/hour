<script lang="ts">
  /**
   * «guardado» (ADR-139 p7): the one way an in-place value says it is kept,
   * in grey, beside it, for a moment (`SaveFlash` times it). Field draws it
   * at a row's end; a switch or a segmented setting draws it beside itself.
   */
  import { appLocale, t } from '$lib/i18n';

  let { shown = false }: { shown?: boolean } = $props();
  const locale = appLocale();
</script>

<span class="field__saved" role="status">{#if shown}{t('form.saved', locale)}{/if}</span>
