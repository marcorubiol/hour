<script lang="ts">
  /**
   * JsonKVEdit — one of a performance's production columns (logistics,
   * hospitality, technical), written a line at a time (Marco, 2026-10-20).
   *
   * Each line is a `Field` row (ADR-139 p4): the key in the mono column, the
   * value without a box, the same to read and to write. It saves IN PLACE
   * (ADR-139 p7): a value writes when it loses focus or on Enter, a line goes
   * with «quitar», and «guardado» says it at the row's end. No button to
   * save, so no mixing of the two models. A failed write is said under its
   * row, never as a toast.
   *
   * «+ añadir línea» opens a key and a value; Enter or leaving the pair
   * writes it, Esc or leaving it empty drops it. A nested value already on
   * file is read through `JsonKV` and only removable: what a person cannot
   * type is not offered as text. A column that is not an object at all is
   * read, not edited (`kvObject`).
   */
  import type { Json } from '$lib/db-types';
  import { t, type Locale } from '$lib/i18n';
  import { SaveFlash } from '$lib/save-flash.svelte';
  import {
    KV_KEY_MAX,
    KV_VALUE_MAX,
    kvAdd,
    kvIsScalar,
    kvObject,
    kvRemove,
    kvSet,
    kvText,
    type KVObject,
  } from '$lib/kv-lines';
  import BlockHead from './BlockHead.svelte';
  import EmptyLine from './EmptyLine.svelte';
  import Field from './Field.svelte';
  import JsonKV from './JsonKV.svelte';

  interface Props {
    /** The block's name: «Logística», «Acogida», «Técnica». */
    title: string;
    value: Json;
    /** Unique per column on the page: the rows' ids hang from it. */
    idBase: string;
    /** Writes the whole object; throws when it was not kept. */
    save: (next: KVObject) => Promise<void>;
    locale: Locale;
  }

  let { title, value, idBase, save, locale }: Props = $props();

  /** What the last write left, until the read catches up with it. */
  let local = $state<KVObject | null>(null);
  $effect(() => {
    void value;
    local = null;
  });

  let source = $derived(kvObject(value));
  let obj = $derived(local ?? source ?? {});
  let entries = $derived(Object.entries(obj));

  const saved = new SaveFlash();
  let busy = $state(false);
  /** The error under one row, by key ('' is the new line). */
  let errorKey = $state<string | null>(null);
  let errorText = $state('');

  function label(key: string): string {
    return key.replace(/_/g, ' ');
  }

  async function write(next: KVObject, key: string): Promise<boolean> {
    busy = true;
    errorKey = null;
    try {
      await save(next);
      local = next;
      saved.show(key);
      return true;
    } catch (err) {
      errorKey = key;
      errorText = `${t('edit.not_saved', locale)}: ${err instanceof Error ? err.message : t('perf.unexpected', locale)}`;
      return false;
    } finally {
      busy = false;
    }
  }

  function commitValue(key: string, el: HTMLInputElement) {
    const next = kvSet(obj, key, el.value);
    if (next) void write(next, key);
  }

  function remove(key: string) {
    void write(kvRemove(obj, key), key);
  }

  // ── The new line ────────────────────────────────────────────────────────
  let adding = $state(false);
  let newKey = $state('');
  let newValue = $state('');
  let draftEl = $state<HTMLDivElement | null>(null);

  function startAdd() {
    adding = true;
    newKey = '';
    newValue = '';
    errorKey = null;
    queueMicrotask(() => document.getElementById(`${idBase}-new-key`)?.focus());
  }

  function cancelAdd() {
    adding = false;
    if (errorKey === '') errorKey = null;
  }

  async function commitAdd() {
    if (busy) return;
    if (!newKey.trim() && !newValue.trim()) {
      cancelAdd();
      return;
    }
    const r = kvAdd(obj, newKey, newValue);
    if (!r.ok) {
      errorKey = '';
      errorText = t(`perf.kv_${r.error}`, locale);
      return;
    }
    if (await write(r.next, r.key)) adding = false;
  }

  function onDraftKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commitAdd();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelAdd();
    }
  }

  /** Leaving the pair (not moving from the key to the value) writes it. */
  function onDraftOut(e: FocusEvent) {
    const to = e.relatedTarget as Node | null;
    if (to && draftEl?.contains(to)) return;
    void commitAdd();
  }
</script>

<section class="kv-edit" aria-label={title} data-testid={`${idBase}`}>
  {#if source === null}
    <!-- Not an object (a list, a word): read as it is, never rewritten. -->
    <BlockHead {title} level={3} />
    <JsonKV {value} />
  {:else if entries.length === 0 && !adding}
    <EmptyLine label={title} text={t('perf.kv_empty', locale)}>
      <button type="button" class="empty-line__act" onclick={startAdd}>{t('perf.kv_add', locale)}</button>
    </EmptyLine>
  {:else}
    <BlockHead {title} level={3}>
      {#if !adding}
        <button type="button" class="block-head__act" onclick={startAdd}>{t('perf.kv_add', locale)}</button>
      {/if}
    </BlockHead>

    <div class="kv-edit__rows">
      {#each entries as [key, val], i (key)}
        {@const id = `${idBase}-${i}`}
        <Field
          {id}
          label={label(key)}
          saved={saved.is(key)}
          error={errorKey === key ? errorText : undefined}
        >
          {#if kvIsScalar(val)}
            <input
              {id}
              type="text"
              value={kvText(val)}
              maxlength={KV_VALUE_MAX}
              disabled={busy}
              onblur={(e) => commitValue(key, e.currentTarget)}
              onkeydown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          {:else}
            <div {id} class="kv-edit__nested"><JsonKV value={val} /></div>
          {/if}
          {#snippet suffix()}
            <button
              type="button"
              class="kv-edit__remove"
              disabled={busy}
              aria-label={t('perf.kv_remove_label', locale, { key: label(key) })}
              onclick={() => remove(key)}>{t('perf.kv_remove', locale)}</button
            >
          {/snippet}
        </Field>
      {/each}

      {#if adding}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="kv-edit__draft" bind:this={draftEl} onfocusout={onDraftOut} onkeydown={onDraftKey}>
          <Field id="{idBase}-new-key" label={t('perf.kv_key', locale)}>
            <input id="{idBase}-new-key" type="text" bind:value={newKey} maxlength={KV_KEY_MAX} disabled={busy} />
          </Field>
          <Field
            id="{idBase}-new-value"
            label={t('perf.kv_value', locale)}
            error={errorKey === '' ? errorText : undefined}
          >
            <input id="{idBase}-new-value" type="text" bind:value={newValue} maxlength={KV_VALUE_MAX} disabled={busy} />
          </Field>
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  @layer components {
    .kv-edit {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    /* Field rows, one under the other (ADR-139 p4). */
    .kv-edit__rows,
    .kv-edit__draft {
      display: flex;
      flex-direction: column;
    }
    .kv-edit__nested {
      min-inline-size: 0;
      flex: 1;
    }
    /* «quitar»: the row's quiet word, at its end, the block's action voice. */
    .kv-edit__remove {
      appearance: none;
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      font-size: var(--text-xs);
      color: var(--text-faint);
      cursor: pointer;
    }
    .kv-edit__remove:hover {
      color: var(--danger);
    }
    .kv-edit__remove:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: var(--focus-offset);
    }
    .kv-edit__remove:disabled {
      cursor: default;
    }
  }
</style>
