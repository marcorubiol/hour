<script lang="ts">
  /**
   * Sign-in page — editorial split layout (design system v0.5, ADR-033).
   *
   * Left column carries the form, right column carries brand promise + a
   * static "this week" preview card. The preview is hardcoded — it's
   * illustrative (the design says "v0.4 prototype") and shouldn't carry the
   * cost of fetching real conversations before auth.
   */

  import { docTitle } from '$lib/doc-title';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { chooseLocale, LOCALE_NAME, LOCALE_TAG, LOCALES, loadLocale, t, type Locale } from '$lib/i18n';
  import Segmented from '$lib/components/Segmented.svelte';
  import { ensureSession, setSessionUser, type SessionUser } from '$lib/session.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';

  let { data }: { data: { locale: Locale } } = $props();

  /** The door's language (ADR-169): chosen here, it stays after entering. */
  let locale = $derived<Locale>(data.locale);
  const localeOptions = LOCALES.map((value) => ({ value, label: LOCALE_NAME[value] }));

  async function pickLocale(next: Locale) {
    await loadLocale(next);
    chooseLocale(next);
    locale = next;
  }

  /** The preview card's illustrative day, in the door's language. */
  const PREVIEW_DAY = new Date(2026, 4, 18);
  let previewDay = $derived(
    `${new Intl.DateTimeFormat(LOCALE_TAG[locale], { weekday: 'short' }).format(PREVIEW_DAY)} · ${new Intl.DateTimeFormat(LOCALE_TAG[locale], { day: 'numeric', month: 'short' }).format(PREVIEW_DAY)}`,
  );

  /** After signing in: Hoy (ADR-137), unless `?next=` says where. */
  const HOME = '/h/desk';

  let email = $state('');
  let password = $state('');
  let fullName = $state('');
  let submitting = $state(false);
  let errorMsg = $state('');
  let confirmationRequired = $state(false);
  let isSignup = $derived(page.url.searchParams.get('mode') === 'signup');
  let nextPath = $derived.by(() => {
    const candidate = page.url.searchParams.get('next');
    // Same-origin path only. Reject protocol-relative ('//host') AND
    // backslash-folded ('/\host', which URL parsers normalise to '//host')
    // so this stays safe even if the redirect ever moves off goto()'s
    // internal-navigation guard.
    return candidate && /^\/(?![/\\])/.test(candidate) ? candidate : HOME;
  });
  let alternateHref = $derived(
    `/login?${new URLSearchParams({
      ...(isSignup ? {} : { mode: 'signup' }),
      ...(nextPath !== HOME ? { next: nextPath } : {}),
    }).toString()}`,
  );

  // The button waits for this (see the form's comment below).
  let hydrated = $state(false);

  onMount(async () => {
    hydrated = true;
    // Already signed in (httpOnly cookie — only the server can tell).
    if (await ensureSession()) {
      goto(nextPath, { replaceState: true });
    }
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    errorMsg = '';
    submitting = true;

    try {
      // Worker-mediated sign-in (Phase 0.9): the password grant runs
      // server-side and the session lands as httpOnly cookies — tokens
      // never touch JS or localStorage.
      const res = await fetch(isSignup ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isSignup ? { full_name: fullName, email, password } : { email, password },
        ),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const key =
          body.error === 'rate_limited'
            ? 'login.rate_limited'
            : body.error === 'auth_unavailable'
              ? 'login.auth_unavailable'
              : 'login.invalid_credentials';
        throw new Error(
          isSignup && body.error === 'signup_rejected'
            ? // Deliberately generic — do not confirm whether the address is
              // already registered (email-enumeration oracle). Point existing
              // users at sign-in without asserting the account exists.
              t('login.signup_rejected', locale)
            : t(key, locale),
        );
      }

      const data = (await res.json()) as {
        status?: 'signed_in' | 'confirmation_required';
        user?: SessionUser | null;
      };
      if (data.status === 'confirmation_required') {
        confirmationRequired = true;
        submitting = false;
        return;
      }
      // A device cache of someone else goes before anything paints (ADR-144).
      await setSessionUser(data.user ?? null);

      goto(nextPath, { replaceState: true });
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : t('login.invalid_credentials', locale);
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>{docTitle(t(isSignup ? 'login.signup_kicker' : 'login.submit', locale))}</title>
</svelte:head>

<main class="login" lang={locale}>
  <section class="login__left">
    <header class="login__brand">
      <BrandMark size="m" />
    </header>

    <div class="login__center">
      <span class="eyebrow login__kicker">{t(isSignup ? 'login.signup_kicker' : 'login.submit', locale)}</span>
      <h1 class="login__title">
        {t(isSignup ? 'login.title_signup_a' : 'login.title_signin_a', locale)}
        <em>{t(isSignup ? 'login.title_signup_b' : 'login.title_signin_b', locale)}</em>
      </h1>
      <p class="login__sub">
        {t(isSignup ? 'login.sub_signup' : 'login.sub_signin', locale)}
      </p>

      <!-- method="post" is the safety net, not the path: handleSubmit
           preventDefaults and posts JSON to /api/auth/login. But the button is
           live in the SSR'd HTML before hydration, and a submit in that window
           runs the browser's native default — which without this attribute is
           GET, i.e. the password lands in the query string (history, access
           logs, Referer). POST keeps it in the body; the route has no form
           action, so it dead-ends at 405 instead of leaking. And so the 405 is
           never reached, the button stays disabled until the page has
           hydrated: on a slow network a person (and the E2E's logins,
           2026-10-24) pressed it in that window and landed on «405 Method Not
           Allowed». What was typed before is kept: bind:value reads it in. -->
      <form class="login__form" method="post" onsubmit={handleSubmit}>
        {#if isSignup}
          <label class="login__field">
            <span class="eyebrow login__label">{t('login.full_name', locale)}</span>
            <input
              type="text"
              name="full_name"
              autocomplete="name"
              placeholder={t('login.full_name_placeholder', locale)}
              required
              minlength="2"
              bind:value={fullName}
            />
          </label>
        {/if}
        <label class="login__field">
          <span class="eyebrow login__label">{t('login.email', locale)}</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            
            type="email"
            name="email"
            autocomplete="email"
            placeholder={t('login.email_placeholder', locale)}
            required
            autofocus={!isSignup}
            bind:value={email}
          />
        </label>

        <label class="login__field">
          <span class="eyebrow login__label">{t('login.password', locale)}</span>
          <input
            
            type="password"
            name="password"
            autocomplete={isSignup ? 'new-password' : 'current-password'}
            placeholder="••••••••"
            required
            minlength={isSignup ? 10 : undefined}
            bind:value={password}
          />
        </label>

        {#if confirmationRequired}
          <p class="login__notice" role="status">
            {t('login.confirm_notice', locale, { email })}
          </p>
        {/if}

        {#if errorMsg}
          <p class="login__error" role="alert">{errorMsg}</p>
        {/if}

        <button class="btn--primary login__submit" type="submit" disabled={!hydrated || submitting}>
          <span>
            {submitting
              ? t(isSignup ? 'login.creating' : 'login.signing_in', locale)
              : t(isSignup ? 'login.create' : 'login.submit', locale)}
          </span>
          <span class="login__submit-arrow" aria-hidden="true">→</span>
        </button>
      </form>
      <p class="login__alternate">
        {t(isSignup ? 'login.have_account' : 'login.via_invite', locale)}
        <a href={alternateHref}>{t(isSignup ? 'login.submit' : 'login.create_one', locale)}</a>
      </p>
    </div>

    <footer class="login__foot">
      <span>{t('login.phase', locale)}</span>
      <Segmented
        options={localeOptions}
        value={locale}
        ariaLabel={t('login.language', locale)}
        name="locale"
        onchange={pickLocale}
      />
    </footer>
  </section>

  <aside class="login__right" aria-hidden="true">
    <div class="login__quote">
      <div class="login__quote-kicker">{t('login.quote_kicker', locale)}</div>
      <p class="login__quote-text">
        {t('login.quote_a', locale)} <em>{t('login.quote_b', locale)}</em>
      </p>
      <div class="login__quote-attr">{t('login.quote_attr', locale)}</div>
    </div>

    <div class="login__preview">
      <div class="login__preview-head">
        <span class="login__preview-dot" style="background: var(--accent-1)"></span>
        <span class="login__preview-name">{t('login.preview_week', locale)}</span>
        <span class="login__preview-day">{previewDay}</span>
      </div>
      <div class="login__preview-item">
        <span class="login__preview-kind">{t('login.preview_kind_task', locale)}</span>
        <span class="login__preview-verb">{t('login.preview_confirm', locale)}</span>
        <span class="login__preview-subj">{t('login.preview_hotel', locale)}</span>
        <span class="login__preview-proj">mamemi</span>
      </div>
      <div class="login__preview-item">
        <span class="login__preview-kind login__preview-kind--wait">{t('login.preview_kind_wait', locale)}</span>
        <span class="login__preview-verb">Ruth Schmidli</span>
        <span class="login__preview-subj">{t('login.preview_fee', locale)}</span>
        <span class="login__preview-proj">mamemi</span>
      </div>
      <div class="login__preview-item">
        <span class="login__preview-kind login__preview-kind--event">{t('login.preview_kind_event', locale)}</span>
        <span class="login__preview-verb">{t('login.preview_mix', locale)}</span>
        <span class="login__preview-subj">{t('login.preview_session', locale)}</span>
        <span class="login__preview-proj">marco rubiol</span>
      </div>
      <div class="login__preview-item">
        <span class="login__preview-kind login__preview-kind--money">{t('login.preview_kind_money', locale)}</span>
        <span class="login__preview-verb">{t('login.preview_chase', locale)}</span>
        <span class="login__preview-subj">{t('login.preview_residency', locale)}</span>
        <span class="login__preview-proj">marco rubiol</span>
      </div>
    </div>
  </aside>
</main>

<style>
  @layer components {
    .login {
      display: grid;
      grid-template-columns: minmax(26.25rem, 1fr) minmax(27.5rem, 1.1fr);
      min-block-size: 100dvh;
      background: var(--bg);
      color: var(--text-color);
    }

    @media (max-width: 55rem) {
      .login {
        grid-template-columns: 1fr;
      }
      .login__right {
        display: none;
      }
    }

    /* ── left: brand + form ── */

    .login__left {
      display: grid;
      grid-template-rows: auto 1fr auto;
      padding: clamp(var(--space-l), 4vw, var(--space-xxl));
      min-block-size: 0;
    }

    /* .login__brand kept only as a positioning hook for the header slot
       in the split grid; styling lives in <BrandMark />. */
    .login__brand {
      display: inline-flex;
    }

    .login__center {
      display: flex;
      flex-direction: column;
      justify-content: center;
      max-inline-size: 22.5rem;
      inline-size: 100%;
      margin-inline: auto;
      padding-block: var(--space-xl);
    }

    /* Kicker typography via base.css .eyebrow. */
    .login__kicker {
      margin-block-end: var(--space-m);
    }

    .login__title {
      font-family: var(--font-display);
      font-size: var(--display-l);
      font-weight: 400;
      letter-spacing: var(--heading-letter-spacing);
      line-height: 1.05;
      margin: 0;
      color: var(--text-color);
    }
    .login__title em {
      font-style: italic;
      color: var(--text-muted);
    }

    .login__sub {
      margin-block-start: var(--space-m);
      margin-block-end: var(--space-xl);
      color: var(--text-muted);
      font-size: var(--text-m);
      line-height: 1.55;
      text-wrap: pretty;
      max-inline-size: 32ch;
    }

    /* form */
    .login__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .login__field {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    /* Label typography via base.css .eyebrow. */


    .login__error {
      font-size: var(--text-s);
      color: var(--danger);
      margin: 0;
    }

    .login__notice {
      margin: 0;
      padding: var(--space-s);
      border-inline-start: var(--line) solid var(--accent-color);
      background: var(--bg-light);
      color: var(--text-muted);
      font-size: var(--text-s);
      line-height: 1.5;
    }

    .login__alternate {
      margin-block: var(--space-m) 0;
      color: var(--text-faint);
      font-size: var(--text-s);
    }
    .login__alternate a {
      margin-inline-start: 0.35rem;
      color: var(--text-color);
      text-underline-offset: 0.2em;
    }

    /* Login submit — full-width primary CTA aligned to the inputs
       above. Slightly smaller vertical padding than the default block
       to keep proportions sensible (the default --btn-padding-block
       is sized for inline buttons, not stretched ones). */
    .login__submit {
      --btn-width: 100%;
      --btn-padding-block: var(--space-s);
      --btn-font-size: var(--text-m);
      margin-block-start: var(--space-s);
    }
    .login__submit-arrow {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      opacity: 0.7;
    }

    .login__foot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-s);
      font-size: var(--text-xs);
      color: var(--text-faint);
      flex-wrap: wrap;
    }

    /* ── right: brand promise + preview ── */

    .login__right {
      background: var(--bg-light);
      border-inline-start: var(--line-hairline) solid var(--border-color-light);
      padding: clamp(var(--space-l), 4vw, var(--space-xxl));
      display: grid;
      grid-template-rows: 1fr auto;
      gap: var(--space-s);
      min-block-size: 0;
      position: relative;
      overflow: hidden;
    }

    /* Subtle decorative diamond — same vocab as section kind glyphs. */
    .login__right::before {
      content: "";
      position: absolute;
      inset-block-start: -2.5rem;
      inset-inline-end: -2.5rem;
      inline-size: 13.75rem;
      block-size: 13.75rem;
      border: var(--line-hairline) solid var(--border-color-dark);
      transform: rotate(45deg);
      opacity: 0.45;
    }

    .login__quote {
      align-self: center;
      max-inline-size: 30rem;
      position: relative;
    }

    .login__quote-kicker {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-xl);
      text-transform: uppercase;
      color: var(--text-faint);
      margin-block-end: var(--space-m);
    }

    .login__quote-text {
      font-family: var(--font-display);
      font-size: var(--text-xxl);
      font-weight: 400;
      letter-spacing: var(--heading-letter-spacing);
      line-height: 1.2;
      color: var(--text-color);
      margin: 0;
      text-wrap: balance;
    }
    .login__quote-text em {
      font-style: italic;
      color: var(--text-muted);
    }

    .login__quote-attr {
      margin-block-start: var(--space-m);
      font-size: var(--text-xs);
      color: var(--text-faint);
      font-family: var(--font-mono);
      letter-spacing: var(--tracking-s);
    }

    .login__preview {
      background: var(--bg-ultra-light);
      border: var(--line-hairline) solid var(--border-color-light);
      border-radius: var(--radius-l);
      padding: var(--space-m) var(--space-l);
      box-shadow: var(--box-shadow-2);
      max-inline-size: 27.5rem;
    }

    .login__preview-head {
      display: flex;
      align-items: center;
      gap: var(--space-s);
      margin-block-end: var(--space-m);
      padding-block-end: var(--space-s);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }

    .login__preview-dot {
      inline-size: var(--dot-l);
      block-size: var(--dot-l);
      border-radius: 50%;
    }

    .login__preview-name {
      font-family: var(--font-display);
      font-size: var(--text-m);
      font-weight: 500;
      letter-spacing: var(--heading-letter-spacing);
      color: var(--text-color);
    }

    .login__preview-day {
      margin-inline-start: auto;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-l);
      text-transform: uppercase;
      color: var(--text-faint);
    }

    .login__preview-item {
      display: grid;
      grid-template-columns: 4rem auto minmax(0, 1fr) auto;
      gap: var(--space-s);
      align-items: baseline;
      padding-block: var(--space-xs);
      font-size: var(--text-xs);
    }
    .login__preview-item + .login__preview-item {
      border-block-start: var(--line-hairline) solid var(--border-color-light);
    }

    .login__preview-kind {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
      letter-spacing: var(--tracking-s);
      text-transform: uppercase;
    }
    .login__preview-kind--wait {
      color: var(--text-faint);
      font-style: italic;
    }
    .login__preview-kind--event {
      color: var(--success);
    }
    .login__preview-kind--money {
      color: var(--warning);
    }

    .login__preview-verb {
      color: var(--text-color);
      font-weight: 500;
    }
    .login__preview-subj {
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .login__preview-proj {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
      text-transform: lowercase;
      letter-spacing: var(--tracking-s);
    }
  }
</style>
