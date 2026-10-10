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

  import { page } from '$app/state';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import { copyText } from '$lib/clipboard';
  import Pill from '$lib/components/Pill.svelte';
  import RoadsheetView from '$lib/components/RoadsheetView.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { dayMonthYearTs } from '$lib/datetime';
  import { appLocale, t } from '$lib/i18n';
  import { ROADSHEET_ROLES, type Roadsheet, type RoadsheetRole } from '$lib/roadsheet';

  type Response = { roadsheet: Roadsheet; venue_timezone: string | null };
  type Share = { id: string; token: string; role: string; created_at: string };

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
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<Response>(
          `/api/performances/${encodeURIComponent(k.slug)}/roadsheet?ws=${encodeURIComponent(k.ws)}&role=${k.role}`,
          signal,
        ),
    };
  });

  const query = createQuery(queryOptions);

  let sheet = $derived($query.data?.roadsheet ?? null);
  let venueTz = $derived($query.data?.venue_timezone ?? null);
  let loading = $derived($query.isPending);
  let errorMsg = $derived($query.error instanceof Error ? $query.error.message : '');

  // ── Public links ─────────────────────────────────────────────────────
  const queryClient = useQueryClient();

  const sharesOptions = toStore(() => {
    const k = { ws: workspaceSlug, slug };
    return {
      queryKey: ['roadsheet-shares', k] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: Share[] }>(
          `/api/performances/${encodeURIComponent(k.slug)}/roadsheet/shares?ws=${encodeURIComponent(k.ws)}`,
          signal,
        ),
    };
  });
  const sharesQuery = createQuery(sharesOptions);
  let shares = $derived($sharesQuery.data?.items ?? []);

  let shareRole = $state<(typeof PUBLIC_ROLES)[number]>('tech_manager');

  const createShare = createMutation({
    mutationFn: () =>
      mutateJSON(
        'POST',
        `/api/performances/${encodeURIComponent(slug)}/roadsheet/shares?ws=${encodeURIComponent(workspaceSlug)}`,
        { role: shareRole },
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
  <title>{sheet ? `${sheet.title} — ${t('roadsheet.title', locale)}` : t('roadsheet.title', locale)} — Hour</title>
</svelte:head>

<article class="rs" aria-busy={loading}>
  <nav class="rs__roles" aria-label={t('roadsheet.preview_as', locale)}>
    <span class="rs__roles-label">{t('roadsheet.view_as', locale)}</span>
    {#each ROADSHEET_ROLES as r (r)}
      <Pill size="sm" active={role === r} onclick={() => (role = r)}>
        {roleWord(r)}
      </Pill>
    {/each}
  </nav>

  {#if loading}
    <p class="rs__state">{t('desk.loading', locale)}</p>
  {:else if errorMsg}
    <p class="rs__state rs__state--danger">{errorMsg}</p>
  {:else if sheet}
    <RoadsheetView {sheet} {venueTz} {locale} backHref={`/h/${workspaceSlug}/performance/${slug}`} />

    <section class="rs__share" aria-label={t('roadsheet.public_links', locale)}>
      <h2 class="eyebrow eyebrow--sub rs__share-title">{t('roadsheet.public_links', locale)}</h2>
      <p class="rs__share-hint">{t('roadsheet.public_links_hint', locale)}</p>
      {#if shares.length > 0}
        <ul class="rs__share-list" role="list">
          {#each shares as s (s.id)}
            <li>
              <span class="rs__share-role">{roleWord(s.role)}</span>
              <span class="rs__share-date">{dayMonthYearTs(s.created_at)}</span>
              <span class="rs__share-actions">
                <Button size="s" variant="outline" onclick={() => copyShare(s.token)}>
                  {t('roadsheet.copy_link', locale)}
                </Button>
                <Button
                  size="s"
                  variant="outline"
                  tone="warn"
                  loading={$revokeShare.isPending}
                  onclick={() => $revokeShare.mutate(s.id)}
                >
                  {t('roadsheet.revoke', locale)}
                </Button>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="rs__share-create">
        <label class="rs__share-pick">
          <span class="eyebrow eyebrow--sub">{t('roadsheet.role', locale)}</span>
          <select bind:value={shareRole}>
            {#each PUBLIC_ROLES as r (r)}
              <option value={r}>{roleWord(r)}</option>
            {/each}
          </select>
        </label>
        <Button size="s" loading={$createShare.isPending} onclick={() => $createShare.mutate()}>
          {t('roadsheet.create_link', locale)}
        </Button>
      </div>
    </section>
  {/if}
</article>

<style>
  @layer components {
    .rs {
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
    }

    .rs__roles {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      flex-wrap: wrap;
    }

    .rs__roles-label {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-faint);
    }

    .rs__state {
      padding-block: var(--space-l);
      font-size: var(--text-s);
      color: var(--text-faint);
    }
    .rs__state--danger {
      color: var(--danger);
    }

    .rs__share {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding-block-start: var(--space-l);
      border-block-start: 1px solid var(--border-color-light);
    }

    /* Sub-eyebrow typography via base.css .eyebrow--sub. */
    .rs__share-title {
      margin: 0;
    }

    .rs__share-hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .rs__share-list li {
      display: flex;
      align-items: center;
      gap: var(--space-m);
      padding-block: var(--space-xs);
      border-block-end: 1px solid var(--border-color-light);
    }

    .rs__share-role {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.04em;
      color: var(--text-color);
      min-inline-size: 7rem;
    }

    .rs__share-date {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
      flex: 1;
    }

    .rs__share-actions {
      display: flex;
      gap: var(--space-xs);
    }

    .rs__share-create {
      display: flex;
      align-items: end;
      gap: var(--space-m);
    }

    .rs__share-pick {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
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
