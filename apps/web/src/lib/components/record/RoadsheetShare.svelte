<script lang="ts">
  /**
   * The sharing of a performance's road sheet (ADR-047, ADR-163, ADR-183):
   * one row per public role, one per person of the team. It lives in the pass
   * (the «Compartir» dialog) and on the operator road sheet page, the same
   * component in both (ADR-222). Designed for a ~380px column: a row is the
   * name, a quiet line of what that role sees, and one button.
   *
   * A role may hold several links (older ones, expired ones): all are listed
   * under its row with their own «Cambiar» and «Revocar»; the row's button
   * copies the newest one that still opens, or makes the first.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { copyText } from '$lib/clipboard';
  import { dayMonth, localDayISO } from '$lib/datetime';
  import { t, type Locale } from '$lib/i18n';
  import { shareExpired, shareLastDay, type RoadsheetShare } from '$lib/roadsheet';
  import type { TeamMember } from '$lib/roadsheet-late';

  interface Props {
    workspaceSlug: string;
    slug: string;
    locale: Locale;
  }

  let { workspaceSlug, slug, locale }: Props = $props();

  type Share = RoadsheetShare;
  /** The shape under `['roadsheet-shares', {ws, slug}]` everywhere it is read. */
  type SharesResponse = {
    items: Share[];
    team?: TeamMember[];
    /** ADR-226: whom the venue's link calls; null = the company. */
    venue_contact_person_id?: string | null;
    /** ADR-226: the company's public contact (the default call). */
    company?: { name: string; phone: string | null } | null;
  };

  const PUBLIC_ROLES = ['venue', 'performer', 'tech_manager'] as const;

  /** The word for a road sheet role; the raw value with spaces if unknown. */
  function roleWord(r: string): string {
    const key = `roadsheet.role_${r}`;
    const word = t(key, locale);
    return word === key ? r.replace(/_/g, ' ') : word;
  }

  /** What a role sees, in a quiet line; none for a role without a hint. */
  function roleHint(r: string): string {
    const key = `roadsheet.hint_${r}`;
    const hint = t(key, locale);
    return hint === key ? '' : hint;
  }

  const queryClient = useQueryClient();

  const sharesQuery = createQuery(
    toStore(() => {
      const k = { ws: workspaceSlug, slug };
      return {
        queryKey: ['roadsheet-shares', k] as const,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          fetchJSON<SharesResponse>(
            `/api/performances/${encodeURIComponent(k.slug)}/roadsheet/shares?ws=${encodeURIComponent(k.ws)}`,
            signal,
          ),
      };
    }),
  );
  let allShares = $derived($sharesQuery.data?.items ?? []);
  /** The links are known. Until then «no link» is not a fact: creating would
      mint a second token for a role that already has a live one. */
  let loaded = $derived($sharesQuery.isSuccess);
  /** The role links; a personal one is listed by its person (121 B). */
  let roleShares = $derived(allShares.filter((s) => !s.person));
  let team = $derived($sharesQuery.data?.team ?? []);

  // ── Whom the venue calls (ADR-226) ─────────────────────────────────────
  // The same rule the base applies to the venue's link: the chosen person
  // while they are in the team and have a phone, else the company's public
  // contact, else nobody (no phone to give).
  let company = $derived($sharesQuery.data?.company ?? null);
  let chosenId = $derived($sharesQuery.data?.venue_contact_person_id ?? null);
  let chosen = $derived(team.find((m) => m.person_id === chosenId) ?? null);
  let venueCallName = $derived(
    chosen?.has_phone ? chosen.name : company?.phone ? company.name : null,
  );
  let callsOpen = $state(false);
  let callsValue = $state('');
  function openCalls() {
    callsValue = chosen ? chosen.person_id : '';
    callsOpen = true;
  }
  let callOptions = $derived([
    {
      value: '',
      label: company
        ? t(company.phone ? 'roadsheet.calls_company' : 'roadsheet.calls_no_phone', locale, {
            name: company.name,
            phone: company.phone ?? '',
          })
        : t('roadsheet.calls_company_plain', locale),
    },
    ...team.map((m) => ({
      value: m.person_id,
      label: m.has_phone
        ? m.name
        : t('roadsheet.calls_no_phone', locale, { name: m.name }),
    })),
  ]);
  const saveCalls = createMutation({
    mutationFn: () =>
      mutateJSON(
        'PATCH',
        `/api/performances/${encodeURIComponent(slug)}?ws=${encodeURIComponent(workspaceSlug)}`,
        { venue_contact_person_id: callsValue || null },
      ),
    onSuccess: () => {
      callsOpen = false;
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['performance'] });
      // The operator's preview (`['roadsheet', { ws, slug, role }]`) draws the contact too.
      void queryClient.invalidateQueries({ queryKey: ['roadsheet'] });
    },
    onError: failed('roadsheet.calls_not_saved'),
  });

  /** The rows: the three public roles always, then any other role that holds a link. */
  let roles = $derived.by<string[]>(() => {
    const extra = [...new Set(roleShares.map((s) => s.role))].filter((r) => !(PUBLIC_ROLES as readonly string[]).includes(r));
    return [...PUBLIC_ROLES, ...extra];
  });
  const linksOf = (role: string) => roleShares.filter((s) => s.role === role);
  /** The newest link of a role that still opens (the API lists newest first). */
  const liveOf = (role: string) => linksOf(role).find((s) => !shareExpired(s.expires_at));

  /** Each person's live link, if they have one (the newest that still opens). */
  let personal = $derived(
    new Map(
      allShares
        .filter((s) => s.person && !shareExpired(s.expires_at))
        .map((s) => [s.person!.id, s] as const)
        .reverse(),
    ),
  );

  function failed(titleKey: string) {
    return (err: unknown) =>
      addToast({
        tone: 'danger',
        title: t(titleKey, locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
  }
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['roadsheet-shares'] });
  const sharesUrl = () => `/api/performances/${encodeURIComponent(slug)}/roadsheet/shares?ws=${encodeURIComponent(workspaceSlug)}`;

  const createShare = createMutation({
    mutationFn: (role: string) => mutateJSON('POST', sharesUrl(), { role }),
    onSuccess: refresh,
    onError: failed('roadsheet.link_not_created'),
  });

  // Personal links (121 B, ADR-183): only these show «Llego tarde».
  const createPersonal = createMutation({
    mutationFn: (personId: string) => mutateJSON('POST', sharesUrl(), { person_id: personId }),
    onSuccess: refresh,
    onError: failed('roadsheet.link_not_created'),
  });

  // Revoking cuts whoever opens the link and cannot be undone: it is confirmed (tarea 134).
  let revokingId = $state<string | null>(null);
  const revokeShare = createMutation({
    mutationFn: (id: string) =>
      mutateJSON(
        'DELETE',
        `/api/performances/${encodeURIComponent(slug)}/roadsheet/shares/${id}?ws=${encodeURIComponent(workspaceSlug)}`,
      ),
    onSuccess: () => {
      revokingId = null;
      refresh();
    },
    onError: failed('roadsheet.link_not_revoked'),
  });

  // When a link stops opening (ADR-163 § 2): «caduca el …», and move it.
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
      refresh();
    },
    onError: failed('roadsheet.expiry_not_saved'),
  });

  function expiryWord(s: Share): string {
    const day = dayMonth(shareLastDay(s.expires_at));
    return t(shareExpired(s.expires_at) ? 'roadsheet.link_expired' : 'roadsheet.link_expires', locale, { date: day });
  }

  async function copyShare(token: string): Promise<void> {
    addToast(
      (await copyText(`${location.origin}/public/roadsheet/${token}`))
        ? { tone: 'success', message: t('roadsheet.link_copied', locale) }
        : { tone: 'danger', message: t('roadsheet.link_copy_failed', locale) },
    );
  }
