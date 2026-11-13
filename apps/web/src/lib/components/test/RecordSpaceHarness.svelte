<script lang="ts">
  /** Una ficha de mentira: nombra su espacio y monta la sonda. Para record-space.svelte.test.ts. */
  import { setRecordSpace } from '$lib/i18n';
  import RecordSpaceProbe from './RecordSpaceProbe.svelte';

  interface Props {
    /** Id o slug; null, una ficha que aún no sabe su espacio. */
    space: string | null;
  }
  let { space }: Props = $props();
  setRecordSpace(() => space);
</script>

<RecordSpaceProbe />
