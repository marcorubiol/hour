<script lang="ts">
  interface Props {
    label?: string;
    name: string;
    value: string;
    group?: string | null;
    disabled?: boolean;
    onchange?: (event: Event) => void;
  }

  let {
    label,
    name,
    value,
    group = $bindable(null),
    disabled = false,
    onchange,
  }: Props = $props();

  let fieldId = $derived(`radio-${Math.random().toString(36).slice(2, 8)}`);

  let containerClasses = $derived(
    ['check', 'check--radio', disabled && 'check--disabled']
      .filter(Boolean)
      .join(' ')
  );
</script>

<div class={containerClasses}>
  <label class="check__row">
    <input
      id={fieldId}
      type="radio"
      class="check__input"
      {name}
      {value}
      bind:group
      {disabled}
      {onchange}
    />
    <span class="check__box" aria-hidden="true"></span>
    {#if label}<span class="check__label">{label}</span>{/if}
  </label>
</div>
