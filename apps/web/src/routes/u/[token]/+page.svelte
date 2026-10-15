<script lang="ts">
  /**
   * La página de baja (plan § 3.4): una frase, un botón, y la vuelta atrás.
   * Sin pedir motivo ni iniciar sesión; funciona sin JavaScript (formularios
   * normales contra las acciones de +page.server.ts).
   */
  import { t } from '$lib/i18n';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let locale = $derived(data.locale);
  let company = $derived(data.company ?? '');
  let done = $derived(form && 'done' in form ? form.done : null);
  let unsubscribed = $derived(done ? done === 'unsubscribed' : data.unsubscribed);
</script>

<svelte:head>
  <title>{t('unsub.page_title', locale)}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="unsub">
  {#if !data.found}
    <p class="unsub__lead">{t('unsub.invalid', locale)}</p>
  {:else if form && 'error' in form && form.error === 'busy'}
    <p class="unsub__lead">{t('unsub.busy', locale)}</p>
  {:else if unsubscribed}
    <p class="unsub__lead">{t('unsub.done', locale, { company })}</p>
    <form method="POST">
      <input type="hidden" name="undo" value="1" />
      <p class="unsub__aside">
        {t('unsub.mistake', locale)}
        <button type="submit" class="unsub__link">{t('unsub.undo', locale)}</button>
      </p>
    </form>
  {:else}
    <p class="unsub__lead">
      {done === 'resubscribed' ? t('unsub.resubscribed', locale, { company }) : t('unsub.ask', locale, { company })}
    </p>
    {#if done !== 'resubscribed'}
      <form method="POST">
        <button type="submit" class="btn--primary btn--m">{t('unsub.confirm', locale)}</button>
      </form>
    {/if}
  {/if}
</main>

<style>
  @layer components {
    .unsub {
      max-inline-size: 32rem;
      margin: 0 auto;
      padding: var(--space-xxl) var(--space-m);
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }
    .unsub__lead {
      font-size: var(--text-l);
      line-height: 1.4;
    }
    .unsub__aside {
      font-size: var(--text-s);
      color: var(--text-faint);
    }
    .unsub__link {
      background: none;
      border: 0;
      padding: 0;
      color: inherit;
      text-decoration: underline;
      cursor: pointer;
      font: inherit;
    }
  }
</style>
