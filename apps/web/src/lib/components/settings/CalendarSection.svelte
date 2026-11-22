<script lang="ts">
  /**
   * Ajustes › Calendario (ADR-241 Fase 1).
   *
   * Sección personal (accesible incluso en espacios donde eres invitado):
   *   · Enlace de suscripción personal `.ics` cruzando espacios, revocable y
   *     con caducidad de 1 año, listo para Apple Calendar, Google Calendar y
   *     Outlook.
   *   · Aviso por evento (`none` | `day_before` | `2h_before`).
   *   · Plegado (`<details>`): qué espacios entran («Lo mío · Todo · Nada»),
   *     siguiendo por defecto la preferencia de `view_scope` (ADR-151).
   */

  import RecordHead from '$lib/components/RecordHead.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import Button from '$lib/components/Button.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import SavedMark from '$lib/components/SavedMark.svelte';
  import Segmented from '$lib/components/Segmented.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { copyText } from '$lib/clipboard';
  import { dayMonthYear } from '$lib/datetime';
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

  const locale = appLocale();
  const queryClient = useQueryClient();
  const saved = new SaveFlash();

  const feedQuery = createQuery({
    queryKey: ['my-calendar-feed'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ feed: PersonalCalendarFeedItem | null }>('/api/me/calendar-feed', signal),
  });

  const workspacesQuery = createQuery(workspacesQueryOptions());

  let feed = $derived<PersonalCalendarFeedItem | null>($feedQuery.data?.feed ?? null);
  let workspaces = $derived<NavWorkspace[]>($workspacesQuery.data?.items ?? []);
  let pendingAlarm = $state<CalendarAlarmMode>('none');
  let activeAlarm = $derived<CalendarAlarmMode>(feed ? feed.alarm_mode : pendingAlarm);
  let confirmRevoke = $state(false);
  let confirmRenew = $state(false);

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
      if (res?.feed) {
        queryClient.setQueryData(['my-calendar-feed'], { feed: res.feed });
      }
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

  const updateAlarm = createMutation({
    mutationFn: (alarm_mode: CalendarAlarmMode) =>
      mutateJSON<{ feed: PersonalCalendarFeedItem }>('PATCH', '/api/me/calendar-feed', { alarm_mode }),
    onSuccess: (res) => {
      if (res?.feed) {
        queryClient.setQueryData(['my-calendar-feed'], { feed: res.feed });
      }
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

  function chooseAlarm(mode: CalendarAlarmMode) {
    pendingAlarm = mode;
    if (feed) {
      $updateAlarm.mutate(mode);
    }
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

<section class="set-group" data-testid="personal-calendar-feed">
  <BlockHead title={t('calendar.subscription_kicker', locale)} />
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
              variant="primary"
              onclick={() => $createFeed.mutate(pendingAlarm)}
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
          value={activeAlarm}
          disabled={$updateAlarm.isPending || $createFeed.isPending}
          onchange={chooseAlarm}
        />
        <SavedMark shown={saved.is('alarm')} />
      </div>
    </div>
  </div>
</section>

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
    $createFeed.mutate(activeAlarm);
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
</style>
