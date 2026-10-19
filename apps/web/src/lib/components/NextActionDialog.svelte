<script lang="ts">
  /**
   * The next step of a conversation: a day and a note (ADR-040). One dialog
   * for the list and the file (ADR-126 § 5). It edits a draft and hands it to
   * `onsave`; the caller owns the write.
   */
  import Button from '$lib/components/Button.svelte';
  import Textarea from './Textarea.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import { t, type Locale } from '$lib/i18n';

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
  // A fresh draft each time it opens: nothing typed and cancelled rides along.
  $effect(() => {
    if (open) {
      formDate = date;
      formNote = note;
    }
  });

  function save() {
    onsave({ next_action_at: formDate || null, next_action_note: formNote.trim() || null });
    open = false;
  }
</script>

<Dialog bind:open title={t('conversations.col_next_action', locale)} size="s" {onclose}>
  <p class="next-action-who">{who}</p>
  <Input label={t('perf.date', locale)} type="date" bind:value={formDate} />
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
  }
</style>
