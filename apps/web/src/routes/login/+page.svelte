<script lang="ts">
  /**
   * The door — editorial split layout (design system v0.5, ADR-033): the form
   * on the left, the brand's promise on the right.
   *
   * Four modes on one page (tarea 132), so the frame is drawn once:
   *   signin   the default
   *   signup   `?mode=signup`, only for whoever arrives with an invitation:
   *            the link to it is no longer offered to everyone
   *   recover  `?mode=recover`, «¿Olvidaste la contraseña?»: Supabase mails a
   *            link back here (`/api/auth/recover`)
   *   reset    `?mode=reset`, where that link lands: the new password, then in
   *            (`/api/auth/reset`). The link carries `token_hash` in the query
   *            (our template) or a session in the fragment (Supabase's default)
   * No illustrative card and no «Fase 0»: the door says only true things.
   */

  import { docTitle } from '$lib/doc-title';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { chooseLocale, LOCALE_NAME, LOCALES, loadLocale, t, type Locale } from '$lib/i18n';
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

  /** After signing in: Hoy (ADR-137), unless `?next=` says where. */
  const HOME = '/h/desk';

  type Mode = 'signin' | 'signup' | 'recover' | 'reset';
  let mode = $derived.by<Mode>(() => {
    const m = page.url.searchParams.get('mode');
    return m === 'signup' || m === 'recover' || m === 'reset' ? m : 'signin';
  });
  let isSignup = $derived(mode === 'signup');

  let email = $state('');
  let password = $state('');
  let fullName = $state('');
  let submitting = $state(false);
  let errorMsg = $state('');
  let confirmationRequired = $state(false);
  /** recover: the request went out (the same answer for any address). */
  let recoverSent = $state(false);
  /** reset: what the mail's link carried. */
  let fragmentTokens = $state<{ access_token: string; refresh_token: string } | null>(null);
  let fragmentError = $state(false);
  let tokenHash = $derived(page.url.searchParams.get('token_hash'));
  let resetUsable = $derived(Boolean(tokenHash || fragmentTokens) && !fragmentError);

  let nextPath = $derived.by(() => {
    const candidate = page.url.searchParams.get('next');
    // Same-origin path only. Reject protocol-relative ('//host') AND
    // backslash-folded ('/\host', which URL parsers normalise to '//host')
    // so this stays safe even if the redirect ever moves off goto()'s
    // internal-navigation guard.
    return candidate && /^\/(?![/\\])/.test(candidate) ? candidate : HOME;
  });
  function modeHref(m: Mode): string {
    return `/login?${new URLSearchParams({
      ...(m === 'signin' ? {} : { mode: m }),
      ...(nextPath !== HOME ? { next: nextPath } : {}),
    }).toString()}`;
  }

  // The button waits for this (see the form's comment below).
  let hydrated = $state(false);

  onMount(async () => {
    hydrated = true;
    if (mode === 'reset') {
      // Supabase's default link leaves the session (or its error) in the
      // fragment. Read it once and take it off the address bar.
      const h = new URLSearchParams(location.hash.slice(1));
      if (h.get('error') || h.get('error_code')) fragmentError = true;
      const at = h.get('access_token');
      const rt = h.get('refresh_token');
      if (at && rt) fragmentTokens = { access_token: at, refresh_token: rt };
      if (location.hash) history.replaceState(history.state, '', location.pathname + location.search);
      // Someone already in who opens a reset link still sets the password.
      return;
    }
    // Already signed in (httpOnly cookie — only the server can tell).
    if (await ensureSession()) {
      goto(nextPath, { replaceState: true });
    }
  });

  function errorKey(error: string | undefined): string {
    if (error === 'rate_limited') return 'login.rate_limited';
    if (error === 'auth_unavailable') return 'login.auth_unavailable';
    if (error === 'link_expired') return 'login.link_expired';
    if (error === 'password_rejected') return 'login.password_rejected';
    return 'login.invalid_credentials';
  }

  async function post(url: string, body: unknown): Promise<Response> {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    errorMsg = '';
    submitting = true;

    try {
      if (mode === 'recover') {
        const res = await post('/api/auth/recover', { email });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(t(body.error === 'rate_limited' ? 'login.rate_limited' : 'login.auth_unavailable', locale));
        }
        recoverSent = true;
        submitting = false;
        return;
      }
      if (mode === 'reset') {
        const res = await post(
          '/api/auth/reset',
          tokenHash ? { token_hash: tokenHash, password } : { ...fragmentTokens, password },
        );
        const body = (await res.json().catch(() => ({}))) as { error?: string; user?: SessionUser | null };
        if (!res.ok) {
          if (body.error === 'link_expired') fragmentError = true;
          throw new Error(t(errorKey(body.error), locale));
        }
        await setSessionUser(body.user ?? null);
        goto(nextPath, { replaceState: true });
        return;
      }

      // Worker-mediated sign-in (Phase 0.9): the password grant runs
      // server-side and the session lands as httpOnly cookies — tokens
      // never touch JS or localStorage.
      const res = await post(
        isSignup ? '/api/auth/signup' : '/api/auth/login',
        isSignup ? { full_name: fullName, email, password } : { email, password },
      );

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          isSignup && body.error === 'signup_rejected'
            ? // Deliberately generic — do not confirm whether the address is
              // already registered (email-enumeration oracle). Point existing
              // users at sign-in without asserting the account exists.
              t('login.signup_rejected', locale)
            : t(errorKey(body.error), locale),
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
      // A dead network is not «wrong password» (tarea 132).
      errorMsg =
        err instanceof TypeError ? t('ui.no_connection', locale) : err instanceof Error ? err.message : t('login.invalid_credentials', locale);
      submitting = false;
    }
  }

  const KICKER: Record<Mode, string> = {
    signin: 'login.submit',
    signup: 'login.signup_kicker',
    recover: 'login.recover_kicker',
    reset: 'login.reset_kicker',
  };
  const TITLE: Record<Mode, [string, string]> = {
    signin: ['login.title_signin_a', 'login.title_signin_b'],
    signup: ['login.title_signup_a', 'login.title_signup_b'],
    recover: ['login.recover_title_a', 'login.recover_title_b'],
    reset: ['login.recover_title_a', 'login.recover_title_b'],
  };
  const SUB: Record<Mode, string> = {
    signin: 'login.sub_signin',
    signup: 'login.sub_signup',
    recover: 'login.recover_sub',
    reset: 'login.reset_sub',
  };
  let submitLabel = $derived(
    mode === 'recover'
      ? t(submitting ? 'login.recover_sending' : 'login.recover_submit', locale)
      : mode === 'reset'
        ? t(submitting ? 'login.reset_saving' : 'login.reset_submit', locale)
        : submitting
          ? t(isSignup ? 'login.creating' : 'login.signing_in', locale)
          : t(isSignup ? 'login.create' : 'login.submit', locale),
  );