</script>

<div class="rsh" data-testid="roadsheet-share">
  {#if $sharesQuery.isError && !loaded}
    <p class="rsh__failed" role="alert" data-testid="roadsheet-share-failed">
      {t('roadsheet.links_load_error', locale)}
      <Button size="xs" variant="quiet" onclick={() => void $sharesQuery.refetch()}>{t('ui.retry', locale)}</Button>
    </p>
  {/if}
  <ul class="rsh__list" role="list">
    {#each roles as r (r)}
      {@const live = liveOf(r)}
      <li class="rsh__item" data-testid="roadsheet-role-{r}">
        <div class="rsh__row">
          <div class="rsh__who">
            <span class="rsh__name">{roleWord(r)}</span>
            {#if roleHint(r)}<span class="rsh__hint">{roleHint(r)}</span>{/if}
          </div>
          {#if live}
            <Button size="s" variant="secondary" onclick={() => copyShare(live.token)}>
              {t('roadsheet.copy_link', locale)}
            </Button>
          {:else}
            <Button
              size="s"
              variant="secondary"
              loading={$createShare.isPending && $createShare.variables === r}
              disabled={!loaded}
              onclick={() => $createShare.mutate(r)}
            >
              {t('roadsheet.create_link', locale)}
            </Button>
          {/if}
        </div>
        {#if r === 'venue' && loaded}
          <p class="rsh__calls" data-testid="roadsheet-venue-calls">
            <span class="rsh__calls-word">
              {venueCallName
                ? t('roadsheet.venue_calls', locale, { name: venueCallName })
                : t('roadsheet.venue_calls_none', locale)}
            </span>
            <Button size="xs" variant="quiet" onclick={openCalls}>{t('roadsheet.change', locale)}</Button>
          </p>
        {/if}
        {#each linksOf(r) as s (s.id)}
          <p class="rsh__link">
            <span class="rsh__when" class:rsh__gone={shareExpired(s.expires_at)}>{expiryWord(s)}</span>
            <Button size="xs" variant="quiet" onclick={() => openExpiry(s)}>{t('roadsheet.change', locale)}</Button>
            <Button size="xs" variant="quiet" tone="warn" onclick={() => (revokingId = s.id)}>
              {t('roadsheet.revoke', locale)}
            </Button>
          </p>
        {/each}
      </li>
    {/each}
  </ul>

  {#if team.length > 0}
    <div class="rsh__personal" data-testid="roadsheet-personal-links">
      <h3 class="rsh__personal-head">{t('roadsheet.personal_heading', locale)}</h3>
      <ul class="rsh__list" role="list">
        {#each team as m (m.person_id)}
          {@const own = personal.get(m.person_id)}
          <li class="rsh__item">
            <div class="rsh__row">
              <div class="rsh__who">
                <span class="rsh__name">{m.name}</span>
                {#if m.role}<span class="rsh__hint">{m.role}</span>{/if}
              </div>
              {#if own}
                <Button size="s" variant="secondary" onclick={() => copyShare(own.token)}>
                  {t('roadsheet.copy_link', locale)}
                </Button>
              {:else}
                <Button
                  size="s"
                  variant="secondary"
                  loading={$createPersonal.isPending && $createPersonal.variables === m.person_id}
                  disabled={!loaded}
                  onclick={() => $createPersonal.mutate(m.person_id)}
                >
                  {t('roadsheet.personal_create', locale)}
                </Button>
              {/if}
            </div>
            {#if own}
              <p class="rsh__link">
                <span class="rsh__when">{expiryWord(own)}</span>
                <Button size="xs" variant="quiet" tone="warn" onclick={() => (revokingId = own.id)}>
                  {t('roadsheet.revoke', locale)}
                </Button>
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<Dialog
  open={expiryShare !== null}
  onclose={() => (expiryShare = null)}
  title={t('roadsheet.change_expiry', locale)}
  size="s"
>
  <div class="rsh__expiry">
    <Input label={t('roadsheet.expiry_last_day', locale)} type="date" min={todayDay} bind:value={expiryDay} required />
  </div>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (expiryShare = null)}>{t('create.cancel', locale)}</Button>
    <Button onclick={() => $saveExpiry.mutate()} loading={$saveExpiry.isPending} disabled={!expiryDay || expiryDay < todayDay}>
      {t('edit.save', locale)}
    </Button>
  {/snippet}
</Dialog>

<Dialog open={callsOpen} onclose={() => (callsOpen = false)} title={t('roadsheet.calls_title', locale)} size="s">
  <p class="rsh__calls-hint">{t('roadsheet.calls_hint', locale)}</p>
  <Select label={t('roadsheet.venue_calls_label', locale)} options={callOptions} bind:value={callsValue} />
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (callsOpen = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={() => $saveCalls.mutate()} loading={$saveCalls.isPending}>
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
    .rsh {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }

    .rsh__item {
      display: flex;
      flex-direction: column;
      padding-block: var(--space-xs);
      border-block-end: var(--line-hairline) solid var(--border-color-light);
    }

    .rsh__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-m);
    }

    .rsh__who {
      display: flex;
      flex-direction: column;
      min-inline-size: 0;
    }

    .rsh__name {
      font-size: var(--text-s);
      color: var(--text-color);
    }

    .rsh__hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .rsh__failed {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .rsh__link {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-xs);
      font-size: var(--text-xs);
    }

    /* «La sala llama a: …», quiet, under the venue's row. */
    .rsh__calls {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-xs);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .rsh__calls-hint {
      margin-block: var(--space-s);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .rsh__when {
      font-family: var(--font-mono);
      color: var(--text-faint);
    }

    .rsh__gone {
      color: var(--text-muted);
    }

    .rsh__personal {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .rsh__personal-head {
      font-size: var(--text-s);
      font-weight: 500;
      color: var(--heading-color);
    }

    .rsh__expiry {
      margin-block-start: var(--space-s);
    }
  }
</style>
