<script lang="ts">
  /**
   * Road sheet — operator view (ADR-023 / ADR-041 / ADR-047).
   *
   * The role pills are an OPERATOR PREVIEW — filtering happens server-side
   * per request, so switching roles refetches; the browser never holds
   * hidden sections. The document body is the shared RoadsheetView.
   *
   * Public links (ADR-047): each link pins one public role; anyone with
   * the URL sees that role's projection, no account. Revocation kills the
   * token on the next request.
   */

  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { docTitle } from '$lib/doc-title';
  import { page } from '$app/state';
  import { createMutation, createQuery, keepPreviousData, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import { retryLoad } from '$lib/load-fail';
  import RecordState from '$lib/components/RecordState.svelte';
  import Button from '$lib/components/Button.svelte';
  import Select from '$lib/components/Select.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import { copyText } from '$lib/clipboard';
  import Pill from '$lib/components/Pill.svelte';
  import RoadsheetView from '$lib/components/RoadsheetView.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { spaceCrumb, type Crumb } from '$lib/record-crumbs';
  import { addToast } from '$lib/components/Toast.svelte';
  import { dayMonth, dayMonthYearTs, localDayISO } from '$lib/datetime';
  import { appLocale, t } from '$lib/i18n';
  import {
    ROADSHEET_ROLES,
    shareExpired,
    shareLastDay,
    type Roadsheet,
    type RoadsheetRole,
    type RoadsheetShare,
  } from '$lib/roadsheet';
  import type { TeamMember } from '$lib/roadsheet-late';

  type Response = { roadsheet: Roadsheet; venue_timezone: string | null };
  type Share = RoadsheetShare;
  type SharesResponse = { items: Share[]; team?: TeamMember[] };

  const PUBLIC_ROLES = ['venue', 'performer', 'tech_manager'] as const;

  const locale = appLocale();

  /** The word for a road sheet role; the raw value with spaces if unknown. */
  function roleWord(r: string): string {
    const key = `roadsheet.role_${r}`;
    const word = t(key, locale);
    return word === key ? r.replace(/_/g, ' ') : word;
  }

  let workspaceSlug = $derived(page.params.workspace ?? '');
  let slug = $derived(page.params.slug ?? '');
  let role = $state<RoadsheetRole>('full');

  const queryOptions = toStore(() => {
    const k = { ws: workspaceSlug, slug, role };
    return {
      queryKey: ['roadsheet', k] as const,
      retry: retryLoad,
      // Switching the role keeps the sheet on screen until the next one lands.
      placeholderData: keepPreviousData,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<Response>(
          `/api/performances/${encodeURIComponent(k.slug)}/roadsheet?ws=${encodeURIComponent(k.ws)}&role=${k.role}`,
          signal,
        ),
    };
  });

  const query = createQuery(queryOptions);

  let sheet = $derived($query.data?.roadsheet ?? null);

  // Address: Space › Project › Función › Hoja de ruta. The performance is a
  // link: the way back lives in the address, not in a line of its own.
  const wsQuery = createQuery(workspacesQueryOptions());
  let crumbs = $derived.by<Crumb[]>(() => {
    const ws = $wsQuery.data?.items.find((w) => w.slug === workspaceSlug);
    const out: Crumb[] = [spaceCrumb(ws?.name, workspaceSlug)];
    if (sheet?.project) out.push({ label: sheet.project.name, href: `/h/${workspaceSlug}/project/${sheet.project.slug}/` });
    out.push({ label: t('perf.label', locale), href: `/h/${workspaceSlug}/performance/${slug}` });
    out.push({ label: t('roadsheet.title', locale) });
    return out;
  });
  let venueTz = $derived($query.data?.venue_timezone ?? null);
  let loading = $derived($query.isPending);

  // ── Public links ─────────────────────────────────────────────────────
  const queryClient = useQueryClient();

  const sharesOptions = toStore(() => {
    const k = { ws: workspaceSlug, slug };
    return {
      queryKey: ['roadsheet-shares', k] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<SharesResponse>(
          `/api/performances/${encodeURIComponent(k.slug)}/roadsheet/shares?ws=${encodeURIComponent(k.ws)}`,
          signal,
        ),
    };
  });
  const sharesQuery = createQuery(sharesOptions);
  let allShares = $derived($sharesQuery.data?.items ?? []);
  /** The role links; a personal one is listed by its person (121 B). */
  let shares = $derived(allShares.filter((s) => !s.person));
  let team = $derived($sharesQuery.data?.team ?? []);
  /** Each person's live link, if they have one (the newest that still opens). */
  let personal = $derived(
    new Map(
      allShares
        .filter((s) => s.person && !shareExpired(s.expires_at))
        .map((s) => [s.person!.id, s] as const)
        .reverse(),
    ),
  );

  let shareRole = $state<(typeof PUBLIC_ROLES)[number]>('tech_manager');

  const createShare = createMutation({
    mutationFn: () =>
      mutateJSON(
        'POST',
        `/api/performances/${encodeURIComponent(slug)}/roadsheet/shares?ws=${encodeURIComponent(workspaceSlug)}`,
        { role: shareRole },
      ),
    onSuccess: () => {
      revokingId = null;
      void queryClient.invalidateQueries({ queryKey: ['roadsheet-shares'] });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('roadsheet.link_not_created', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });

  // ── Personal links (121 B, ADR-183): only these show «Llego tarde» ────
  const createPersonal = createMutation({
    mutationFn: (personId: string) =>
      mutateJSON(
        'POST',
        `/api/performances/${encodeURIComponent(slug)}/roadsheet/shares?ws=${encodeURIComponent(workspaceSlug)}`,
        { person_id: personId },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roadsheet-shares'] });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('roadsheet.link_not_created', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });

  // Revocar un enlace corta a quien lo abre y no se deshace: se confirma (tarea 134).
  let revokingId = $state<string | null>(null);
  const revokeShare = createMutation({
    mutationFn: (id: string) =>
      mutateJSON(
        'DELETE',
        `/api/performances/${encodeURIComponent(slug)}/roadsheet/shares/${id}?ws=${encodeURIComponent(workspaceSlug)}`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roadsheet-shares'] });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('roadsheet.link_not_revoked', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });

  // ── When a link stops opening (ADR-163 § 2): «caduca el …», and move it ──
  let expiryShare = $state<Share | null>(null);
  let expiryDay = $state('');
  const todayDay = localDayISO();

  function openExpiry(s: Share) {
    expiryShare = s;
    const last = shareLastDay(s.expires_at);
    expiryDay = last < todayDay ? todayDay : last;
  }

  const saveExpiry = createMutation({
    mutationFn: () =>
      mutateJSON(
        'PATCH',
        `/api/performances/${encodeURIComponent(slug)}/roadsheet/shares/${expiryShare!.id}?ws=${encodeURIComponent(workspaceSlug)}`,
        { last_day: expiryDay },
      ),
    onSuccess: () => {
      expiryShare = null;
      void queryClient.invalidateQueries({ queryKey: ['roadsheet-shares'] });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('roadsheet.expiry_not_saved', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });

  function expiryWord(s: Share): string {
    const day = dayMonth(shareLastDay(s.expires_at));
    return t(shareExpired(s.expires_at) ? 'roadsheet.link_expired' : 'roadsheet.link_expires', locale, { date: day });
  }

  function shareUrl(token: string): string {
    return `${location.origin}/public/roadsheet/${token}`;
  }

  async function copyShare(token: string): Promise<void> {
    addToast(
      (await copyText(shareUrl(token)))
        ? { tone: 'success', message: t('roadsheet.link_copied', locale) }
        : { tone: 'danger', message: t('roadsheet.link_copy_failed', locale) },
    );
  }

</script>

<svelte:head>
  <title>{docTitle(sheet?.title, t('roadsheet.title', locale))}</title>
</svelte:head>

<article class="record rs" aria-busy={loading}>

  {#if loading || ($query.isError && !sheet)}
    <RecordState
      {loading}
      error={$query.error}
      missingText={t('roadsheet.not_found', locale)}
      failedText={t('roadsheet.load_error', locale)}
      onretry={() => void $query.refetch()}
      back={{ href: `/h/${workspaceSlug}/performance/${slug}`, label: t('roadsheet.back', locale) }}
      {locale}
    />
  {:else if sheet}
    <RoadsheetView {sheet} {venueTz} {locale} {crumbs}>
      {#snippet tools()}
      <nav class="rs__roles" aria-label={t('roadsheet.preview_as', locale)}>
        <span class="rs__roles-label">{t('roadsheet.view_as', locale)}</span>
        {#each ROADSHEET_ROLES as r (r)}
          <Pill size="sm" active={role === r} onclick={() => (role = r)}>
            {roleWord(r)}
          </Pill>
        {/each}
      </nav>
      {/snippet}
    </RoadsheetView>

    <section class="rs__share" aria-label={t('roadsheet.public_links', locale)}>
      <BlockHead title={t('roadsheet.public_links', locale)} />
      <p class="rs__share-hint">{t('roadsheet.public_links_hint', locale)}</p>
      {#if shares.length > 0}
        <ul class="rs__share-list" role="list">
          {#each shares as s (s.id)}
            <li>
              <span class="rs__share-role">{roleWord(s.role)}</span>
              <span class="rs__share-date"
                >{dayMonthYearTs(s.created_at)} · <span class:rs__share-gone={shareExpired(s.expires_at)}>{expiryWord(s)}</span></span
              >
              <span class="rs__share-actions">
                <Button size="s" variant="quiet" onclick={() => openExpiry(s)}>
                  {t('roadsheet.change_expiry', locale)}
                </Button>
                <Button size="s" variant="secondary" onclick={() => copyShare(s.token)}>
                  {t('roadsheet.copy_link', locale)}
                </Button>
                <Button
                  size="s"
                  variant="secondary"
                  tone="warn"
                  onclick={() => (revokingId = s.id)}
                >
                  {t('roadsheet.revoke', locale)}
                </Button>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
      {#if team.length > 0}
        <div class="rs__personal" data-testid="roadsheet-personal-links">
          <h3 class="rs__personal-head">{t('roadsheet.personal_links', locale)}</h3>
          <p class="rs__share-hint">{t('roadsheet.personal_links_hint', locale)}</p>
          <ul class="rs__share-list" role="list">
            {#each team as m (m.person_id)}
              {@const own = personal.get(m.person_id)}
              <li>
                <span class="rs__share-role">{m.name}</span>
                <span class="rs__share-date">{m.role ?? ''}{#if own}{m.role ? ' · ' : ''}{expiryWord(own)}{/if}</span>
                <span class="rs__share-actions">
                  {#if own}
                    <Button size="s" variant="secondary" onclick={() => copyShare(own.token)}>
                      {t('roadsheet.copy_link', locale)}
                    </Button>
                    <Button
                      size="s"
                      variant="secondary"
                      tone="warn"
                      onclick={() => (revokingId = own.id)}
                    >
                      {t('roadsheet.revoke', locale)}
                    </Button>
                  {:else}
                    <Button
                      size="s"
                      variant="secondary"
                      loading={$createPersonal.isPending && $createPersonal.variables === m.person_id}
                      onclick={() => $createPersonal.mutate(m.person_id)}
                    >
                      {t('roadsheet.personal_create', locale)}
                    </Button>
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      <div class="rs__share-create">
        <div class="rs__share-pick">
          <Select id="rs-share-role" label={t('roadsheet.role', locale)} bind:value={shareRole}>
            {#each PUBLIC_ROLES as r (r)}
              <option value={r}>{roleWord(r)}</option>
            {/each}
          </Select>
        </div>
        <Button size="s" loading={$createShare.isPending} onclick={() => $createShare.mutate()}>
          {t('roadsheet.create_link', locale)}
        </Button>
      </div>
    </section>
  {/if}
</article>

<Dialog
  open={expiryShare !== null}
  onclose={() => (expiryShare = null)}
  title={t('roadsheet.change_expiry', locale)}
  size="s"
>
  <div class="rs__expiry">
    <Input label={t('roadsheet.expiry_last_day', locale)} type="date" min={todayDay} bind:value={expiryDay} required />
  </div>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (expiryShare = null)}>{t('create.cancel', locale)}</Button>
    <Button onclick={() => $saveExpiry.mutate()} loading={$saveExpiry.isPending} disabled={!expiryDay || expiryDay < todayDay}>
      {t('edit.save', locale)}
    </Button>
  {/snippet}
</Dialog>

<ConfirmDialog
  bind:open={() => revokingId !== null, (v) => { if (!v) revokingId = null; }}
  title={t('roadsheet.revoke_title', locale)}
  body={t('roadsheet.revoke_confirm', locale)}
  confirm={t('roadsheet.revoke', locale)}
  busy={$revokeShare.isPending}
  {locale}
  onconfirm={() => revokingId && $revokeShare.mutate(revokingId)}
/>

<style>
  @layer components {

    .rs__roles {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      flex-wrap: wrap;
    }

    .rs__roles-label {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-s);
      color: var(--text-faint);
    }

    .rs__share {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    /* Sub-eyebrow typography via base.css .eyebrow--sub. */

    .rs__share-hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .rs__share-list li {
      display: flex;
      align-items: center;
      gap: var(--space-m);
      padding-block: var(--space-xs);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }

    .rs__share-role {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-s);
      color: var(--text-color);
      min-inline-size: 7rem;
    }

    .rs__share-date {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
      flex: 1;
    }

    .rs__share-gone {
      color: var(--text-muted);
    }

    .rs__expiry {
      margin-block-start: var(--space-s);
    }

    .rs__share-actions {
      display: flex;
      gap: var(--space-xs);
    }

    .rs__personal {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .rs__personal-head {
      font-size: var(--text-s);
      font-weight: 500;
      color: var(--heading-color);
    }

    .rs__share-create {
      display: flex;
      align-items: end;
      gap: var(--space-m);
    }

    .rs__share-pick {
      flex: 1 1 16rem;
    }

    /* Print: drop the operator chrome, keep the document. The width cap is
       released by .shell__content's own print rule (it owns --page-width now). */
    @media print {
      .rs__roles,
      .rs__share {
        display: none;
      }
    }
  }
</style>