</script>

<svelte:head>
  <title>{docTitle(t(KICKER[mode], locale))}</title>
</svelte:head>

<main class="login" lang={locale}>
  <section class="login__left">
    <header class="login__brand">
      <BrandMark size="m" />
    </header>

    <div class="login__center">
      <span class="eyebrow login__kicker">{t(KICKER[mode], locale)}</span>
      <h1 class="login__title">
        {t(TITLE[mode][0], locale)}
        <em>{t(TITLE[mode][1], locale)}</em>
      </h1>
      <p class="login__sub">{t(SUB[mode], locale)}</p>

      {#if mode === 'reset' && hydrated && !resetUsable}
        <!-- The link spent or expired: say so, and the way to another. -->
        <p class="login__error" role="alert">{t('login.link_expired', locale)}</p>
        <p class="login__alternate"><a href={modeHref('recover')}>{t('login.ask_again', locale)}</a></p>
      {:else if mode === 'recover' && recoverSent}
        <p class="login__notice" role="status">{t('login.recover_sent', locale, { email })}</p>
        <p class="login__alternate"><a href={modeHref('signin')}>{t('login.back_signin', locale)}</a></p>
      {:else}
        <!-- method="post" is the safety net, not the path: handleSubmit
             preventDefaults and posts JSON to /api/auth/*. But the button is
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
          {#if mode !== 'reset'}
            <label class="login__field">
              <span class="eyebrow login__label">{t('login.email', locale)}</span>
              <!-- svelte-ignore a11y_autofocus -->
              <input
                type="email"
                name="email"
                autocomplete="email"
                placeholder={t('login.email_placeholder', locale)}
                required
                autofocus={mode === 'signin' || mode === 'recover'}
                bind:value={email}
              />
            </label>
          {/if}

          {#if mode !== 'recover'}
            <!-- No placeholder: dots in an empty field read as a password
                 already typed (tarea 132). -->
            <label class="login__field">
              <span class="eyebrow login__label"
                >{t(mode === 'reset' ? 'login.reset_kicker' : 'login.password', locale)}</span
              >
              <!-- svelte-ignore a11y_autofocus -->
              <input
                type="password"
                name="password"
                autocomplete={isSignup || mode === 'reset' ? 'new-password' : 'current-password'}
                required
                autofocus={mode === 'reset'}
                minlength={isSignup || mode === 'reset' ? 10 : undefined}
                bind:value={password}
              />
            </label>
          {/if}

          {#if confirmationRequired}
            <p class="login__notice" role="status">
              {t('login.confirm_notice', locale, { email })}
            </p>
          {/if}

          {#if errorMsg}
            <p class="login__error" role="alert">{errorMsg}</p>
          {/if}

          <button class="btn--primary login__submit" type="submit" disabled={!hydrated || submitting}>
            <span>{submitLabel}</span>
            <span class="login__submit-arrow" aria-hidden="true">→</span>
          </button>
        </form>
        <p class="login__alternate">
          {#if mode === 'signin'}
            <a href={modeHref('recover')}>{t('login.forgot', locale)}</a>
          {:else if isSignup}
            {t('login.have_account', locale)}
            <a href={modeHref('signin')}>{t('login.submit', locale)}</a>
          {:else}
            <a href={modeHref('signin')}>{t('login.back_signin', locale)}</a>
          {/if}
        </p>
      {/if}
    </div>

    <footer class="login__foot">
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

    /* cut: the two columns need 26.25 + 27.5 rem (their minimums above) and
       a margin; under 55rem the quote panel goes and the form stands alone. */
    @media (max-width: 55rem) {
      .login {
        grid-template-columns: 1fr;
      }
      /* Over the panel's own `display: grid`, declared further down. */
      .login .login__right {
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
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
      margin-block: var(--space-m) 0;
      color: var(--text-faint);
      font-size: var(--text-s);
    }
    .login__alternate a {
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
      justify-content: flex-end;
      align-items: center;
      gap: var(--space-s);
      font-size: var(--text-xs);
      color: var(--text-faint);
      flex-wrap: wrap;
    }

    /* ── right: brand promise ── */

    .login__right {
      background: var(--bg-light);
      border-inline-start: var(--line-hairline) solid var(--border-color-light);
      padding: clamp(var(--space-l), 4vw, var(--space-xxl));
      display: grid;
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
  }
</style>
