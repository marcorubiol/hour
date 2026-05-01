<script lang="ts">
  import type { Snippet } from 'svelte';

  export type SelectOption = {
    value: string;
    label: string;
    disabled?: boolean;
  };

  interface Props {
    label?: string;
    name?: string;
    id?: string;
    value?: string;
    options?: SelectOption[];
    placeholder?: string;
    helper?: string;
    error?: string;
    required?: boolean;
    disabled?: boolean;
    onchange?: (event: Event) => void;
    children?: Snippet;
  }

  let {
    label,
    name,
    id,
    value = $bindable(''),
    options,
    placeholder,
    helper,
    error,
    required = false,
    disabled = false,
    onchange,
    children,
  }: Props = $props();

  let fieldId = $derived(
    id ?? name ?? `field-${Math.random().toString(36).slice(2, 8)}`
  );
  let hasMessage = $derived(Boolean(error || helper));
  let messageId = $derived(`${fieldId}-msg`);

  let wrapperClasses = $derived(
    ['field', 'field--select', error && 'field--error']
      .filter(Boolean)
      .join(' ')
  );
</script>

<div class={wrapperClasses}>
  {#if label}
    <label for={fieldId}>
      {label}{#if required}<span aria-hidden="true"> *</span>{/if}
    </label>
  {/if}

  <div class="field__control">
    <select
      id={fieldId}
      {name}
      bind:value
      {required}
      {disabled}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={hasMessage ? messageId : undefined}
      {onchange}
    >
      {#if placeholder}
        <option value="" disabled hidden>{placeholder}</option>
      {/if}
      {#if children}
        {@render children()}
      {:else if options}
        {#each options as opt (opt.value)}
          <option value={opt.value} disabled={opt.disabled}>{opt.label}</option>
        {/each}
      {/if}
    </select>
  </div>

  {#if hasMessage}
    <p id={messageId} class="field__msg" role={error ? 'alert' : undefined}>
      {error ?? helper}
    </p>
  {/if}
</div>
