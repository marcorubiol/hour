<script lang="ts">
  /**
   * Ajustes · Buzones (ADR-099 puntos 2, 3 y 9). El buzón personal de quien
   * mira y el común del espacio, que conecta un admin. Conectar es una
   * navegación completa a /api/mail/oauth/google/start; al volver, la página
   * llega con `?mail=finish` y aquí se cierra la conexión con su sesión.
   */
  import RecordHead from '$lib/components/RecordHead.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { dayMonthYear, dayMonthYearTs } from '$lib/datetime';
  import { appLocale, t } from '$lib/i18n';
  import Button from '$lib/components/Button.svelte';
  import MailDomainSection from './MailDomainSection.svelte';
  import MailSignature from './MailSignature.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import type { MailAccountItem, MailAccountsResponse, MailAccountScope } from '$lib/mail';

  interface Props {
    workspaceId: string | undefined;
  }
  let { workspaceId }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();

  const query = createQuery(
    toStore(() => ({
      queryKey: ['mail-accounts', workspaceId] as const,
      enabled: Boolean(workspaceId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<MailAccountsResponse>(`/api/mail/accounts?workspace_id=${workspaceId}`, signal),
    })),
  );

  let personal = $derived(($query.data?.items ?? []).find((a) => a.scope === 'personal') ?? null);
  let shared = $derived(($query.data?.items ?? []).filter((a) => a.scope === 'workspace'));
  let canManageShared = $derived($query.data?.can_manage_shared ?? false);
  let configured = $derived($query.data?.configured ?? true);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['mail-accounts'] });
  }

  function connect(scope: MailAccountScope) {
    if (!workspaceId) return;
    const back = `${page.url.pathname}?section=mail`;
    const u = new URL('/api/mail/oauth/google/start', page.url.origin);
    u.searchParams.set('scope', scope);
    u.searchParams.set('workspace_id', workspaceId);
    u.searchParams.set('return', back);
    window.location.assign(u.toString());
  }

  const disconnect = createMutation({
    mutationFn: (id: string) => mutateJSON('DELETE', `/api/mail/accounts/${id}`),
    onSuccess: () => addToast({ tone: 'success', title: t('mail.disconnect', locale), message: t('mail.disconnected', locale) }),
    onError: (err) => addToast({ tone: 'danger', title: t('mail.action_failed', locale), message: String(err instanceof Error ? err.message : err) }),
    onSettled: invalidate,
  });

  const syncNow = createMutation({
    mutationFn: (id: string) =>
      mutateJSON<{ ingested?: number; error?: string | null; status?: string }>('POST', `/api/mail/accounts/${id}/sync`),
    onSuccess: (r) =>
      addToast({
        tone: r?.error ? 'warning' : 'success',
        title: t('mail.sync_now', locale),
        message: r?.error ? t('mail.sync_error', locale) : t('mail.synced', locale, { n: r?.ingested ?? 0 }),
      }),
    onError: (err) => addToast({ tone: 'danger', title: t('mail.action_failed', locale), message: String(err instanceof Error ? err.message : err) }),
    onSettled: invalidate,
  });

  /** Vuelta de Google: cerrar la conexión ya con sesión, y limpiar la URL. */
  onMount(async () => {
    const mail = page.url.searchParams.get('mail');
    if (!mail) return;
    const clean = new URL(page.url);
    clean.searchParams.delete('mail');
    const reason = clean.searchParams.get('reason');
    clean.searchParams.delete('reason');
    if (mail === 'finish') {
      try {
        const r = await mutateJSON<{ address: string }>('POST', '/api/mail/oauth/google/finish');
        addToast({ tone: 'success', title: t('mail.connect_google', locale), message: t('mail.connected_toast', locale, { address: r?.address ?? '' }) });
      } catch (err) {
        addToast({ tone: 'danger', title: t('mail.connect_failed', locale), message: String(err instanceof Error ? err.message : err) });
      }
      invalidate();
    } else if (mail === 'error') {
      addToast({ tone: 'danger', title: t('mail.connect_failed', locale), message: reason ?? '' });
    }
    void goto(clean, { replaceState: true, noScroll: true, keepFocus: true });
  });

  function statusLine(a: MailAccountItem): string {
    if (a.status === 'revoked') return t('mail.status_revoked', locale);
    if (a.status === 'error') return t('mail.status_error', locale);
    if (!a.last_synced_at) return t('mail.status_first_sync', locale);
    return t('mail.status_synced', locale, { when: dayMonthYearTs(a.last_synced_at) });
  }
</script>

