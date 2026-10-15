<script lang="ts">
  /**
   * Ajustes · Correo · Dominio de envío (envío en bloque, fase 2; plan § 5 y
   * § 10). El admin da de alta el dominio y el remitente (`difusion@dominio`
   * por defecto, ADR-110 § 3), copia los registros DNS y pulsa «Comprobar».
   * Los demás ven el dominio y su estado.
   *
   * Mientras el envío sea simulado (ADR-111) la pantalla lo dice arriba: no
   * sale ningún correo real. Palabras de § 3.3: nunca el nombre del servicio
   * que envía.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON, ApiError } from '$lib/api';
  import { copyText } from '$lib/clipboard';
  import { dayMonthYearTs } from '$lib/datetime';
  import { appLocale, t } from '$lib/i18n';
  import Button from '$lib/components/Button.svelte';
  import Badge from '$lib/components/Badge.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import {
    domainState,
    senderAddress,
    type DnsRecord,
    type MailDomainItem,
    type MailDomainsResponse,
    type MailDomainState,
  } from '$lib/mailout';

  interface Props {
    workspaceId: string | undefined;
  }
  let { workspaceId }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();

  const query = createQuery(
    toStore(() => ({
      queryKey: ['mailout-domains', workspaceId] as const,
      enabled: Boolean(workspaceId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<MailDomainsResponse>(`/api/mailout/domains?workspace_id=${workspaceId}`, signal),
    })),
  );

  let data = $derived($query.data);
  let domains = $derived(data?.items ?? []);
  let canManage = $derived(data?.can_manage ?? false);
  let simulated = $derived(data ? data.mode === 'simulator' || domains.some((d) => d.provider === 'simulator') : false);

  const STATE_LABEL: Record<MailDomainState, string> = {
    verified: 'mailout.state_verified',
    pending: 'mailout.state_pending',
    failed: 'mailout.state_failed',
  };
  const STATE_TONE: Record<MailDomainState, 'success' | 'warning' | 'danger'> = {
    verified: 'success',
    pending: 'warning',
    failed: 'danger',
  };
  const PURPOSE_LABEL: Record<DnsRecord['purpose'], string> = {
    dkim: 'mailout.purpose_dkim',
    mail_from: 'mailout.purpose_mail_from',
    dmarc: 'mailout.purpose_dmarc',
  };
  const ERRORS: Record<string, string> = {
    domain_taken: 'mailout.error_taken',
    invalid: 'mailout.error_invalid',
    invalid_body: 'mailout.error_invalid',
    domain_in_use: 'mailout.error_in_use',
    mailout_not_configured: 'mailout.not_configured',
  };

  function failed(err: unknown) {
    const code = err instanceof ApiError ? String(err.body?.error ?? '') : '';
    addToast({
      tone: 'danger',
      title: t('mailout.action_failed', locale),
      message: ERRORS[code] ? t(ERRORS[code], locale) : err instanceof Error ? err.message : String(err),
    });
  }

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['mailout-domains'] });
  }

  // ── Alta ──
  let domainInput = $state('');
  let localInput = $state('difusion');
  let nameInput = $state<string | null>(null);
  let nameShown = $derived(nameInput ?? data?.workspace_name ?? '');

  const add = createMutation({
    mutationFn: () =>
      mutateJSON<{ item: MailDomainItem }>('POST', '/api/mailout/domains', {
        workspace_id: workspaceId,
        domain: domainInput,
        from_local_part: localInput.trim() || 'difusion',
        from_name: nameShown.trim() || null,
      }),
    onSuccess: () => {
      domainInput = '';
      nameInput = null;
    },
    onError: failed,
    onSettled: invalidate,
  });

  // ── Comprobar ──
  const check = createMutation({
    mutationFn: (id: string) => mutateJSON<{ item: MailDomainItem | null }>('POST', `/api/mailout/domains/${id}/check`),
    onSuccess: (r) => {
      const ok = r?.item?.verified_at;
      addToast({
        tone: ok ? 'success' : 'warning',
        message: t(ok ? 'mailout.verified_toast' : 'mailout.pending_toast', locale),
      });
    },
    onError: failed,
    onSettled: invalidate,
  });

  // ── Remitente ──
  let senderDraft = $state<Record<string, { local: string; name: string }>>({});
  function draftOf(d: MailDomainItem) {
    return senderDraft[d.id] ?? { local: d.from_local_part, name: d.from_name ?? data?.workspace_name ?? '' };
  }
  function editDraft(d: MailDomainItem, patch: Partial<{ local: string; name: string }>) {
    senderDraft = { ...senderDraft, [d.id]: { ...draftOf(d), ...patch } };
  }
  function senderDirty(d: MailDomainItem): boolean {
    const s = senderDraft[d.id];
    if (!s) return false;
    return s.local.trim() !== d.from_local_part || s.name.trim() !== (d.from_name ?? data?.workspace_name ?? '');
  }

  const saveSender = createMutation({
    mutationFn: (d: MailDomainItem) => {
      const s = draftOf(d);
      // El nombre del espacio es el de por defecto: guardarlo igual es null.
      const name = s.name.trim();
      return mutateJSON('PATCH', `/api/mailout/domains/${d.id}`, {
        from_local_part: s.local.trim().toLowerCase(),
        from_name: name && name !== data?.workspace_name ? name : null,
      });
    },
    onSuccess: (_r, d) => {
      const { [d.id]: _gone, ...rest } = senderDraft;
      senderDraft = rest;
      addToast({ tone: 'success', message: t('mailout.saved', locale) });
    },
    onError: failed,
    onSettled: invalidate,
  });

  const remove = createMutation({
    mutationFn: (id: string) => mutateJSON('DELETE', `/api/mailout/domains/${id}`),
    onError: failed,
    onSettled: invalidate,
  });

  let copied = $state<string | null>(null);
  async function copy(key: string, value: string) {
    if (await copyText(value)) {
      copied = key;
      setTimeout(() => {
        if (copied === key) copied = null;
      }, 1500);
    }
  }
</script>

{#if workspaceId}
  <section class="set-group" data-testid="mailout-domain">
    <div class="set-group__head">
      <span class="eyebrow set-group__kicker">{t('mailout.domain_kicker', locale)}</span>
      <h2 class="set-group__title">{t('mailout.domain_title', locale)}</h2>
    </div>
    <p class="md-intro">{t('mailout.domain_intro', locale)}</p>

    {#if simulated}
      <div class="md-sim" role="note" data-testid="mailout-simulated">
        <p class="md-sim__title">{t('mailout.simulated_title', locale)}</p>
        <p>{t('mailout.simulated_body', locale)}</p>
      </div>
    {/if}
    {#if data && !data.configured && canManage}
      <p class="md-off">{t('mailout.not_configured', locale)}</p>
    {/if}

    <div class="set-group__body">
      {#if $query.isLoading}
        <p class="muted">{t('mailout.loading', locale)}</p>
      {:else}
        {#each domains as d (d.id)}
          {@render domainBlock(d)}
        {/each}

        {#if domains.length === 0 && !canManage}
          <p class="muted">{t('mailout.admin_only', locale)}</p>
        {/if}

        {#if domains.length === 0 && canManage}
          <form
            class="md-add"
            onsubmit={(e) => {
              e.preventDefault();
              $add.mutate();
            }}
          >
            <div class="set-row">
              <div class="set-row__lead">
                <label class="set-row__label" for="md-domain">{t('mailout.domain_label', locale)}</label>
                <div class="set-row__hint">{t('mailout.domain_hint', locale)}</div>
              </div>
              <div class="set-row__ctrl">
                <input
                  id="md-domain"
                  type="text"
                  inputmode="url"
                  autocomplete="off"
                  spellcheck="false"
                  maxlength="253"
                  placeholder="mamemi.cat"
                  bind:value={domainInput}
                  disabled={$add.isPending || !data?.configured}
                />
              </div>
            </div>
            <div class="set-row">
              <div class="set-row__lead">
                <label class="set-row__label" for="md-local">{t('mailout.sender_label', locale)}</label>
                <div class="set-row__hint">{t('mailout.sender_hint', locale)}</div>
              </div>
              <div class="set-row__ctrl"><div class="md-sender">
                <input
                  id="md-name"
                  type="text"
                  maxlength="100"
                  aria-label={t('mailout.sender_name', locale)}
                  placeholder={t('mailout.sender_name', locale)}
                  value={nameShown}
                  oninput={(e) => (nameInput = e.currentTarget.value)}
                  disabled={$add.isPending || !data?.configured}
                />
                <span class="md-addr">
                  <input
                    id="md-local"
                    type="text"
                    maxlength="64"
                    autocomplete="off"
                    spellcheck="false"
                    bind:value={localInput}
                    disabled={$add.isPending || !data?.configured}
                  />
                  <span class="md-at">@{domainInput.trim().toLowerCase() || t('mailout.your_domain', locale)}</span>
                </span>
              </div></div>
            </div>
            <div class="md-actions">
              <Button size="s" type="submit" disabled={!domainInput.trim() || $add.isPending || !data?.configured}>
                {t('mailout.add_domain', locale)}
              </Button>
            </div>
          </form>
        {/if}
      {/if}
    </div>
  </section>
{/if}

{#snippet domainBlock(d: MailDomainItem)}
  {@const state = domainState(d)}
  <div class="set-row" data-testid="mailout-domain-row">
    <div class="set-row__lead">
      <div class="set-row__label">{t('mailout.domain_label', locale)}</div>
      <div class="set-row__hint">
        {#if d.checked_at && state !== 'pending'}{t('mailout.checked_at', locale, { when: dayMonthYearTs(d.checked_at) })}{/if}
      </div>
    </div>
    <div class="set-row__ctrl md-domain">
      <span class="md-domain__name">{d.domain}</span>
      <span data-testid="mailout-domain-state"><Badge tone={STATE_TONE[state]}>{t(STATE_LABEL[state], locale)}</Badge></span>
    </div>
  </div>

  <div class="set-row">
    <div class="set-row__lead">
      <div class="set-row__label">{t('mailout.sender_label', locale)}</div>
      <div class="set-row__hint">{t('mailout.sender_hint', locale)}</div>
    </div>
    <div class="set-row__ctrl"><div class="md-sender">
      {#if canManage}
        <input
          type="text"
          maxlength="100"
          aria-label={t('mailout.sender_name', locale)}
          value={draftOf(d).name}
          oninput={(e) => editDraft(d, { name: e.currentTarget.value })}
        />
        <span class="md-addr">
          <input
            type="text"
            maxlength="64"
            aria-label={t('mailout.sender_label', locale)}
            autocomplete="off"
            spellcheck="false"
            value={draftOf(d).local}
            oninput={(e) => editDraft(d, { local: e.currentTarget.value })}
          />
          <span class="md-at">@{d.domain}</span>
        </span>
        {#if senderDirty(d)}
          <Button size="s" variant="outline" disabled={$saveSender.isPending} onclick={() => $saveSender.mutate(d)}>
            {t('mailout.save', locale)}
          </Button>
        {/if}
      {:else}
        <span class="md-ro">{d.from_name ?? data?.workspace_name ?? ''} &lt;{senderAddress(d.from_local_part, d.domain)}&gt;</span>
      {/if}
    </div></div>
  </div>

  <div class="md-records">
    <div class="md-records__head">
      <p class="set-row__label">{t('mailout.records_title', locale)}</p>
      <p class="set-row__hint md-records__hint">{t('mailout.records_hint', locale)}</p>
    </div>
    <div class="md-table" role="table" aria-label={t('mailout.records_title', locale)}>
      <div class="md-tr md-tr--head" role="row">
        <span role="columnheader">{t('mailout.col_type', locale)}</span>
        <span role="columnheader">{t('mailout.col_name', locale)}</span>
        <span role="columnheader">{t('mailout.col_value', locale)}</span>
      </div>
      {#each d.dns_records as r, i (i)}
        {@const value = r.priority ? `${r.priority} ${r.value}` : r.value}
        <div class="md-tr" role="row" data-testid="mailout-dns-record">
          <span role="cell" class="md-type">
            <span>{r.type}</span>
            <span class="md-purpose">{t(PURPOSE_LABEL[r.purpose], locale)}</span>
          </span>
          <span role="cell" class="md-mono">
            {r.name}
            <button type="button" class="md-copy" onclick={() => copy(`${d.id}-${i}-n`, r.name)}>
              {copied === `${d.id}-${i}-n` ? t('mailout.copied', locale) : t('mailout.copy', locale)}
            </button>
          </span>
          <span role="cell" class="md-mono">
            {value}
            <button type="button" class="md-copy" onclick={() => copy(`${d.id}-${i}-v`, r.value)}>
              {copied === `${d.id}-${i}-v` ? t('mailout.copied', locale) : t('mailout.copy', locale)}
            </button>
          </span>
        </div>
      {/each}
    </div>
  </div>

  {#if canManage}
    <div class="md-actions">
      {#if state !== 'verified'}
        <Button size="s" disabled={$check.isPending} onclick={() => $check.mutate(d.id)}>
          {t('mailout.check', locale)}
        </Button>
      {/if}
      <Button size="s" variant="outline" tone="warn" disabled={$remove.isPending} onclick={() => $remove.mutate(d.id)}>
        {t('mailout.remove', locale)}
      </Button>
    </div>
  {/if}
{/snippet}

<style>
  @layer components {
    .md-intro {
      margin: 0 0 var(--space-s);
      color: var(--text-muted);
      font-size: var(--text-s);
      line-height: 1.55;
      max-inline-size: 60ch;
    }
    .md-sim {
      margin: 0 0 var(--space-m);
      padding: var(--space-s) var(--space-m);
      background: var(--bg-light);
      border: 1px solid var(--border-color-light);
      border-inline-start: 3px solid var(--warning, var(--border-color-dark));
      border-radius: var(--radius);
      font-size: var(--text-s);
      line-height: 1.5;
    }
    .md-sim p {
      margin: 0;
    }
    .md-sim__title {
      font-weight: 500;
    }
    .md-off {
      margin: 0 0 var(--space-m);
      color: var(--danger-dark);
      font-size: var(--text-s);
    }
    .md-domain {
      align-items: center;
    }
    .md-domain__name {
      font-size: var(--text-s);
      font-weight: 500;
      overflow-wrap: anywhere;
    }
    .md-sender {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: var(--space-xs);
      inline-size: 100%;
    }
    .md-sender > :global(*) {
      align-self: flex-start;
    }
    .md-sender > input {
      align-self: stretch;
    }
    .md-sender input {
      inline-size: 100%;
    }
    .md-addr {
      display: flex;
      align-items: center;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }
    .md-addr input {
      flex: 0 1 12ch;
      min-inline-size: 6ch;
    }
    .md-at {
      color: var(--text-muted);
      font-size: var(--text-s);
      overflow-wrap: anywhere;
    }
    .md-ro {
      font-size: var(--text-s);
      overflow-wrap: anywhere;
    }
    .md-records {
      padding-block: var(--space-m);
      border-block-end: 1px solid var(--border-color-light);
    }
    .md-records__head p {
      margin: 0;
    }
    .md-records__hint {
      max-inline-size: 60ch;
      margin-block-end: var(--space-s);
    }
    .md-table {
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr) minmax(0, 1.3fr);
      font-size: var(--text-xs);
    }
    .md-tr {
      display: contents;
    }
    .md-tr > [role='cell'],
    .md-tr > [role='columnheader'] {
      padding: var(--space-xs) var(--space-s) var(--space-xs) 0;
      border-block-start: 1px solid var(--border-color-light);
      min-inline-size: 0;
    }
    .md-tr--head > [role='columnheader'] {
      color: var(--text-faint);
      border-block-start: 0;
    }
    .md-type {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .md-purpose {
      color: var(--text-faint);
    }
    .md-mono {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      font-family: var(--font-mono, ui-monospace, monospace);
      overflow-wrap: anywhere;
      word-break: break-all;
    }
    .md-copy {
      appearance: none;
      padding: 0;
      border: 0;
      background: none;
      color: var(--text-muted);
      font: inherit;
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
    }
    .md-copy:hover {
      color: var(--text-color);
    }
    .md-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
      padding-block: var(--space-m);
    }
    .muted {
      margin: 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    /* En el móvil la tabla pasa a fichas: tipo arriba, nombre y valor debajo. */
    @media (max-width: 47.999rem) {
      .md-table {
        grid-template-columns: minmax(0, 1fr);
      }
      .md-tr--head {
        display: none;
      }
      .md-tr > [role='cell'] {
        border-block-start: 0;
        padding-block: 2px;
      }
      .md-tr > .md-type {
        flex-direction: row;
        gap: var(--space-xs);
        padding-block-start: var(--space-s);
        border-block-start: 1px solid var(--border-color-light);
      }
    }
  }
</style>
