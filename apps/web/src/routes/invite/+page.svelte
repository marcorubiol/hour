<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
  import { ensureSession } from '$lib/session.svelte';
  import { spaceName } from '$lib/utils/identity';
  import { appLocale, appLocaleTag, t } from '$lib/i18n';
  import { dayMonthLong } from '$lib/datetime';

  const locale = appLocale();
  const MEMBERSHIP_ROLES = new Set(['owner', 'admin', 'member', 'viewer', 'guest']);

  type Invitation = {
    workspace_id: string;
    workspace_slug: string;
    workspace_name: string;
    email: string;
    role: string;
    project_id: string | null;
    project_name: string | null;
    project_role_code: string | null;
    expires_at: string;
    /** Invitación de bolo (20261022100000): sala · ciudad, nunca dinero. */
    bolo_id?: string | null;
    bolo_label?: string | null;
    /** La función donde aterriza: la próxima viva, o la última si ya pasaron. */
    landing_performance_id?: string | null;
    /** 20261022150100: el día de esa función, el paquete y el último día de acceso. */
    landing_performed_at?: string | null;
    bolo_preset?: 'minim' | 'equip' | null;
    bolo_access_last_day?: string | null;
  };

  type LandingPerformance = { performance: { slug: string | null; performed_at: string } };

  let token = $state('');
  let invitation = $state<Invitation | null>(null);
  let loading = $state(true);
  let accepting = $state(false);
  let errorMessage = $state('');
  let landing = $state<LandingPerformance['performance'] | null>(null);
  let isBolo = $derived(Boolean(invitation?.bolo_id));

  function roleLabel(role: string): string {
    if (MEMBERSHIP_ROLES.has(role)) return t(`invite.role_${role}`, locale);
    return role.charAt(0).toUpperCase() + role.slice(1).replaceAll('_', ' ');
  }

  onMount(async () => {
    token = window.location.hash.slice(1);
    if (!token) {
      errorMessage = t('invite.err_incomplete', locale);
      loading = false;
      return;
    }

    if (!(await ensureSession())) {
      const next = `/invite#${token}`;
      await goto(`/login?${new URLSearchParams({ next }).toString()}`);
      return;
    }

    try {
      const response = await mutateJSON<{ invitation: Invitation }>(
        'POST',
        '/api/invitations',
        { token },
      );
      invitation = response?.invitation ?? null;
      if (!invitation) errorMessage = t('invite.err_gone', locale);
    } catch (error) {
      errorMessage =
        error instanceof ApiError && error.status === 404
          ? t('invite.err_expired', locale)
          : error instanceof Error
            ? error.message
            : t('invite.err_check', locale);
    } finally {
      loading = false;
    }
  });

  /**
   * Una invitación de bolo aterriza en su función, en el tablón: antes de
   * aceptar no se puede leer (por eso la vista previa solo da el id), y
   * después la ficha se lee por la cadena. Si no se encuentra, el espacio.
   */
  async function landingHref(workspaceSlug: string): Promise<string> {
    const id = invitation?.landing_performance_id;
    if (!id) return `/h/${workspaceSlug}`;
    try {
      const found = await fetchJSON<LandingPerformance>(`/api/performances/${encodeURIComponent(id)}`);
      landing = found?.performance ?? null;
      if (landing?.slug) return `/h/${workspaceSlug}/performance/${encodeURIComponent(landing.slug)}#board`;
    } catch {
      // Sin la ficha, el espacio: la invitación ya está aceptada.
    }
    return `/h/${workspaceSlug}`;
  }

  async function acceptInvitation() {
    if (!invitation || accepting) return;
    accepting = true;
    errorMessage = '';
    try {
      const response = await mutateJSON<{ invitation: Invitation }>(
        'PATCH',
        '/api/invitations',
        { token },
      );
      const accepted = response?.invitation;
      if (!accepted) throw new Error(t('invite.err_no_workspace', locale));
      history.replaceState(null, '', '/invite');
      await goto(await landingHref(accepted.workspace_slug), { replaceState: true });
    } catch (error) {
      errorMessage =
        error instanceof ApiError && error.status === 404
          ? t('invite.err_gone', locale)
          : error instanceof Error
            ? error.message
            : t('invite.err_accept', locale);
      accepting = false;
    }
  }
</script>

<svelte:head>
  <title>{t('invite.title', locale)}</title>
</svelte:head>