<RecordHead crumbs={[{ label: t('settings.title', locale) }, { label: t('mail.kicker', locale) }]} title={t('settings.nav_mail', locale)}>
  {#snippet facts()}<span>{t('mail.sub', locale)}</span>{/snippet}
</RecordHead>

{#if !configured}
  <p class="mail-off">{t('mail.not_configured', locale)}</p>
{/if}

<section class="set-group">
  <BlockHead title={t('mail.reads_kicker', locale)} />
  <div class="reads">
    <div>
      <p class="reads__k">{t('mail.reads_in', locale)}</p>
      <p>{t('mail.reads_in_body', locale)}</p>
    </div>
    <div>
      <p class="reads__k">{t('mail.reads_out', locale)}</p>
      <p>{t('mail.reads_out_body', locale)}</p>
    </div>
    <div>
      <p class="reads__k">{t('mail.reads_who', locale)}</p>
      <p>{t('mail.reads_who_body', locale)}</p>
    </div>
  </div>
</section>

<section class="set-group">
  <BlockHead title={t('mail.personal_kicker', locale)} />
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('mail.personal_label', locale)}</div>
        <div class="set-row__hint">{t('mail.personal_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        {#if $query.isLoading}
          <span class="muted">{t('mail.loading', locale)}</span>
        {:else if personal}
          {@render connection(personal, true)}
        {:else}
          <Button size="s" variant="secondary" disabled={!configured || !workspaceId} onclick={() => connect('personal')}>
            {t('mail.connect_google', locale)}
          </Button>
          <span class="muted">{t('mail.other_providers_later', locale)}</span>
        {/if}
      </div>
    </div>
  </div>
</section>

<section class="set-group">
  <BlockHead title={t('mail.shared_kicker', locale)} />
  <div class="set-group__body">
    <div class="set-row">
      <div class="set-row__lead">
        <div class="set-row__label">{t('mail.shared_label', locale)}</div>
        <div class="set-row__hint">{t('mail.shared_hint', locale)}</div>
      </div>
      <div class="set-row__ctrl">
        {#if shared.length}
          {#each shared as a (a.id)}
            {@render connection(a, canManageShared)}
          {/each}
        {:else if canManageShared}
          <Button size="s" variant="secondary" disabled={!configured || !workspaceId} onclick={() => connect('workspace')}>
            {t('mail.connect_google', locale)}
          </Button>
        {:else}
          <span class="muted">{t('mail.shared_admin_only', locale)}</span>
        {/if}
      </div>
    </div>
  </div>
</section>

<!-- Both signatures live here, beside the mailboxes they sign (yours, then
     the company's for the shared one): one place, each hint says when it goes. -->
<MailSignature scope="personal" {workspaceId} />
<MailSignature scope="workspace" {workspaceId} />

<MailDomainSection {workspaceId} />

{#snippet connection(a: MailAccountItem, manage: boolean)}
  <div class="conn">
    <p class="conn__addr">{a.address}</p>
    <p class="conn__meta" class:conn__meta--warn={a.status !== 'active'}>
      Google · {statusLine(a)}
    </p>
    <p class="conn__meta">
      {t('mail.conn_since', locale, { date: dayMonthYear(a.sync_from) })} · {t('mail.conn_count', locale, { n: a.messages_ingested })}
    </p>
  </div>
  {#if manage}
    <div class="conn__actions">
      {#if a.status === 'active'}
        <Button size="s" variant="secondary" disabled={$syncNow.isPending} onclick={() => $syncNow.mutate(a.id)}>
          {t('mail.sync_now', locale)}
        </Button>
      {:else}
        <Button size="s" variant="secondary" onclick={() => connect(a.scope)}>{t('mail.reconnect', locale)}</Button>
      {/if}
      <Button size="s" variant="secondary" tone="warn" disabled={$disconnect.isPending} onclick={() => $disconnect.mutate(a.id)}>
        {t('mail.disconnect', locale)}
      </Button>
    </div>
  {/if}
{/snippet}

<style>
  @layer components {
    .mail-off {
      margin: 0 0 var(--space-m);
      padding: var(--space-s) var(--space-m);
      color: var(--text-dark-muted);
      background: var(--bg-light);
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius);
      font-size: var(--text-s);
    }
    .reads {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
      gap: var(--space-m);
      font-size: var(--text-s);
    }
    .reads p {
      margin: 0;
    }
    .reads__k {
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .conn {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }
    .conn p {
      margin: 0;
    }
    .conn__addr {
      font-size: var(--text-s);
      font-weight: 500;
      overflow-wrap: anywhere;
    }
    .conn__meta {
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .conn__meta--warn {
      color: var(--danger-dark);
    }
    .conn__actions {
      display: inline-flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
    }
    .muted {
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
  }
</style>
