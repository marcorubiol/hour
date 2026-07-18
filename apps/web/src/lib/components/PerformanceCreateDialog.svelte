<script module lang="ts">
  /**
   * "New performance" dialog (ADR-043) — the standalone host of the shared
   * PerformanceForm (ADR-078 §1: the form is extracted, not forked). Any
   * lens (line detail, hall) mounts this; the unified calendar create
   * dialog mounts PerformanceForm directly instead. The caller owns the
   * trigger and any preselection context (pins, current line); the form
   * owns the fields, the POST, and the cache invalidations.
   */
  export type { CreatedPerformance } from './PerformanceForm.svelte';
</script>

<script lang="ts">
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import PerformanceForm, { type CreatedPerformance } from './PerformanceForm.svelte';

  interface Props {
    open?: boolean;
    /** Preselect this project on open (applied only if none picked yet). */
    presetProjectId?: string | null;
    /** Preselect this line on open — hides the Line select entirely. */
    presetLineId?: string | null;
    /** Freeze the Project select (e.g. creating from inside a project). */
    lockProject?: boolean;
    /** ISO day to prefill on open; defaults to the viewer's today. */
    presetDate?: string | null;
    onCreated?: (perf: CreatedPerformance) => void;
  }

  let {
    open = $bindable(false),
    presetProjectId = null,
    presetLineId = null,
    lockProject = false,
    presetDate = null,
    onCreated,
  }: Props = $props();

  let form: { submit: () => void } | undefined = $state();
  let pending = $state(false);

  function handleCreated(perf: CreatedPerformance) {
    open = false;
    onCreated?.(perf);
  }
</script>

<Dialog bind:open title="New performance" size="s">
  <PerformanceForm
    bind:this={form}
    bind:pending
    {open}
    {presetProjectId}
    {presetLineId}
    {lockProject}
    {presetDate}
    onCreated={handleCreated}
  />
  {#snippet actions()}
    <Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
    <Button onclick={() => form?.submit()} loading={pending}>Create</Button>
  {/snippet}
</Dialog>