<main class="invitation-page">
  <header class="invitation-page__brand"><BrandMark size="m" /></header>

  <section class="invitation-card" aria-busy={loading}>
    <div class="invitation-card__rail" aria-hidden="true"></div>
    <p class="eyebrow invitation-card__kicker">{t('invite.kicker', locale)}</p>

    {#if loading}
      <h1>{t('invite.checking_a', locale)} <em>{t('invite.checking_b', locale)}</em></h1>
      <p class="invitation-card__lede">{t('invite.verifying', locale)}</p>
    {:else if invitation}
      <h1>{t('invite.join', locale)} <em>{spaceName(invitation.workspace_name)}.</em></h1>
      <p class="invitation-card__lede">
        {t('invite.addressed', locale, { email: invitation.email })}
      </p>

      <dl class="invitation-card__terms">
        <div>
          <dt>{t('invite.workspace_role', locale)}</dt>
          <dd>{roleLabel(invitation.role)}</dd>
        </div>
        {#if isBolo}
          <div>
            <dt>{t('invite.assigned_bolo', locale)}</dt>
            <dd>{invitation.bolo_label ?? t('invite.bolo_unnamed', locale)}</dd>
          </div>
          <div>
            <dt>{t('invite.bolo_landing', locale)}</dt>
            <dd>
              {invitation.landing_performed_at
                ? t('invite.bolo_landing_day', locale, { day: dayMonthLong(invitation.landing_performed_at, appLocaleTag()) })
                : t('invite.bolo_landing_space', locale)}
            </dd>
          </div>
          {#if invitation.bolo_preset}
            <div>
              <dt>{t('bolo_access.field_preset', locale)}</dt>
              <dd>{t(`bolo_access.preset_${invitation.bolo_preset}`, locale)}</dd>
            </div>
          {/if}
          <div>
            <dt>{t('invite.bolo_access_until', locale)}</dt>
            <dd>
              {invitation.bolo_access_last_day
                ? dayMonthLong(invitation.bolo_access_last_day, appLocaleTag())
                : t('invite.bolo_access_open', locale)}
            </dd>
          </div>
        {/if}
        {#if invitation.project_name}
          <div>
            <dt>{t('invite.assigned_project', locale)}</dt>
            <dd>{invitation.project_name}</dd>
          </div>
          <div>
            <dt>{t('invite.project_role', locale)}</dt>
            <dd>{roleLabel(invitation.project_role_code ?? '')}</dd>
          </div>
        {/if}
        <div>
          <dt>{isBolo ? t('invite.link_valid_until', locale) : t('invite.valid_until', locale)}</dt>
          <dd>{new Date(invitation.expires_at).toLocaleDateString(appLocaleTag())}</dd>
        </div>
      </dl>

      {#if errorMessage}<p class="invitation-card__error" role="alert">{errorMessage}</p>{/if}
      <button
        type="button"
        class="btn--primary invitation-card__accept"
        disabled={accepting}
        onclick={acceptInvitation}
      >
        <span>{accepting ? t('invite.joining', locale) : t('invite.accept', locale)}</span>
        <span aria-hidden="true">→</span>
      </button>
      <p class="invitation-card__fineprint">
        {isBolo ? t('invite.fineprint_bolo', locale) : t('invite.fineprint', locale)}
      </p>
    {:else}
      <h1>{t('invite.unavailable_a', locale)} <em>{t('invite.unavailable_b', locale)}</em></h1>
      <p class="invitation-card__lede">{errorMessage}</p>
      <a class="btn--secondary invitation-card__accept" href="/login">{t('invite.return', locale)}</a>
    {/if}
  </section>

  <footer class="invitation-page__foot">{t('invite.foot', locale)}</footer>
</main>

<style>
  @layer components {
    .invitation-page {
      min-block-size: 100dvh;
      display: grid;
      grid-template-rows: auto 1fr auto;
      padding: clamp(var(--space-l), 5vw, var(--space-xxl));
      background:
        linear-gradient(90deg, transparent 49.9%, var(--border-color-light) 50%, transparent 50.1%),
        var(--bg);
    }
    .invitation-page__brand { display: inline-flex; }
    .invitation-card {
      align-self: center;
      justify-self: center;
      position: relative;
      inline-size: min(100%, 42rem);
      padding: clamp(var(--space-l), 5vw, var(--space-xxl));
      border: var(--line-hairline) solid var(--border-color-dark);
      background: color-mix(in srgb, var(--bg) 94%, transparent);
      box-shadow: var(--box-shadow-4);
    }
    .invitation-card__rail {
      position: absolute;
      inset-block: -1px;
      inset-inline-start: -1px;
      inline-size: var(--dot-m);
      background: var(--accent-color);
    }
    .invitation-card__kicker { margin: 0 0 var(--space-m); }
    .invitation-card h1 {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--display-xl);
      font-weight: 400;
      line-height: 0.98;
      letter-spacing: var(--heading-letter-spacing);
      text-wrap: balance;
    }
    .invitation-card h1 em { color: var(--text-muted); font-weight: 400; }
    .invitation-card__lede {
      max-inline-size: 48ch;
      margin: var(--space-l) 0;
      color: var(--text-muted);
      line-height: 1.6;
    }
    .invitation-card__terms {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin: 0 0 var(--space-l);
      border-block-start: var(--line-hairline) solid var(--border-color-light);
    }
    .invitation-card__terms div {
      padding: var(--space-m) var(--space-m) var(--space-m) 0;
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }
    .invitation-card__terms dt {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-l);
      text-transform: uppercase;
      color: var(--text-faint);
    }
    .invitation-card__terms dd { margin: var(--space-xs) 0 0; }
    .invitation-card__accept { --btn-width: 100%; }
    .invitation-card__error { color: var(--danger); font-size: var(--text-s); }
    .invitation-card__fineprint {
      margin: var(--space-m) 0 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
      line-height: 1.5;
    }
    .invitation-page__foot {
      justify-self: center;
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-m);
    }
    @media (max-width: 34rem) {
      .invitation-page { background: var(--bg); }
      .invitation-card__terms { grid-template-columns: 1fr; }
    }
  }
</style>
