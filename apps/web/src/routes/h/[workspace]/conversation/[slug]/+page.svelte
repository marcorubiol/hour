<script lang="ts">
  /** The conversation's page: the record itself, the same one the vistazo draws (ADR-139 p1). */
  import { page } from '$app/state';
  import ConversationRecord from '$lib/components/record/ConversationRecord.svelte';
</script>

<ConversationRecord workspaceSlug={page.params.workspace ?? ''} slug={page.params.slug ?? ''} />
