<script lang="ts">
  /** A one-line value in a field row (ADR-139 p4); `toolbar` for a filter bar. */
  import type { Snippet } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';
  import Field from './Field.svelte';

  type InputType =
    | 'text'
    | 'email'
    | 'password'
    | 'search'
    | 'number'
    | 'tel'
    | 'url'
    | 'date'
    | 'time'
    | 'datetime-local';

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
    /** id of a <datalist> the input completes from (native suggestions). */
    list?: string;
    autofocus?: boolean;
    oninput?: (event: Event) => void;
    onchange?: (event: Event) => void;
    prefix?: Snippet;
    suffix?: Snippet;
    /** A filter bar's boxed control (first level, diseño M9). */
    toolbar?: boolean;
    min?: string | number;
    max?: string | number;
    step?: string | number;
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
    list,
    autofocus = false,
    oninput,
    onchange,
    prefix,
    suffix,
    toolbar = false,
    min,
    max,
    step,
  }: Props = $props();

  let fieldId = $derived(
    id ?? name ?? `field-${Math.random().toString(36).slice(2, 8)}`
  );
  let isDisabled = $derived(disabled || loading);
  let hasMessage = $derived(Boolean(error || helper));
  let messageId = $derived(`${fieldId}-msg`);
</script>

<Field id={fieldId} {label} {required} {helper} {error} {loading} {toolbar} {prefix} {suffix}>
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
    {list}
    {autofocus}
    {min}
    {max}
    {step}
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={hasMessage ? messageId : undefined}
    {oninput}
    {onchange}
  />
</Field>
