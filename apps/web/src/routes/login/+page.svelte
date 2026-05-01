<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n';
  import { env } from '$env/dynamic/public';

  type SupabaseAuthOk = {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  type SupabaseAuthErr = { error_description?: string; msg?: string };

  let email = $state('');
  let password = $state('');
  let submitting = $state(false);
  let errorMsg = $state('');

  onMount(() => {
    if (localStorage.getItem('hour_jwt')) {
      goto('/booking', { replaceState: true });
    }
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    errorMsg = '';
    submitting = true;

    const supabaseUrl = env.PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = env.PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      errorMsg = 'Missing PUBLIC_SUPABASE_* env. Check wrangler.toml [vars].';
      submitting = false;
      return;
    }

    try {
      const res = await fetch(
        `${supabaseUrl}/auth/v1/token?grant_type=password`,
        {
          method: 'POST',
          headers: {
            apikey: supabaseAnonKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, password }),
        },
      );

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as SupabaseAuthErr;
        throw new Error(
          body.error_description || body.msg || t('login.invalid_credentials'),
        );
      }

      const data = (await res.json()) as SupabaseAuthOk;
      localStorage.setItem('hour_jwt', data.access_token);
      localStorage.setItem('hour_refresh', data.refresh_token);
      localStorage.setItem(
        'hour_expires_at',
        String(Date.now() + data.expires_in * 1000),
      );

      goto('/booking', { replaceState: true });
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
  <div class="login__card">
    <h1 class="h2">{t('app.name')}</h1>
    <p class="text--s text--dark-muted login__subtitle">{t('login.phase')}</p>

    <form class="form" onsubmit={handleSubmit}>
      <div>
        <label for="email">{t('login.email')}</label>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="email"
          id="email"
          name="email"
          required
          autocomplete="email"
          autofocus
          bind:value={email}
        />
      </div>

      <div>
        <label for="password">{t('login.password')}</label>
        <input
          type="password"
          id="password"
          name="password"
          required
          autocomplete="current-password"
          bind:value={password}
        />
      </div>

      {#if errorMsg}
        <p class="login__error login__error--visible" role="alert">{errorMsg}</p>
      {:else}
        <p class="login__error"></p>
      {/if}

      <button
        class="btn--primary login__submit"
        type="submit"
        disabled={submitting}
      >
        {submitting ? t('login.signing_in') : t('login.submit')}
      </button>
    </form>
  </div>
</main>

<style>
  @layer components {
    .login {
      min-block-size: 100dvh;
      display: grid;
      place-items: center;
    }

    .login__card {
      inline-size: 100%;
      max-inline-size: 22rem;
    }

    .login__subtitle {
      margin-block-end: var(--space-xl);
    }

    .login__error {
      color: var(--danger-dark);
      font-size: var(--text-s);
      min-block-size: var(--text-s);
      display: none;
    }
    .login__error--visible {
      display: block;
    }

    .login__submit {
      --btn-width: 100%;
      margin-block-start: var(--space-xs);
    }
  }
</style>
