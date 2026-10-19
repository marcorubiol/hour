<script lang="ts">
  /**
   * A PERSON PICKER that can add who is missing (ADR-107). Type a name: the
   * people it matches are offered, and a name that is nobody yet is offered
   * as «Añadir "nombre"», which creates the dossier with only that name
   * (email, phone and title wait for the person's file).
   *
   * The host decides what a pick MEANS (cast with a role, «voy» on a date):
   * the picker only hands it a person, new or not. `options` are the people
   * the host would offer; matching and creating go through `$lib/persons`,
   * so every picker agrees on when a typed name is already somebody.
   *
   * A combobox by the ARIA pattern, like PlaceField: ↑↓ move, ↵ picks while
   * the list is open, Esc closes it. The list is `styles/listbox.css`.
   */
  import { useQueryClient } from '@tanstack/svelte-query';
  import Field from '$lib/components/Field.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { t, type Locale } from '$lib/i18n';
  import { createPerson, matchPeople, type PersonOption } from '$lib/persons';

  interface Props {
    /** The people the host offers. */
    options: readonly PersonOption[];
    /** The space a new person is created in. */
    workspaceId: string;
    label: string;
    placeholder?: string;
    locale: Locale;
    disabled?: boolean;
    /** Show the label above the field (the cast form); else it is only read aloud. */
    showLabel?: boolean;
    /** The text in the field; the host clears it after using a pick. */
    text?: string;
    /** A person was chosen or created. */
    onpick: (person: PersonOption) => void;
  }

  let {
    options,
    workspaceId,
    label,
    placeholder = '',
    locale,
    disabled = false,
    showLabel = true,
    text = $bindable(''),
    onpick,
  }: Props = $props();

  const queryClient = useQueryClient();
  const uid = $props.id();
  const listId = `person-${uid}`;
  /** Enough to see who is there; typing narrows the rest. */
  const SHOWN = 8;

  let open = $state(false);
  let cur = $state(0);
  let creating = $state(false);

  let found = $derived(matchPeople(options, text));
  let shown = $derived(found.matches.slice(0, SHOWN));
  /** The rows of the list: the matches, then «Añadir» when it applies. */
  let rows = $derived<Array<PersonOption | null>>(found.canAdd ? [...shown, null] : shown);

  function openList() {
    cur = 0;
    open = rows.length > 0;
  }

  async function choose(row: PersonOption | null) {
    open = false;
    if (row) {
      text = row.full_name;
      onpick(row);
      return;
    }
    const name = text.trim();
    if (!name || creating) return;
    creating = true;
    try {
      const p = await createPerson(queryClient, workspaceId, name);
      text = p.full_name;
      onpick({ person_id: p.person_id, full_name: p.full_name });
    } catch (err) {
      addToast({
        tone: 'danger',
        title: t('people.not_added', locale),
        message: err instanceof Error ? err.message : t('perf.unexpected', locale),
      });
    } finally {
      creating = false;
    }
  }

  function keys(e: KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cur = (cur + 1) % rows.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cur = (cur - 1 + rows.length) % rows.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void choose(rows[cur]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      open = false;
    }
  }
</script>

<div class="picker">
  <Field id={`${listId}-in`} label={showLabel ? label : undefined}>
    <input
      id={`${listId}-in`}
      role="combobox"
      aria-label={showLabel ? undefined : label}
      aria-expanded={open}
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={open ? `${listId}-${cur}` : undefined}
      {placeholder}
      autocomplete="off"
      bind:value={text}
      oninput={openList}
      onfocus={openList}
      onkeydown={keys}
      onblur={() => setTimeout(() => (open = false), 120)}
      disabled={disabled || creating}
    />
  </Field>
  {#if open}
    <div class="listbox" role="listbox" id={listId} aria-label={label}>
      {#each rows as row, i (row?.person_id ?? '+')}
        <div
          class="listbox__opt"
          class:listbox__opt--cur={i === cur}
          class:picker__add={row === null}
          role="option"
          id={`${listId}-${i}`}
          aria-selected={i === cur}
          tabindex="-1"
          onmousedown={(e) => {
            e.preventDefault();
            void choose(row);
          }}
          onmouseenter={() => (cur = i)}
        >
          {#if row}{row.full_name}{:else}{t('people.add_named', locale, { name: text.trim() })}{/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  @layer components {
    .picker {
      position: relative;
      min-inline-size: 0;
    }
    /* The verb, not a person: said in the voice of the other verbs. */
    .picker__add {
      color: var(--text-muted);
    }
  }
</style>
