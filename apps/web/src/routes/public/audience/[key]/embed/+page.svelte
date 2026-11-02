<script lang="ts">
  import AudienceForm from '$lib/components/audience/AudienceForm.svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<AudienceForm {data} {form} />
