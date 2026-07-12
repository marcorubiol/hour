<script lang="ts">
  /**
   * Notes module (ADR-056) — the line's collaborative doc. A thin mount
   * of YNotes over the 'line' collab target: same Yjs + y-partyserver DO
   * + IndexedDB mirror as performance/project notes, write-back to
   * line.notes for non-collab readers. Content-only (the line detail page
   * owns the section frame).
   *
   * Permission preflight (review 2026-07-12): the socket gate is
   * has_permission(project, 'edit:project_meta') — but line_select RLS
   * shows lines to edit:show-only roles too (director, author,
   * technical_director). Without this check YNotes would render a live
   * textarea whose WS upgrade 403s forever: the user types, the edits sit
   * in IndexedDB, "offline — edits sync on reconnect" lies. Same check
   * the server runs, asked up front; on deny we say so instead.
   */

  import { createQuery } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { env } from '$env/dynamic/public';
  import YNotes from '$lib/components/YNotes.svelte';

  interface Props {
    line: {
      id: string;
      slug: string | null;
      name: string;
      kind: string;
      project_id: string;
      workspace_id: string;
    };
    workspaceSlug: string;
  }

  let { line }: Props = $props();

  async function canEditProjectMeta(projectId: string, signal: AbortSignal): Promise<boolean> {
    const jwt = localStorage.getItem('hour_jwt');
    if (!jwt || !env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_ANON_KEY) return false;
    const res = await fetch(new URL('/rest/v1/rpc/has_permission', env.PUBLIC_SUPABASE_URL), {
      method: 'POST',
      signal,
      headers: {
        apikey: env.PUBLIC_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${jwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_project_id: projectId, p_perm: 'edit:project_meta' }),
    });
    // A transient failure must NOT cache as "no permission" (review
    // 2026-07-12) — throw so the query retries and shows its own state.
    if (!res.ok) throw new Error(`has_permission ${res.status}`);
    return (await res.json()) === true;
  }

  const permOptions = toStore(() => {
    const projectId = line.project_id;
    return {
      queryKey: ['line-notes-perm', projectId] as const,
      staleTime: 5 * 60 * 1000,
      queryFn: ({ signal }: { signal: AbortSignal }) => canEditProjectMeta(projectId, signal),
    };
  });
  const permQuery = createQuery(permOptions);
</script>

{#if $permQuery.isPending}
  <p class="lnm__state">Loading…</p>
{:else if $permQuery.isError}
  <p class="lnm__state">Couldn't check notes access — reload to retry.</p>
{:else if $permQuery.data === true}
  {#key line.id}
    <YNotes targetTable="line" targetId={line.id} placeholder="Line notes — shared, live." rows={6} />
  {/key}
{:else}
  <p class="lnm__state">
    Line notes need the project-meta permission — ask a project admin.
  </p>
{/if}

<style>
  @layer components {
    .lnm__state {
      margin: 0;
      font-size: var(--text-s);
      color: var(--text-faint);
    }
  }
</style>
