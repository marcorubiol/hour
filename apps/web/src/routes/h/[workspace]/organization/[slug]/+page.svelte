<script lang="ts">
  /** The organization's page: the record itself, the same one the vistazo draws (ADR-139 p1, ADR-156). */
  import { page } from '$app/state';
  import OrganizationRecord from '$lib/components/record/OrganizationRecord.svelte';
</script>

<OrganizationRecord workspaceSlug={page.params.workspace ?? ''} slug={page.params.slug ?? ''} />
