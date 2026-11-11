<script lang="ts">
  /**
   * The app's one error page (tarea 132). It replaced SvelteKit's bare
   * «404 Not Found», in English, without margin or a way out. Two answers,
   * as a record's page gives them (`load-fail.ts`): it is not there for you
   * (404, 403), or something broke (anything else), never the server's own
   * text. Either way, the way back to Hoy; a failure also offers to reload.
   *
   * It renders under the root layout only (no shell: the shell may be what
   * failed), so it draws its own small frame, the offline page's.
   */
  import { page } from '$app/state';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import { docTitle } from '$lib/doc-title';
  import { appLocale, t } from '$lib/i18n';

  const locale = appLocale();
  let missing = $derived(page.status === 404 || page.status === 403);
  let title = $derived(t(missing ? 'error.title_missing' : 'error.title_failed', locale));
</script>

<svelte:head>
  <title>{docTitle(title)}</title>
</svelte:head>

<main class="app-error" lang={locale} data-testid="app-error" data-status={page.status}>
  <a class="app-error__brand" href="/h/desk" aria-label={t('ui.back_today', locale)}><BrandMark size="m" /></a>
  <div class="app-error__body">
    <h1 class="app-error__title">{title}</h1>
    <p class="app-error__text">{t(missing ? 'error.body_missing' : 'error.body_failed', locale)}</p>
    <p class="app-error__acts">
      <a class="link-arrow" href="/h/desk">{t('ui.back_today', locale)}</a>
      {#if !missing}
        <button type="button" class="btn--secondary btn--s" onclick={() => location.reload()}
          >{t('error.reload', locale)}</button
        >
      {/if}
    </p>
  </div>
</main>

<style>
  @layer components {
    .app-error {
      display: grid;
      grid-template-rows: auto 1fr;
      min-block-size: 100dvh;
      padding: clamp(var(--space-l), 4vw, var(--space-xxl));
      background: var(--bg);
      color: var(--text-color);
    }
    .app-error__brand {
      justify-self: start;
      color: inherit;
      text-decoration: none;
    }
    .app-error__body {
      align-self: center;
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
      inline-size: 100%;
      max-inline-size: 32rem;
      margin-inline: auto;
    }
    .app-error__title {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--display-l);
      font-weight: 400;
      font-style: italic;
      letter-spacing: var(--heading-letter-spacing);
      line-height: 1.05;
    }
    .app-error__text {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-m);
      line-height: 1.55;
      text-wrap: pretty;
    }
    .app-error__acts {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-m);
      margin: 0;
    }
  }
</style>
