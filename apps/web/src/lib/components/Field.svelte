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
   *
   * An error lives HERE, under its value (ADR-139 p7): never the browser's
   * bubble, never a toast in a corner. `error` is the form's own word; a
   * native constraint (`required`, `type="email"`, `min`) that fails on
   * submit is caught here too, its bubble cancelled, and said in Hour's
   * voice under the field, with the caret taken to the first one. Typing
   * clears it.
   *
   * `saved`: an in-place value (one that writes on its own, no dialog)
   * says «guardado» at the row's end for a moment. See `save-flash`.
   */
  import type { Snippet } from 'svelte';
  import { appLocale, t } from '$lib/i18n';
  import { claimInvalidFocus } from '$lib/field-validity';
  import SavedMark from './SavedMark.svelte';

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
    /** Show «guardado» at the row's end (an in-place save just landed). */
    saved?: boolean;
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
    saved = false,
    prefix,
    suffix,
    children,
  }: Props = $props();

  const locale = appLocale();

  /** A native constraint that failed on submit, in Hour's words. */
  let nativeError = $state<string | null>(null);
  let shownError = $derived(error ?? nativeError ?? undefined);
  let hasMessage = $derived(Boolean(shownError || helper || message));

  function messageFor(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
    const v = el.validity;
    if (v.valueMissing) return t('form.required', locale);
    if (v.typeMismatch && el.type === 'email') return t('form.invalid_email', locale);
    return t('form.invalid', locale);
  }

  function handleInvalid(event: Event) {
    const el = event.target;
    if (
      !(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)
    ) {
      return;
    }
    event.preventDefault(); // no bubble: the message is ours, below
    nativeError = messageFor(el);
    if (claimInvalidFocus()) el.focus();
  }

  function clearNative() {
    nativeError = null;
  }
</script>

<div
  class="field"
  class:field--stack={stack}
  class:field--toolbar={toolbar}
  class:field--error={Boolean(shownError)}
  class:field--loading={loading}
  oninvalidcapture={handleInvalid}
  oninputcapture={clearNative}
  onchangecapture={clearNative}
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
      {#if saved}<SavedMark shown />{/if}
    </div>

    {#if hasMessage}
      <p id="{id}-msg" class="field__msg" role={shownError ? 'alert' : undefined}>
        {#if shownError || helper}{shownError ?? helper}{:else if message}{@render message()}{/if}
      </p>
    {/if}
  </div>
</div>
