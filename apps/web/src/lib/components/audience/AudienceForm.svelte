<script lang="ts">
  /**
   * El formulario público de una lista (plan 2026-11-01-audience § 3.2): el
   * nombre y el logo de la compañía, la lista, correo, nombre, la casilla del
   * consentimiento sin marcar con el texto de la lista, la de la edad, la
   * primera capa de información y la política. Sin marca de Hour. Funciona sin
   * JavaScript (un <form> contra la acción por defecto). `embed`: la misma
   * página para un iframe, sin margen alrededor y con los enlaces en otra
   * pestaña.
   */
  import { LOCALE_NAME, t } from '$lib/i18n';
  import type { AudienceFormData } from '$lib/server/audience-form';

  interface Props {
    data: AudienceFormData;
    form: { sent?: true; error?: string; email?: string; name?: string } | null;
  }

  let { data, form }: Props = $props();

  let locale = $derived(data.locale);
  let company = $derived(data.company);
  let error = $derived(form?.error ?? null);
  let target = $derived(data.channel === 'embed' ? '_blank' : undefined);
  // La primera capa: la de la lista o la propuesta, con la política enlazada donde dice {policy}.
  let info = $derived(
    (data.infoText ?? t('audience.form_info_default', locale, { company })).split('{policy}'),
  );
  const errorKey: Record<string, string> = {
    email: 'audience.form_error_email',
    consent: 'audience.form_error_consent',
    age: 'audience.form_error_age',
    busy: 'audience.busy',
  };
</script>

<svelte:head>
  <title>{data.found ? `${company} · ${data.list}` : t('audience.form_page_title', locale)}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="aud" class:aud--embed={data.channel === 'embed'} lang={locale}>
  {#if data.logoUrl}
    <img class="aud__logo" src={data.logoUrl} alt={company} />
  {/if}

  {#if !data.found || !data.open}
    <p class="aud__lead">{t('audience.form_closed', locale)}</p>
  {:else if form?.sent}
    <p class="aud__lead" role="status">{t('audience.form_sent', locale)}</p>
  {:else}
    <header class="aud__head">
      <h1 class="aud__title">{t('audience.form_title', locale, { company })}</h1>
      <p class="aud__list">{data.list}</p>
      {#if data.description}<p class="aud__desc">{data.description}</p>{/if}
    </header>

    {#if data.languages.length > 1}
      <nav class="aud__langs">
        {#each data.languages as l (l)}
          {#if l === locale}
            <span aria-current="true">{LOCALE_NAME[l]}</span>
          {:else}
            <a href="?lang={l}" hreflang={l}>{LOCALE_NAME[l]}</a>
          {/if}
        {/each}
      </nav>
    {/if}

    <form class="aud__form" method="POST">
      <input type="hidden" name="language" value={locale} />
      <input type="hidden" name="consent_text_id" value={data.textId} />
      {#if data.pageUrl}<input type="hidden" name="page_url" value={data.pageUrl} />{/if}

      <label class="field field--stack" class:field--error={error === 'email'}>
        <span class="field__label eyebrow">{t('audience.form_email', locale)}</span>
        <span class="field__control">
          <input type="email" name="email" autocomplete="email" required value={form?.email ?? ''} />
        </span>
      </label>
      <label class="field field--stack">
        <span class="field__label eyebrow">{t('audience.form_name', locale)}</span>
        <span class="field__control">
          <input type="text" name="name" autocomplete="name" maxlength="200" value={form?.name ?? ''} />
        </span>
      </label>

      <!-- El campo trampa: fuera de la vista y del teclado; una persona no lo ve. -->
      <label class="aud__trap" aria-hidden="true">
        Website
        <input type="text" name="website" tabindex="-1" autocomplete="off" />
      </label>

      <div class="check">
        <label class="check__row aud__check">
          <input class="check__input" type="checkbox" name="consent" required />
          <span class="check__box"></span>
          <span>{data.consentText}</span>
        </label>
        <label class="check__row aud__check">
          <input class="check__input" type="checkbox" name="age" required />
          <span class="check__box"></span>
          <span>{t('audience.form_age', locale)}</span>
        </label>
      </div>

      <p class="aud__info">
        {info[0]}{#if info.length > 1}{#if data.privacyUrl}<a href={data.privacyUrl} {target} rel="noopener"
              >{t('audience.form_policy', locale)}</a
            >{:else}{t('audience.form_policy', locale)}{/if}{info.slice(1).join('')}{/if}
      </p>

      {#if error}
        <p class="aud__error" role="alert">{t(errorKey[error] ?? 'audience.form_error', locale)}</p>
      {/if}

      <button type="submit" class="btn--primary">{t('audience.form_submit', locale)}</button>
    </form>
  {/if}
</main>

<style>
  @layer components {
    .aud {
      max-inline-size: 32rem;
      margin: 0 auto;
      padding: var(--space-xxl) var(--space-m);
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
    }
    .aud--embed {
      padding: var(--space-m);
    }
    .aud__logo {
      max-inline-size: 12rem;
      max-block-size: 4rem;
      object-fit: contain;
      align-self: flex-start;
    }
    .aud__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .aud__title,
    .aud__lead {
      font-size: var(--text-l);
      line-height: 1.4;
    }
    .aud__list {
      font-weight: 600;
    }
    .aud__desc,
    .aud__info {
      font-size: var(--text-s);
      color: var(--text-faint);
    }
    .aud__langs {
      display: flex;
      gap: var(--space-s);
      font-size: var(--text-s);
    }
    .aud__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }
    .aud__form input[type='email'],
    .aud__form input[type='text'] {
      inline-size: 100%;
    }
    .aud__check {
      align-items: flex-start;
    }
    .aud__error {
      color: var(--danger);
      font-size: var(--text-s);
    }
    .aud__trap {
      position: absolute;
      inset-inline-start: -100vw;
      inline-size: var(--line-hairline);
      block-size: var(--line-hairline);
      overflow: hidden;
    }
    .aud__form button {
      align-self: flex-start;
    }
  }
</style>
