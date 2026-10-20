<script lang="ts">
  /**
   * The next step of a conversation: a day and a note (ADR-040). One dialog
   * for the list and the file (ADR-126 § 5). It edits a draft and hands it to
   * `onsave`; the caller owns the write.
   */
  import Button from '$lib/components/Button.svelte';
  import Textarea from './Textarea.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Field from '$lib/components/Field.svelte';
  import { t, type Locale } from '$lib/i18n';
  import { localeDayMonth } from '$lib/datetime';
  import { nextStepShortcuts } from '$lib/next-step';

  interface Props {
    open: boolean;
    /** The line that says whose step it is: the organization, and its contact. */
    who: string;
    /** YYYY-MM-DD or empty; read when the dialog opens. */
    date: string;
    note: string;
    locale: Locale;
    onsave: (next: { next_action_at: string | null; next_action_note: string | null }) => void;
    onclose?: () => void;
  }

  let { open = $bindable(), who, date, note, locale, onsave, onclose }: Props = $props();

  let formDate = $state('');
  let formNote = $state('');
  // The days a next step almost always lands on, read when it opens.
  let shortcuts = $state(nextStepShortcuts());
  // A fresh draft each time it opens: nothing typed and cancelled rides along.
  $effect(() => {
    if (open) {
      formDate = date;
      formNote = note;
      shortcuts = nextStepShortcuts();
    }
  });

  function shortcutLabel(s: (typeof shortcuts)[number]): string {
    return s.key === 'next_month' ? localeDayMonth(s.day, locale) : t(`conversations.next_${s.key}`, locale);
  }

  function save() {
    onsave({ next_action_at: formDate || null, next_action_note: formNote.trim() || null });
    open = false;
  }
</script>

<Dialog bind:open title={t('conversations.col_next_action', locale)} size="s" {onclose}>
  <p class="next-action-who">{who}</p>
  <Field id="next-action-date" label={t('perf.date', locale)}>
    <input id="next-action-date" type="date" bind:value={formDate} />
    <!-- One tap for the usual days (Things' «When», Superhuman's «Remind
         me»); the field stays for any other. -->
    {#snippet message()}
      <span class="next-action-days" role="group" aria-label={t('conversations.next_days_aria', locale)}>
        {#each shortcuts as s (s.key)}
          <button
            type="button"
            class="btn--quiet btn--xs"
            aria-pressed={formDate === s.day}
            onclick={() => (formDate = s.day)}>{shortcutLabel(s)}</button
          >
        {/each}
      </span>
    {/snippet}
  </Field>
  <Textarea
    id="next-action-note"
    label={t('blackout.note', locale)}
    rows={3}
    maxlength={500}
    bind:value={formNote}
    placeholder={t('conversations.next_move_ph', locale)}
  />
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={save}>{t('blackout.save', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .next-action-who {
      font-size: var(--text-s);
      color: var(--text-muted);
    }
    .next-action-days {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2xs);
    }
    /* «Mañana» starts on the value's left edge, where the date does. */
    .next-action-days > :first-child {
      padding-inline-start: 0;
    }
    .next-action-days > [aria-pressed='true'] {
      --btn-text-color: var(--text-color);
    }
  }
</style>
