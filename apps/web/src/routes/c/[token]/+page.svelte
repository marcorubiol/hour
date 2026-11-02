<script lang="ts">
  /**
   * La confirmación de un alta (plan 2026-11-01-audience § 3.3): una frase y
   * un botón; «Hecho» o «Enlace caducado». Sin marca de Hour. Funciona sin
   * JavaScript.
   */
  import { t } from '$lib/i18n';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let locale = $derived(data.locale);
  let vars = $derived({ company: data.company, list: data.list });
  let error = $derived(form && 'error' in form ? form.error : null);
  let confirmed = $derived((form && 'confirmed' in form) || data.confirmed);
</script>

<svelte:head>
  <title>{t('audience.confirm_page_title', locale)}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="confirm" lang={locale}>
  {#if confirmed}
    <p class="confirm__lead" role="status">{t('audience.confirm_done', locale, vars)}</p>
  {:else if error === 'busy'}
    <p class="confirm__lead">{t('audience.busy', locale)}</p>
  {:else if !data.valid || error === 'expired'}
    <p class="confirm__lead">{t('audience.confirm_expired', locale)}</p>
  {:else}
    <p class="confirm__lead">{t('audience.confirm_ask', locale, vars)}</p>
    {#if error}<p class="confirm__error" role="alert">{t('audience.form_error', locale)}</p>{/if}
    <form method="POST">
      <button type="submit" class="btn--primary">{t('audience.confirm_button', locale)}</button>
    </form>
  {/if}
</main>

<style>
  @layer components {
    .confirm {
      max-inline-size: 32rem;
      margin: 0 auto;
      padding: var(--space-xxl) var(--space-m);
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }
    .confirm__lead {
      font-size: var(--text-l);
      line-height: 1.4;
    }
    .confirm__error {
      color: var(--danger);
      font-size: var(--text-s);
    }
  }
</style>
