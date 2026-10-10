<script lang="ts">
  /**
   * Calendar feed links (ADR-054) — the ICS feed-shares dialog behind the
   * planner toolbar's "⋯" menu. Owns its workspace pick, the shares query
   * and the create/revoke mutations; the page only holds the open flag.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { copyText } from '$lib/clipboard';
  import { spaceName } from '$lib/utils/identity';
  import { appLocale, t } from '$lib/i18n';

  const locale = appLocale();

  type FeedShare = { id: string; token: string; workspace_id: string; created_at: string };

  interface Props {
    open: boolean;
    /** Workspaces for the Select — the first one is the default pick. */
    workspaces: Array<{ id: string; name: string }>;
  }

  let { open = $bindable(), workspaces }: Props = $props();

  const queryClient = useQueryClient();

  // The user's explicit pick; until there is one, the default (first)
  // workspace applies — the same default the page used to set on open.
  let chosenWs = $state<string | null>(null);
  let feedWs = $derived(chosenWs ?? workspaces[0]?.id ?? '');

  let feedWsOptions = $derived(
    workspaces.map((w) => ({ value: w.id, label: spaceName(w.name) })),
  );

  const feedSharesOptions = toStore(() => {
    const ws = feedWs;
    return {
      queryKey: ['calendar-shares', ws] as const,
      enabled: open && Boolean(ws),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ items: FeedShare[] }>(
          `/api/calendar-shares?workspace_id=${encodeURIComponent(ws)}`,
          signal,
        ),
    };
  });
  const feedSharesQuery = createQuery(feedSharesOptions);
  let feedShares = $derived($feedSharesQuery.data?.items ?? []);

  function feedUrl(token: string): string {
    return `${location.origin}/api/public/calendar/${token}`;
  }

  async function copyFeedUrl(token: string, scheme: 'https' | 'webcal') {
    const url =
      scheme === 'webcal' ? feedUrl(token).replace(/^https?:/, 'webcal:') : feedUrl(token);
    addToast(
      (await copyText(url))
        ? {
            tone: 'success',
            message: t('planner.feed_copied', locale, { scheme: scheme === 'webcal' ? 'webcal' : 'https' }),
          }
        : { tone: 'danger', message: t('planner.feed_copy_error', locale) },
    );
  }

  const createFeed = createMutation({
    mutationFn: () =>
      mutateJSON<{ share: FeedShare }>('POST', '/api/calendar-shares', {
        workspace_id: feedWs,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['calendar-shares'] });
      addToast({ tone: 'success', message: t('planner.feed_created', locale) });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('planner.feed_not_created', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });

  const revokeFeed = createMutation({
    mutationFn: (id: string) => mutateJSON('DELETE', `/api/calendar-shares/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['calendar-shares'] });
      addToast({ tone: 'success', message: t('planner.feed_revoked', locale) });
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('planner.feed_not_revoked', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    },
  });
</script>

<Dialog bind:open title={t('planner.feed_title', locale)} size="m">
  <p class="cal__feed-hint">
    {t('planner.feed_hint', locale)}
  </p>
  <Select label={t('planner.feed_workspace', locale)} options={feedWsOptions} bind:value={() => feedWs, (v) => (chosenWs = v)} />
  {#if $feedSharesQuery.isPending && feedWs}
    <p class="cal__feed-hint">{t('desk.loading', locale)}</p>
  {:else if feedShares.length === 0}
    <p class="cal__feed-hint">{t('planner.feed_empty', locale)}</p>
  {:else}
    <ul class="cal__feed-list" role="list">
      {#each feedShares as share (share.id)}
        <li class="cal__feed-row">
          <code class="cal__feed-token">…{share.token.slice(-8)}</code>
          <Button variant="outline" size="xs" onclick={() => copyFeedUrl(share.token, 'https')}>
            {t('planner.feed_copy_link', locale)}
          </Button>
          <Button variant="outline" size="xs" onclick={() => copyFeedUrl(share.token, 'webcal')}>
            {t('planner.feed_copy_webcal', locale)}
          </Button>
          <Button
            variant="outline"
            tone="warn"
            size="xs"
            loading={$revokeFeed.isPending}
            onclick={() => $revokeFeed.mutate(share.id)}
          >
            {t('planner.feed_revoke', locale)}
          </Button>
        </li>
      {/each}
    </ul>
  {/if}
  {#snippet actions()}
    <Button variant="outline" onclick={() => (open = false)}>{t('planner.feed_close', locale)}</Button>
    <Button
      onclick={() => $createFeed.mutate()}
      loading={$createFeed.isPending}
      disabled={!feedWs}
    >
      {t('planner.feed_new', locale)}
    </Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .cal__feed-hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .cal__feed-list {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      margin-block-start: var(--space-s);
    }

    .cal__feed-row {
      display: flex;
      align-items: center;
      gap: var(--space-s);
      padding-block: var(--space-xs);
      border-block-end: 1px solid var(--border-color-light);
    }

    .cal__feed-token {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
      flex: 1;
    }
  }
</style>
