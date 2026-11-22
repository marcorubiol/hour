<script lang="ts">
  /**
   * Ajustes › Calendario (ADR-241 Fases 1-5).
   *
   * Una sola pantalla:
   *   · Botones principales: «Conectar Apple Calendar» (modal guiado en 2 pasos)
   *     y «Conectar Google Calendar» (OAuth propio separado de Buzones).
   *   · Debajo de cada cuenta conectada: estado en una línea («Al día · …» o
   *     «En pausa · Reconectar»), «Sincronizar ahora» y «Desconectar».
   *   · Plegado (`<details>`): qué calendarios cuentan como ocupado (Fase 3),
   *     qué espacios entran («Lo mío · Todo · Nada») y el enlace de suscripción
   *     personal `.ics` de 1 clic (Fase 1, también para Outlook o sin contraseña).
   */

  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import RecordHead from '$lib/components/RecordHead.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import Button from '$lib/components/Button.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import SavedMark from '$lib/components/SavedMark.svelte';
  import Segmented from '$lib/components/Segmented.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
  import { copyText } from '$lib/clipboard';
  import { dayMonthYear, dayMonthYearTs } from '$lib/datetime';
  import { appLocale, t } from '$lib/i18n';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { SaveFlash } from '$lib/save-flash.svelte';
  import { spaceName } from '$lib/utils/identity';
  import { viewScopeOf } from '$lib/view-scope';
  import type { CalendarAlarmMode } from '$lib/calendar-events';
  import {
    calendarScopeIsDefault,
    effectiveCalendarScope,
    type CalendarScope,
    type PersonalCalendarFeedItem,
  } from '$lib/personal-calendar';
  import type { NavWorkspace } from '$lib/nav';

  interface RemoteCalendar {
    id: string;
    name: string;
    color?: string | null;
    primary?: boolean;
  }

  interface CalendarConnectionItem {
    id: string;
    provider: 'icloud' | 'google';
    account_email: string;
    hour_calendar_id: string | null;
    busy_calendar_ids: string[];
    available_calendars: RemoteCalendar[];
    alarm_mode: CalendarAlarmMode;
    status: 'ok' | 'paused';
    dirty: boolean;
    last_synced_at: string | null;
    last_error: string | null;
    created_at: string;
  }

  interface ConnectionsResponse {
    items: CalendarConnectionItem[];
    configured: { icloud: boolean; google: boolean };
  }

  const locale = appLocale();
  const queryClient = useQueryClient();
  const saved = new SaveFlash();

  const connectionsQuery = createQuery({
    queryKey: ['calendar-connections'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<ConnectionsResponse>('/api/calendar/connections', signal),
  });

  const feedQuery = createQuery({
    queryKey: ['my-calendar-feed'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ feed: PersonalCalendarFeedItem | null }>('/api/me/calendar-feed', signal),
  });

  const workspacesQuery = createQuery(workspacesQueryOptions());

  let connections = $derived<CalendarConnectionItem[]>($connectionsQuery.data?.items ?? []);
  let icloudConn = $derived(connections.find((c) => c.provider === 'icloud') ?? null);
  let googleConn = $derived(connections.find((c) => c.provider === 'google') ?? null);
  let configured = $derived($connectionsQuery.data?.configured ?? { icloud: true, google: true });
  let feed = $derived<PersonalCalendarFeedItem | null>($feedQuery.data?.feed ?? null);
  let workspaces = $derived<NavWorkspace[]>($workspacesQuery.data?.items ?? []);

  // Apple guided modal state
  let appleOpen = $state(false);
  let appleId = $state('');
  let applePassword = $state('');
  let appleAlarm = $state<CalendarAlarmMode>('none');
  let appleError = $state<string | null>(null);

  // Confirm dialogs
  let disconnectTarget = $state<CalendarConnectionItem | null>(null);
  let confirmRevoke = $state(false);
  let confirmRenew = $state(false);
  let pendingFeedAlarm = $state<CalendarAlarmMode>('none');
  let activeFeedAlarm = $derived<CalendarAlarmMode>(feed ? feed.alarm_mode : pendingFeedAlarm);

  function invalidateConnections() {
    void queryClient.invalidateQueries({ queryKey: ['calendar-connections'] });
    void queryClient.invalidateQueries({ queryKey: ['calendar-waiting'] });
  }

  function openAppleModal(prefillEmail?: string, prefillAlarm?: CalendarAlarmMode) {
    appleId = prefillEmail ?? icloudConn?.account_email ?? '';
    applePassword = '';
    appleAlarm = prefillAlarm ?? icloudConn?.alarm_mode ?? 'none';
    appleError = null;
    appleOpen = true;
  }

  function connectGoogle() {
    const back = `${page.url.pathname}?section=calendar`;
    const u = new URL('/api/calendar/oauth/google/start', page.url.origin);
    u.searchParams.set('alarm_mode', googleConn?.alarm_mode ?? 'none');
    u.searchParams.set('return', back);
    window.location.assign(u.toString());
  }

  // Handle Google Calendar OAuth return (`?cal=finish` or `?cal=error`)
  onMount(async () => {
    const cal = page.url.searchParams.get('cal');
    if (!cal) return;
    const clean = new URL(page.url);
    clean.searchParams.delete('cal');
    const reason = clean.searchParams.get('reason');
    clean.searchParams.delete('reason');
    if (cal === 'finish') {
      try {
        const r = await mutateJSON<{ account_email: string }>('POST', '/api/calendar/oauth/google/finish');
        addToast({
          tone: 'success',
          title: t('calendar.connect_google', locale),
          message: t('calendar.connected_toast', locale, { email: r?.account_email ?? '' }),
        });
      } catch (err) {
        addToast({
          tone: 'danger',
          title: t('calendar.action_failed', locale),
          message: err instanceof Error ? err.message : String(err),
        });
      }
      invalidateConnections();
    } else if (cal === 'error') {
      addToast({
        tone: 'danger',
        title: t('calendar.action_failed', locale),
        message: reason ?? '',
      });
    }
    void goto(clean, { replaceState: true, noScroll: true, keepFocus: true });
  });

  const connectApple = createMutation({
    mutationFn: () =>
      mutateJSON<{ account_email: string }>('POST', '/api/calendar/connections', {
        provider: 'icloud',
        apple_id: appleId.trim(),
        app_password: applePassword.trim(),
        alarm_mode: appleAlarm,
      }),
    onSuccess: (r) => {
      appleOpen = false;
      applePassword = '';
      appleError = null;
      addToast({
        tone: 'success',
        title: t('calendar.connect_apple', locale),
        message: t('calendar.connected_toast', locale, { email: r?.account_email ?? '' }),
      });
      invalidateConnections();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.body?.error === 'icloud_auth_failed') {
        appleError = t('calendar.apple_auth_error', locale);
      } else {
        appleError = err instanceof Error ? err.message : String(err);
      }
    },
  });

  const patchConn = createMutation({
    mutationFn: (vars: { id: string; alarm_mode?: CalendarAlarmMode; busy_calendar_ids?: string[] }) =>
      mutateJSON('PATCH', `/api/calendar/connections/${vars.id}`, {
        ...(vars.alarm_mode !== undefined ? { alarm_mode: vars.alarm_mode } : {}),
        ...(vars.busy_calendar_ids !== undefined ? { busy_calendar_ids: vars.busy_calendar_ids } : {}),
      }),
    onSuccess: (_d, vars) => {
      saved.show(`conn-${vars.id}`);
      invalidateConnections();
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('calendar.action_failed', locale),
        message: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const syncConn = createMutation({
    mutationFn: (id: string) =>
      mutateJSON<{ status?: string; error?: string | null }>('POST', `/api/calendar/connections/${id}/sync`),
    onSuccess: (r) => {
      addToast({
        tone: r?.error ? 'warning' : 'success',
        message: r?.error ? t('calendar.sync_error', locale) : t('calendar.synced_toast', locale),
      });
      invalidateConnections();
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('calendar.action_failed', locale),
        message: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const disconnectConn = createMutation({
    mutationFn: (id: string) => mutateJSON('DELETE', `/api/calendar/connections/${id}`),
    onSuccess: () => {
      addToast({ tone: 'success', message: t('calendar.disconnected_toast', locale) });
      invalidateConnections();
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('calendar.action_failed', locale),
        message: err instanceof Error ? err.message : String(err),
      });
    },
  });

  function toggleBusyCalendar(conn: CalendarConnectionItem, calId: string) {
    const current = conn.busy_calendar_ids ?? [];
    const next = current.includes(calId) ? current.filter((id) => id !== calId) : [...current, calId];
    $patchConn.mutate({ id: conn.id, busy_calendar_ids: next });
  }

  function statusLine(c: CalendarConnectionItem): string {
    if (c.status === 'paused') return t('calendar.status_paused', locale);
    if (!c.last_synced_at) return t('calendar.status_syncing', locale);
    return t('calendar.status_synced', locale, { when: dayMonthYearTs(c.last_synced_at) });
  }

  // Phase 1 .ics feed mutations
  function feedUrl(token: string, scheme: 'https' | 'webcal' = 'https'): string {
    const base = `${location.origin}/api/public/my-calendar/${token}?lang=${encodeURIComponent(locale)}`;
    return scheme === 'webcal' ? base.replace(/^https?:/, 'webcal:') : base;
  }

  async function copyFeedUrl(token: string, scheme: 'https' | 'webcal') {
    const ok = await copyText(feedUrl(token, scheme));
    addToast(
      ok
        ? { tone: 'success', message: t('planner.feed_copied', locale, { scheme }) }
        : { tone: 'danger', message: t('planner.feed_copy_error', locale) },
    );
  }

  const createFeed = createMutation({
    mutationFn: (alarm_mode: CalendarAlarmMode) =>
      mutateJSON<{ feed: PersonalCalendarFeedItem }>('POST', '/api/me/calendar-feed', { alarm_mode }),
    onSuccess: (res) => {
      if (res?.feed) queryClient.setQueryData(['my-calendar-feed'], { feed: res.feed });
      void queryClient.invalidateQueries({ queryKey: ['my-calendar-feed'] });
      addToast({ tone: 'success', message: t('calendar.feed_created', locale) });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('calendar.action_failed', locale),
        message: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const updateFeedAlarm = createMutation({
    mutationFn: (alarm_mode: CalendarAlarmMode) =>
      mutateJSON<{ feed: PersonalCalendarFeedItem }>('PATCH', '/api/me/calendar-feed', { alarm_mode }),
    onSuccess: (res) => {
      if (res?.feed) queryClient.setQueryData(['my-calendar-feed'], { feed: res.feed });
      saved.show('alarm');
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('calendar.action_failed', locale),
        message: err instanceof Error ? err.message : String(err),
      });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['my-calendar-feed'] }),
  });

  const revokeFeed = createMutation({
    mutationFn: () => mutateJSON('DELETE', '/api/me/calendar-feed'),
    onSuccess: () => {
      queryClient.setQueryData(['my-calendar-feed'], { feed: null });
      void queryClient.invalidateQueries({ queryKey: ['my-calendar-feed'] });
      addToast({ tone: 'success', message: t('calendar.feed_revoked', locale) });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('calendar.action_failed', locale),
        message: err instanceof Error ? err.message : String(err),
      });
    },
  });

  type ScopeVars = { id: string; scope: CalendarScope | null };
  const saveScope = createMutation({
    mutationFn: ({ id, scope }: ScopeVars) =>
      mutateJSON('PUT', '/api/me/calendar-scope', { workspace_id: id, calendar_scope: scope }),
    onMutate: async ({ id, scope }: ScopeVars) => {
      await queryClient.cancelQueries({ queryKey: ['workspaces'] });
      const before = queryClient.getQueriesData<{ items: NavWorkspace[] }>({ queryKey: ['workspaces'] });
      for (const [key, data] of before) {
        if (!data) continue;
        queryClient.setQueryData(key, {
          ...data,
          items: data.items.map((w) => (w.id === id ? { ...w, calendar_scope: scope } : w)),
        });
      }
      return { before };
    },
    onSuccess: (_d, { id }) => saved.show(id),
    onError: (err, _v, ctx) => {
      for (const [key, data] of ctx?.before ?? []) queryClient.setQueryData(key, data);
      addToast({
        tone: 'danger',
        title: t('calendar.action_failed', locale),
        message: err instanceof Error ? err.message : String(err),
      });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
  });

  function chooseFeedAlarm(mode: CalendarAlarmMode) {
    pendingFeedAlarm = mode;
    if (feed) $updateFeedAlarm.mutate(mode);
  }

  function chooseScope(w: NavWorkspace, scope: CalendarScope) {
    const inherited = viewScopeOf(w);
    $saveScope.mutate({ id: w.id, scope: scope === inherited ? null : scope });
  }

  const alarmOptions = () => [
    { value: 'none' as CalendarAlarmMode, label: t('calendar.alarm_none', locale) },
    { value: 'day_before' as CalendarAlarmMode, label: t('calendar.alarm_day_before', locale) },
    { value: '2h_before' as CalendarAlarmMode, label: t('calendar.alarm_2h_before', locale) },
  ];

  const scopeOptions = () => [
    { value: 'mine' as CalendarScope, label: t('settings.view_scope_mine', locale) },
    { value: 'all' as CalendarScope, label: t('settings.view_scope_all', locale) },
    { value: 'none' as CalendarScope, label: t('calendar.scope_none', locale) },
  ];
</script>

<RecordHead crumbs={[{ label: t('settings.title', locale) }]} title={t('settings.nav_calendar', locale)}>
  {#snippet facts()}<span>{t('calendar.sub', locale)}</span>{/snippet}
</RecordHead>

<section class="set-group" data-testid="calendar-connections">
  <BlockHead title={t('calendar.sync_kicker', locale)} />
  <div class="set-group__body">
    <p class="set-row__hint cal-spaces__lead">{t('calendar.sync_lead', locale)}</p>

    <!-- Apple Calendar (iCloud CalDAV) -->
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('calendar.provider_apple', locale)}</div>
        <div class="set-row__hint">{t('calendar.provider_apple_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl cal-ctrl">
        {#if icloudConn}
          <div class="cal-actions">
            {#if icloudConn.status === 'paused'}
              <Button variant="primary" size="xs" onclick={() => openAppleModal(icloudConn.account_email, icloudConn.alarm_mode)}>
                {t('calendar.reconnect', locale)}
              </Button>
            {:else}
              <Button variant="secondary" size="xs" onclick={() => $syncConn.mutate(icloudConn.id)} disabled={$syncConn.isPending}>
                {t('calendar.sync_now', locale)}
              </Button>
            {/if}
            <Button variant="quiet" size="xs" tone="warn" onclick={() => (disconnectTarget = icloudConn)}>
              {t('calendar.disconnect', locale)}
            </Button>
          </div>
          <p class="cal-status" class:cal-status--warn={icloudConn.status === 'paused'}>
            {icloudConn.account_email} · {statusLine(icloudConn)}
          </p>
          <div class="cal-inline-alarm">
            <Segmented
              ariaLabel={t('calendar.alarm_label', locale)}
              options={alarmOptions()}
              value={icloudConn.alarm_mode}
              disabled={$patchConn.isPending}
              onchange={(mode) => $patchConn.mutate({ id: icloudConn.id, alarm_mode: mode })}
            />
            <SavedMark shown={saved.is(`conn-${icloudConn.id}`)} />
          </div>
        {:else}
          <div class="cal-actions">
            <Button variant="primary" onclick={() => openAppleModal()} disabled={!configured.icloud}>
              {t('calendar.connect_apple', locale)}
            </Button>
          </div>
        {/if}
      </div>
    </div>

    <!-- Google Calendar (API v3 OAuth) -->
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('calendar.provider_google', locale)}</div>
        <div class="set-row__hint">{t('calendar.provider_google_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl cal-ctrl">
        {#if googleConn}
          <div class="cal-actions">
            {#if googleConn.status === 'paused'}
              <Button variant="primary" size="xs" onclick={connectGoogle}>
                {t('calendar.reconnect', locale)}
              </Button>
            {:else}
              <Button variant="secondary" size="xs" onclick={() => $syncConn.mutate(googleConn.id)} disabled={$syncConn.isPending}>
                {t('calendar.sync_now', locale)}
              </Button>
            {/if}
            <Button variant="quiet" size="xs" tone="warn" onclick={() => (disconnectTarget = googleConn)}>
              {t('calendar.disconnect', locale)}
            </Button>
          </div>
          <p class="cal-status" class:cal-status--warn={googleConn.status === 'paused'}>
            {googleConn.account_email} · {statusLine(googleConn)}
          </p>
          <div class="cal-inline-alarm">
            <Segmented
              ariaLabel={t('calendar.alarm_label', locale)}
              options={alarmOptions()}
              value={googleConn.alarm_mode}
              disabled={$patchConn.isPending}
              onchange={(mode) => $patchConn.mutate({ id: googleConn.id, alarm_mode: mode })}
            />
            <SavedMark shown={saved.is(`conn-${googleConn.id}`)} />
          </div>
        {:else}
          <div class="cal-actions">
            <Button variant="secondary" onclick={connectGoogle} disabled={!configured.google}>
              {t('calendar.connect_google', locale)}
            </Button>
          </div>
        {/if}
      </div>
    </div>
  </div>
</section>

<!-- Folded: which external calendars count as busy (Fase 3) -->
{#if connections.some((c) => c.available_calendars.length > 0)}
  <section class="set-group" data-testid="calendar-busy-picker">
    <details class="cal-fold">
      <summary class="cal-fold__summary">{t('calendar.busy_summary', locale)}</summary>
      <div class="set-group__body">
        <p class="set-row__hint cal-spaces__lead">{t('calendar.busy_lead', locale)}</p>
        {#each connections as conn (conn.id)}
          {#if conn.available_calendars.length > 0}
            <div class="set-row">
              <div class="set-row__lead">
                <div class="set-row__label">
                  {conn.provider === 'icloud' ? t('calendar.provider_apple', locale) : t('calendar.provider_google', locale)}
                </div>
                <div class="set-row__hint">{conn.account_email}</div>
              </div>
              <div class="set-row__ctrl cal-ctrl">
                {#each conn.available_calendars as cal (cal.id)}
                  <label class="cal-check">
                    <input
                      type="checkbox"
                      checked={conn.busy_calendar_ids.includes(cal.id)}
                      disabled={$patchConn.isPending}
                      onchange={() => toggleBusyCalendar(conn, cal.id)}
                    />
                    <span>{cal.name}</span>
                  </label>
                {/each}
              </div>
            </div>
          {/if}
        {/each}
      </div>
    </details>
  </section>
{/if}

<!-- Folded: which workspaces enter the calendar -->
{#if workspaces.length > 0}
  <section class="set-group" data-testid="calendar-spaces">
    <details class="cal-fold">
      <summary class="cal-fold__summary">{t('calendar.spaces_summary', locale)}</summary>
      <div class="set-group__body">
        <p class="set-row__hint cal-spaces__lead">{t('calendar.spaces_lead', locale)}</p>
        {#each workspaces as w (w.id)}
          <div class="set-row">
            <div class="set-row__lead">
              <div class="set-row__label">{spaceName(w.name)}</div>
              {#if calendarScopeIsDefault(w)}
                <div class="set-row__hint">{t('calendar.scope_default', locale)}</div>
              {/if}
            </div>
            <div class="set-row__ctrl">
              <Segmented
                ariaLabel={t('calendar.scope_aria', locale, { space: spaceName(w.name) })}
                options={scopeOptions()}
                value={effectiveCalendarScope(w)}
                disabled={$saveScope.isPending}
                onchange={(scope) => chooseScope(w, scope)}
              />
              <SavedMark shown={saved.is(w.id)} />
            </div>
          </div>
        {/each}
      </div>
    </details>
  </section>
{/if}

<!-- Folded (or primary fallback): 1-click personal .ics subscription (Fase 1) -->
<section class="set-group" data-testid="personal-calendar-feed">
  <details class="cal-fold" open={connections.length === 0}>
    <summary class="cal-fold__summary">{t('calendar.subscription_kicker', locale)}</summary>
    <div class="set-group__body">
      <div class="set-row">
        <div class="set-row__lead">
          <div class="set-row__label">{t('calendar.feed_label', locale)}</div>
          <div class="set-row__hint">{t('calendar.feed_hint', locale)}</div>
        </div>
        <div class="set-row__ctrl cal-ctrl">
          {#if $feedQuery.isPending}
            <span class="cal-status">{t('calendar.loading', locale)}</span>
          {:else if feed}
            <div class="cal-actions">
              <a class="cal-open" href={feedUrl(feed.token, 'webcal')}>{t('calendar.open_in_app', locale)}</a>
              <Button variant="secondary" size="xs" onclick={() => copyFeedUrl(feed.token, 'https')}>
                {t('calendar.copy_link', locale)}
              </Button>
              <Button variant="quiet" size="xs" onclick={() => (confirmRenew = true)} disabled={$createFeed.isPending}>
                {t('calendar.renew_link', locale)}
              </Button>
              <Button
                variant="quiet"
                size="xs"
                tone="warn"
                onclick={() => (confirmRevoke = true)}
                disabled={$revokeFeed.isPending}
              >
                {t('calendar.revoke_link', locale)}
              </Button>
            </div>
            <p class="cal-status">
              {t('calendar.status_active', locale, { date: dayMonthYear(feed.expires_at) })}
            </p>
          {:else}
            <div class="cal-actions">
              <Button
                variant="secondary"
                onclick={() => $createFeed.mutate(pendingFeedAlarm)}
                disabled={$createFeed.isPending}
              >
                {t('calendar.create_link', locale)}
              </Button>
            </div>
            <p class="cal-status">{t('calendar.status_inactive', locale)}</p>
          {/if}
        </div>
      </div>

      <div class="set-row">
        <div class="set-row__lead">
          <div class="set-row__label">{t('calendar.alarm_label', locale)}</div>
          <div class="set-row__hint">{t('calendar.alarm_hint', locale)}</div>
        </div>
        <div class="set-row__ctrl">
          <Segmented
            ariaLabel={t('calendar.alarm_label', locale)}
            options={alarmOptions()}
            value={activeFeedAlarm}
            disabled={$updateFeedAlarm.isPending || $createFeed.isPending}
            onchange={chooseFeedAlarm}
          />
          <SavedMark shown={saved.is('alarm')} />
        </div>
      </div>
    </div>
  </details>
</section>

<!-- Guided 2-step Apple Calendar dialog -->
<Dialog bind:open={appleOpen} title={t('calendar.connect_apple', locale)} size="m">
  <div class="cal-modal">
    <p class="cal-modal__note">{t('calendar.apple_modal_intro', locale)}</p>

    <ol class="cal-steps">
      <li>
        {t('calendar.apple_step_1', locale)}
        <a
          class="cal-steps__link"
          href="https://account.apple.com/account/manage/section/security"
          target="_blank"
          rel="noopener noreferrer">{t('calendar.apple_open_account', locale)} ↗</a
        >
      </li>
      <li>{t('calendar.apple_step_2', locale)}</li>
      <li>{t('calendar.apple_step_3', locale)}</li>
    </ol>

    <label class="cal-field">
      <span class="cal-field__label">{t('calendar.apple_id_label', locale)}</span>
      <input
        type="email"
        class="cal-input"
        bind:value={appleId}
        placeholder="tu@icloud.com"
        autocomplete="email"
      />
    </label>

    <label class="cal-field">
      <span class="cal-field__label">{t('calendar.apple_password_label', locale)}</span>
      <input
        type="password"
        class="cal-input"
        bind:value={applePassword}
        placeholder="xxxx-xxxx-xxxx-xxxx"
        autocomplete="off"
      />
    </label>

    <div class="cal-field">
      <span class="cal-field__label">{t('calendar.alarm_label', locale)}</span>
      <Segmented
        ariaLabel={t('calendar.alarm_label', locale)}
        options={alarmOptions()}
        value={appleAlarm}
        onchange={(m) => (appleAlarm = m)}
      />
    </div>

    <p class="cal-modal__trust">{t('calendar.apple_trust_note', locale)}</p>
    {#if appleError}
      <p class="cal-modal__error" role="alert">{appleError}</p>
    {/if}
  </div>

  {#snippet actions()}
    <Button variant="quiet" onclick={() => (appleOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button
      variant="primary"
      loading={$connectApple.isPending}
      disabled={!appleId.trim() || applePassword.trim().length < 8}
      onclick={() => $connectApple.mutate()}
    >
      {t('calendar.connect_submit', locale)}
    </Button>
  {/snippet}
</Dialog>

<ConfirmDialog
  open={disconnectTarget !== null}
  title={t('calendar.disconnect_confirm_title', locale)}
  body={t('calendar.disconnect_confirm_body', locale)}
  confirm={t('calendar.disconnect', locale)}
  busy={$disconnectConn.isPending}
  {locale}
  onconfirm={() => {
    const target = disconnectTarget;
    disconnectTarget = null;
    if (target) $disconnectConn.mutate(target.id);
  }}
/>

<ConfirmDialog
  bind:open={confirmRevoke}
  title={t('calendar.revoke_confirm_title', locale)}
  body={t('calendar.revoke_confirm_body', locale)}
  confirm={t('calendar.revoke_link', locale)}
  busy={$revokeFeed.isPending}
  {locale}
  onconfirm={() => {
    confirmRevoke = false;
    $revokeFeed.mutate();
  }}
/>

<ConfirmDialog
  bind:open={confirmRenew}
  title={t('calendar.renew_confirm_title', locale)}
  body={t('calendar.renew_confirm_body', locale)}
  confirm={t('calendar.renew_link', locale)}
  busy={$createFeed.isPending}
  {locale}
  onconfirm={() => {
    confirmRenew = false;
    $createFeed.mutate(activeFeedAlarm);
  }}
/>

<style>
  .cal-ctrl {
    flex-direction: column;
    align-items: flex-start;
  }

  .cal-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs);
  }

  .cal-inline-alarm {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    margin-block-start: var(--space-xs);
  }

  .cal-open {
    display: inline-flex;
    align-items: center;
    padding-block: var(--space-xs);
    padding-inline: var(--space-m);
    border-radius: var(--radius-s);
    background: var(--text-color);
    color: var(--bg-surface);
    font-size: var(--text-s);
    font-weight: 500;
    text-decoration: none;
    transition: opacity var(--transition);
  }
  .cal-open:hover {
    opacity: 0.9;
  }

  .cal-status {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .cal-status--warn {
    color: var(--warning);
  }

  .cal-fold {
    border-block-start: var(--line-hairline) solid var(--border-color-light);
    padding-block-start: var(--space-m);
  }

  .cal-fold__summary {
    cursor: pointer;
    font-size: var(--text-s);
    font-weight: 500;
    color: var(--text-color);
    list-style: none;
  }
  .cal-fold__summary::-webkit-details-marker {
    display: none;
  }
  .cal-fold__summary::before {
    content: '▸ ';
    color: var(--text-faint);
  }
  .cal-fold[open] .cal-fold__summary::before {
    content: '▾ ';
  }

  .cal-spaces__lead {
    max-inline-size: 60ch;
    margin-block: var(--space-s);
    line-height: 1.5;
  }

  .cal-check {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: var(--text-s);
    color: var(--text-color);
    cursor: pointer;
  }

  .cal-modal {
    display: flex;
    flex-direction: column;
    gap: var(--space-m);
  }

  .cal-modal__note,
  .cal-modal__trust {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: 1.5;
  }

  .cal-steps {
    margin: 0;
    padding-inline-start: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    font-size: var(--text-s);
    color: var(--text-color);
    line-height: 1.45;
  }

  .cal-steps__link {
    display: inline-block;
    margin-inline-start: var(--space-xs);
    color: var(--text-color);
    text-decoration: underline;
    font-weight: 500;
  }

  .cal-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .cal-field__label {
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--text-muted);
  }

  .cal-input {
    width: 100%;
    padding-block: var(--space-xs);
    padding-inline: var(--space-s);
    border: var(--line-hairline) solid var(--border-color);
    border-radius: var(--radius-s);
    background: var(--bg-surface);
    color: var(--text-color);
    font-family: var(--font-sans);
    font-size: var(--text-s);
  }

  .cal-modal__error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--danger);
  }
</style>
