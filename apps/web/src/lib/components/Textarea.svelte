<script lang="ts">
  /**
   * Textarea — a long value in a field row (ADR-139 p4). The label sits on
   * top (a paragraph does not fit the label column) and the text has no
   * box, like every other value. `counter` shows the count against `maxlength`.
   */
  import Field from './Field.svelte';

  interface Props {
    label?: string;
    name?: string;
    id?: string;
    value?: string;
    placeholder?: string;
    rows?: number;
    maxlength?: number;
    /** Show «12 / 280» as the helper. */
    counter?: boolean;
    helper?: string;
    error?: string;
    required?: boolean;
    disabled?: boolean;
    readonly?: boolean;
    autofocus?: boolean;
    /** Accessible name when the textarea has no visible label. */
    ariaLabel?: string;
    oninput?: (event: Event) => void;
    onblur?: (event: FocusEvent) => void;
    onkeydown?: (event: KeyboardEvent) => void;
  }

  let {
    label,
    name,
    id,
    value = $bindable(''),
    placeholder,
    rows = 3,
    maxlength,
    counter = false,
    helper,
    error,
    required = false,
    disabled = false,
    readonly = false,
    autofocus = false,
    ariaLabel,
    oninput,
    onblur,
    onkeydown,
  }: Props = $props();

  let fieldId = $derived(
    id ?? name ?? `field-${Math.random().toString(36).slice(2, 8)}`
  );
  let count = $derived(counter && maxlength ? `${(value ?? '').length} / ${maxlength}` : undefined);
  let shown = $derived(error ?? helper ?? count);
</script>

<Field id={fieldId} {label} {required} helper={error ? undefined : (helper ?? count)} {error} stack>
  <!-- svelte-ignore a11y_autofocus -->
  <textarea
    id={fieldId}
    {name}
    bind:value
    {placeholder}
    {rows}
    {maxlength}
    {required}
    {disabled}
    {readonly}
    {autofocus}
    aria-label={ariaLabel}
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={shown ? `${fieldId}-msg` : undefined}
    {oninput}
    {onblur}
    {onkeydown}
  ></textarea>
</Field>
