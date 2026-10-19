<script lang="ts">
  /**
   * The one box (ADR-139 p4): in a dialog, a list, a row. Drawn in em of
   * its label's size. Without a visible label, `ariaLabel` names it, or an
   * outside <label for={id}> does (a row whose name is the label).
   */
  interface Props {
    label?: string;
    id?: string;
    ariaLabel?: string;
    name?: string;
    value?: string;
    checked?: boolean;
    indeterminate?: boolean;
    disabled?: boolean;
    error?: string;
    helper?: string;
    onchange?: (event: Event) => void;
  }

  let {
    label,
    id,
    ariaLabel,
    name,
    value,
    checked = $bindable(false),
    indeterminate = false,
    disabled = false,
    error,
    helper,
    onchange,
  }: Props = $props();

  let inputEl: HTMLInputElement | undefined = $state();
  let fieldId = $derived(id ?? `check-${Math.random().toString(36).slice(2, 8)}`);
  let hasMessage = $derived(Boolean(error || helper));
  let messageId = $derived(`${fieldId}-msg`);

  let containerClasses = $derived(
    ['check', error && 'check--error', disabled && 'check--disabled']
      .filter(Boolean)
      .join(' ')
  );

  // indeterminate is a DOM property, not an HTML attribute — set via effect
  $effect(() => {
    if (inputEl) inputEl.indeterminate = indeterminate;
  });
</script>

<div class={containerClasses}>
  <label class="check__row">
    <input
      bind:this={inputEl}
      id={fieldId}
      type="checkbox"
      class="check__input"
      {name}
      {value}
      bind:checked
      {disabled}
      aria-label={ariaLabel}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={hasMessage ? messageId : undefined}
      {onchange}
    />
    <span class="check__box" aria-hidden="true"></span>
    {#if label}<span class="check__label">{label}</span>{/if}
  </label>

  {#if hasMessage}
    <p id={messageId} class="check__msg" role={error ? 'alert' : undefined}>
      {error ?? helper}
    </p>
  {/if}
</div>
