<script lang="ts" module>
  export type SegmentedOption<T extends string = string> = {
    value: T;
    label: string;
    disabled?: boolean;
  };
</script>

<script lang="ts" generics="V extends string">
  /**
   * Segmented — choosing ONE value among a FEW (ADR-139 p4): type,
   * direction, certainty, a setting. For many options, `Select`.
   *
   * Native radios underneath, so the group is one Tab stop, the arrows
   * move and choose, and a screen reader hears a named radiogroup. With
   * `label` it sits in a field row like any other value; without one it
   * stands alone and `ariaLabel` names it.
   */
  import Field from './Field.svelte';

  interface Props {
    options: SegmentedOption<V>[];
    value?: V;
    label?: string;
    ariaLabel?: string;
    name?: string;
    id?: string;
    helper?: string;
    disabled?: boolean;
    onchange?: (value: V) => void;
  }

  let {
    options,
    value = $bindable(),
    label,
    ariaLabel,
    name,
    id,
    helper,
    disabled = false,
    onchange,
  }: Props = $props();

  let groupId = $derived(id ?? `seg-${Math.random().toString(36).slice(2, 8)}`);
  let groupName = $derived(name ?? groupId);

  function choose(next: V) {
    value = next;
    onchange?.(next);
  }
</script>

{#snippet track()}
  <div
    class="seg"
    role="radiogroup"
    id={groupId}
    aria-labelledby={label ? `${groupId}-label` : undefined}
    aria-label={label ? undefined : ariaLabel}
    aria-describedby={label && helper ? `${groupId}-msg` : undefined}
  >
    {#each options as opt (opt.value)}
      <label class="seg__opt">
        <input
          class="seg__input"
          type="radio"
          name={groupName}
          value={opt.value}
          checked={value === opt.value}
          disabled={disabled || opt.disabled}
          onchange={() => choose(opt.value)}
        />
        {opt.label}
      </label>
    {/each}
  </div>
{/snippet}

{#if label}
  <Field id={groupId} {label} {helper} group>
    {@render track()}
  </Field>
{:else}
  {@render track()}
{/if}
