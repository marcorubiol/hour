<script lang="ts">
  /**
   * Public road sheet (ADR-047, D6) — the page behind a signed link. No
   * account, no shell: the token is the capability and the server already
   * filtered the projection to the share's pinned role. Renders the same
   * RoadsheetView as the operator page.
   */

  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import RoadsheetView from '$lib/components/RoadsheetView.svelte';
  import type { Roadsheet } from '$lib/roadsheet';

  type Response = { roadsheet: Roadsheet; venue_timezone: string | null };

  let token = $derived(page.params.token ?? '');

  async function fetchPublic(url: string, signal: AbortSignal): Promise<Response> {
    const res = await fetch(url, { signal });
    if (res.status === 404) throw new Error('gone');
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return (await res.json()) as Response;
  }

  const queryOptions = toStore(() => {
    const k = token;
    return {
      queryKey: ['public-roadsheet', k] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchPublic(`/api/public/roadsheet/${encodeURIComponent(k)}`, signal),
      retry: false,
    };
  });
  const query = createQuery(queryOptions);

  let sheet = $derived($query.data?.roadsheet ?? null);
  let venueTz = $derived($query.data?.venue_timezone ?? null);
  let loading = $derived($query.isPending);
  let gone = $derived($query.error instanceof Error && $query.error.message === 'gone');
  let errorMsg = $derived(
    $query.error instanceof Error && $query.error.message !== 'gone'
      ? $query.error.message
      : '',
  );
</script>

<svelte:head>
  <title>{sheet ? `${sheet.title} — Road sheet` : 'Road sheet'} — Hour</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="prs">
  {#if loading}
    <p class="prs__state">Loading…</p>
  {:else if gone}
    <div class="prs__gone">
      <h1>This link is no longer active</h1>
      <p>Ask whoever sent it for a fresh one.</p>
    </div>
  {:else if errorMsg}
    <p class="prs__state prs__state--danger">{errorMsg}</p>
  {:else if sheet}
    <RoadsheetView {sheet} {venueTz} />
  {/if}
</main>

<style>
  @layer components {
    .prs {
      max-inline-size: 40rem;
      margin-inline: auto;
      padding: var(--space-l) var(--space-m) var(--space-2xl);
    }

    .prs__state {
      padding-block: var(--space-l);
      font-size: var(--text-s);
      color: var(--text-faint);
    }
    .prs__state--danger {
      color: var(--danger);
    }

    .prs__gone {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding-block: var(--space-2xl);
      text-align: center;
    }

    .prs__gone h1 {
      font-family: var(--font-display);
      font-size: clamp(1.4rem, 3vw, 1.8rem);
      font-weight: 400;
      color: var(--text-color);
    }

    .prs__gone p {
      font-size: var(--text-s);
      color: var(--text-muted);
    }

    @media print {
      .prs {
        max-inline-size: none;
      }
    }
  }
</style>
