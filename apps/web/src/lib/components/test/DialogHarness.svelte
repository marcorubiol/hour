<script lang="ts">
  /** A dialog as the app writes one, for Dialog.svelte.test.ts: a type pill
      first, then fields, a quiet Cancel and the primary in the foot. */
  import Dialog from '../Dialog.svelte';
  import Input from '../Input.svelte';
  import Segmented from '../Segmented.svelte';

  interface Props {
    open?: boolean;
    dirty?: boolean;
    onsave?: () => void;
  }
  let { open = $bindable(true), dirty = false, onsave }: Props = $props();
  let kind = $state('a');
  let title = $state('');
</script>

<Dialog bind:open title="Harness" {dirty}>
  <Segmented ariaLabel="Kind" options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} bind:value={kind} />
  <Input id="h-title" label="Title" bind:value={title} />
  {#snippet actions()}
    <button type="button" class="btn--quiet btn--s" onclick={() => (open = false)}>Cancel</button>
    <button type="button" class="btn--primary btn--s" onclick={() => onsave?.()}>Save</button>
  {/snippet}
</Dialog>
<p data-testid="state">{open ? 'open' : 'closed'}</p>
