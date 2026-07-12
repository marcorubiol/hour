<script lang="ts">
  /**
   * Notes module (ADR-056) — the line's collaborative doc. A thin mount
   * of YNotes over the 'line' collab target: same Yjs + y-partyserver DO
   * + IndexedDB mirror as performance/project notes, write-back to
   * line.notes for non-collab readers. Content-only (the line detail page
   * owns the section frame).
   */

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
</script>

{#key line.id}
  <YNotes targetTable="line" targetId={line.id} placeholder="Line notes — shared, live." rows={6} />
{/key}
