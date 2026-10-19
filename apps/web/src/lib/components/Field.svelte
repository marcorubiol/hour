<script lang="ts">
  /**
   * Field — the row every form value lives in (ADR-139 p4).
   *
   * The mono label in a fixed column, the control without a box, one
   * hairline under both; the same to read and to edit. `Input`, `Select`
   * and `Segmented` render through it; any other control (a textarea, a
   * picker) goes in as `children`, with the `id` the label points at.
   *
   * - `stack`: the label always on top (a textarea, a long value).
   * - `toolbar`: a filter bar's boxed control at the bar's height (M9).
   * - `group`: the label names a group (a radiogroup), so it is a span the
   *   group points at with `aria-labelledby={`${id}-label`}`, not a <label>.
   */
  import type { Snippet } from 'svelte';

  interface Props {
    /** id of the control the label names. */
    id: string;
    label?: string;
    required?: boolean;
    helper?: string;
    error?: string;
    /** Helper with markup (a link): same slot and treatment as `helper`. */
    message?: Snippet;
    stack?: boolean;
    toolbar?: boolean;
    group?: boolean;
    loading?: boolean;
    prefix?: Snippet;
    suffix?: Snippet;
    children: Snippet;
  }

  let {
    id,
    label,
    required = false,
    helper,
    error,
    message,
    stack = false,
    toolbar = false,
    group = false,
    loading = false,
    prefix,
    suffix,
    children,
  }: Props = $props();

  let hasMessage = $derived(Boolean(error || helper || message));
</script>

<div
  class="field"
  class:field--stack={stack}
  class:field--toolbar={toolbar}
  class:field--error={Boolean(error)}
  class:field--loading={loading}
>
  {#if label}
    {#if group}
      <span id="{id}-label" class="field__label">
        {label}{#if required}<span aria-hidden="true"> *</span>{/if}
      </span>
    {:else}
      <label for={id} class="field__label">
        {label}{#if required}<span aria-hidden="true"> *</span>{/if}
      </label>
    {/if}
  {/if}

  <div class="field__value">
    <div class="field__control">
      {#if prefix}<span class="field__prefix">{@render prefix()}</span>{/if}
      {@render children()}
      {#if loading}
        <span class="field__suffix" aria-hidden="true"><span class="field__spinner"></span></span>
      {:else if suffix}
        <span class="field__suffix">{@render suffix()}</span>
      {/if}
    </div>

    {#if hasMessage}
      <p id="{id}-msg" class="field__msg" role={error ? 'alert' : undefined}>
        {#if error || helper}{error ?? helper}{:else if message}{@render message()}{/if}
      </p>
    {/if}
  </div>
</div>
