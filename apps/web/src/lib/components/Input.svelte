<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';

  type InputType =
    | 'text'
    | 'email'
    | 'password'
    | 'search'
    | 'number'
    | 'tel'
    | 'url';

  interface Props {
    label?: string;
    name?: string;
    id?: string;
    type?: InputType;
    value?: string | number;
    placeholder?: string;
    helper?: string;
    error?: string;
    required?: boolean;
    disabled?: boolean;
    loading?: boolean;
    autocomplete?: HTMLInputAttributes['autocomplete'];
    autofocus?: boolean;
    oninput?: (event: Event) => void;
    onchange?: (event: Event) => void;
    prefix?: Snippet;
    suffix?: Snippet;
  }

  let {
    label,
    name,
    id,
    type = 'text',
    value = $bindable(''),
    placeholder,
    helper,
    error,
    required = false,
    disabled = false,
    loading = false,
    autocomplete,
    autofocus = false,
    oninput,
    onchange,
    prefix,
    suffix,
  }: Props = $props();

  let fieldId = $derived(
    id ?? name ?? `field-${Math.random().toString(36).slice(2, 8)}`
  );
  let isDisabled = $derived(disabled || loading);
  let hasMessage = $derived(Boolean(error || helper));
  let messageId = $derived(`${fieldId}-msg`);

  let wrapperClasses = $derived(
    ['field', error && 'field--error', loading && 'field--loading']
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
    {#if prefix}<span class="field__prefix">{@render prefix()}</span>{/if}

    <!-- svelte-ignore a11y_autofocus -->
    <input
      id={fieldId}
      {name}
      {type}
      bind:value
      {placeholder}
      {required}
      disabled={isDisabled}
      {autocomplete}
      {autofocus}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={hasMessage ? messageId : undefined}
      {oninput}
      {onchange}
    />

    {#if loading}
      <span class="field__suffix field__suffix--spinner" aria-hidden="true">
        <span class="field__spinner"></span>
      </span>
    {:else if suffix}
      <span class="field__suffix">{@render suffix()}</span>
    {/if}
  </div>

  {#if hasMessage}
    <p id={messageId} class="field__msg" role={error ? 'alert' : undefined}>
      {error ?? helper}
    </p>
  {/if}
</div>
