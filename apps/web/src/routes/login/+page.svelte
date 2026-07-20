<script lang="ts">
  /**
   * Sign-in page — editorial split layout (design system v0.5, ADR-033).
   *
   * Left column carries the form, right column carries brand promise + a
   * static "this week" preview card. The preview is hardcoded — it's
   * illustrative (the design says "v0.4 prototype") and shouldn't carry the
   * cost of fetching real conversations before auth.
   */

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { t } from '$lib/i18n';
  import { resolveLoginTarget } from '$lib/master-view';
  import { ensureSession, setSessionUser, type SessionUser } from '$lib/session.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';

  let email = $state('');
  let password = $state('');
  let fullName = $state('');
  let submitting = $state(false);
  let errorMsg = $state('');
  let confirmationRequired = $state(false);
  let isSignup = $derived(page.url.searchParams.get('mode') === 'signup');
  let nextPath = $derived.by(() => {
    const candidate = page.url.searchParams.get('next');
    return candidate?.startsWith('/') && !candidate.startsWith('//')
      ? candidate
      : resolveLoginTarget();
  });
  let alternateHref = $derived(
    `/login?${new URLSearchParams({
      ...(isSignup ? {} : { mode: 'signup' }),
      ...(nextPath !== resolveLoginTarget() ? { next: nextPath } : {}),
    }).toString()}`,
  );

  onMount(async () => {
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
            ? 'This account could not be created. It may already exist.'
            : t(key),
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
      setSessionUser(data.user ?? null);

      goto(nextPath, { replaceState: true });
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : t('login.invalid_credentials');
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>{t('app.name')} — {t('login.submit')}</title>
</svelte:head>

<main class="login">
  <section class="login__left">
    <header class="login__brand">
      <BrandMark size="m" />
    </header>

    <div class="login__center">
      <span class="eyebrow login__kicker">{isSignup ? 'Create account' : t('login.submit')}</span>
      <h1 class="login__title">
        {isSignup ? 'Join the' : 'Hello'} <em>{isSignup ? 'company.' : 'again.'}</em>
      </h1>
      <p class="login__sub">
        {isSignup
          ? 'Create your private Hour identity, then review and accept the invitation.'
          : 'Your projects, contacts, shows and money — held together, one hour at a time.'}
      </p>

      <!-- method="post" is the safety net, not the path: handleSubmit
           preventDefaults and posts JSON to /api/auth/login. But the button is
           live in the SSR'd HTML before hydration, and a submit in that window
           runs the browser's native default — which without this attribute is
           GET, i.e. the password lands in the query string (history, access
           logs, Referer). POST keeps it in the body; the route has no form
           action, so it dead-ends at 405 instead of leaking. -->
      <form class="login__form" method="post" onsubmit={handleSubmit}>
        {#if isSignup}
          <label class="login__field">
            <span class="eyebrow login__label">Full name</span>
            <input
              type="text"
              name="full_name"
              autocomplete="name"
              placeholder="Your name"
              required
              minlength="2"
              bind:value={fullName}
            />
          </label>
        {/if}
        <label class="login__field">
          <span class="eyebrow login__label">{t('login.email')}</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            
            type="email"
            name="email"
            autocomplete="email"
            placeholder="you@somewhere.com"
            required
            autofocus={!isSignup}
            bind:value={email}
          />
        </label>

        <label class="login__field">
          <span class="eyebrow login__label">{t('login.password')}</span>
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
            Check {email} to confirm the account. Then reopen this invitation and sign in.
          </p>
        {/if}

        {#if errorMsg}
          <p class="login__error" role="alert">{errorMsg}</p>
        {/if}

        <button class="btn--primary login__submit" type="submit" disabled={submitting}>
          <span>
            {submitting
              ? isSignup
                ? 'Creating account…'
                : t('login.signing_in')
              : isSignup
                ? 'Create account'
                : t('login.submit')}
          </span>
          <span class="login__submit-arrow" aria-hidden="true">→</span>
        </button>
      </form>
      <p class="login__alternate">
        {isSignup ? 'Already have an account?' : 'Joining through an invitation?'}
        <a href={alternateHref}>{isSignup ? 'Sign in' : 'Create one'}</a>
      </p>
    </div>

    <footer class="login__foot">
      <span>{t('login.phase')}</span>
    </footer>
  </section>

  <aside class="login__right" aria-hidden="true">
    <div class="login__quote">
      <div class="login__quote-kicker">
        For freelance artists who wear too many hats
      </div>
      <p class="login__quote-text">
        One inbox can't hold a tour, a band, a song, a residency, and a press kit
        at the same time. <em>So we made one that can.</em>
      </p>
      <div class="login__quote-attr">— Hour, Phase 0 · internal</div>
    </div>

    <div class="login__preview">
      <div class="login__preview-head">
        <span class="login__preview-dot" style="background: var(--accent-1)"></span>
        <span class="login__preview-name">This week</span>
        <span class="login__preview-day">Mon · 18 May</span>
      </div>
      <div class="login__preview-item">
        <span class="login__preview-kind">task</span>
        <span class="login__preview-verb">Confirm</span>
        <span class="login__preview-subj">hotel block · Igualada</span>
        <span class="login__preview-proj">mamemi</span>
      </div>
      <div class="login__preview-item">
        <span class="login__preview-kind login__preview-kind--wait">waiting 4d</span>
        <span class="login__preview-verb">Ruth Schmidli</span>
        <span class="login__preview-subj">Gessnerallee fee</span>
        <span class="login__preview-proj">mamemi</span>
      </div>
      <div class="login__preview-item">
        <span class="login__preview-kind login__preview-kind--event">event</span>
        <span class="login__preview-verb">Mix</span>
        <span class="login__preview-subj">Tamarit · session 3/5 · 10h</span>
        <span class="login__preview-proj">marco rubiol</span>
      </div>
      <div class="login__preview-item">
        <span class="login__preview-kind login__preview-kind--money">money</span>
        <span class="login__preview-verb">Chase</span>
        <span class="login__preview-subj">Aarhus residency · €1,800</span>
        <span class="login__preview-proj">marco rubiol</span>
      </div>
    </div>
  </aside>
</main>

<style>
  @layer components {
    .login {
      display: grid;
      grid-template-columns: minmax(420px, 1fr) minmax(440px, 1.1fr);
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
      max-inline-size: 360px;
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
      font-size: clamp(2.2rem, 4vw, 2.8rem);
      font-weight: 400;
      letter-spacing: -0.025em;
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
      border-inline-start: 2px solid var(--accent-color);
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
      border-inline-start: 1px solid var(--border-color-light);
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
      inset-block-start: -40px;
      inset-inline-end: -40px;
      inline-size: 220px;
      block-size: 220px;
      border: 1px solid var(--border-color-dark);
      transform: rotate(45deg);
      opacity: 0.45;
    }

    .login__quote {
      align-self: center;
      max-inline-size: 480px;
      position: relative;
    }

    .login__quote-kicker {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-faint);
      margin-block-end: var(--space-m);
    }

    .login__quote-text {
      font-family: var(--font-display);
      font-size: clamp(1.6rem, 2.4vw, 2.1rem);
      font-weight: 400;
      letter-spacing: -0.015em;
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
      letter-spacing: 0.04em;
    }

    .login__preview {
      background: var(--bg-ultra-light);
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-l);
      padding: var(--space-m) var(--space-l);
      box-shadow: var(--box-shadow-2);
      max-inline-size: 440px;
    }

    .login__preview-head {
      display: flex;
      align-items: center;
      gap: var(--space-s);
      margin-block-end: var(--space-m);
      padding-block-end: var(--space-s);
      border-block-end: 1px solid var(--border-color-light);
    }

    .login__preview-dot {
      inline-size: 8px;
      block-size: 8px;
      border-radius: 50%;
    }

    .login__preview-name {
      font-family: var(--font-display);
      font-size: var(--text-m);
      font-weight: 500;
      letter-spacing: -0.01em;
      color: var(--text-color);
    }

    .login__preview-day {
      margin-inline-start: auto;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-faint);
    }

    .login__preview-item {
      display: grid;
      grid-template-columns: 64px auto minmax(0, 1fr) auto;
      gap: var(--space-s);
      align-items: baseline;
      padding-block: var(--space-xs);
      font-size: var(--text-xs);
    }
    .login__preview-item + .login__preview-item {
      border-block-start: 1px solid var(--border-color-light);
    }

    .login__preview-kind {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
      letter-spacing: 0.04em;
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
      letter-spacing: 0.04em;
    }
  }
</style>
