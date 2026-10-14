<script module lang="ts">
  import { addToast } from '$lib/components/Toast.svelte';
  import { t, type Locale } from '$lib/i18n';

  /** Cmd/Ctrl+Intro envía; Intro solo es un salto de línea (un mensaje puede ser una lista). */
  export function sendOnModEnter(event: KeyboardEvent, action: () => void) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      action();
    }
  }

  /** Lo que no salió, dicho una vez y con el error. */
  export function messageFailed(err: unknown, titleKey: string, locale: Locale) {
    addToast({
      tone: 'danger',
      title: t(titleKey, locale),
      message: t('perf.try_again', locale, {
        error: err instanceof Error ? err.message : t('perf.unexpected', locale),
      }),
    });
  }
</script>

<script lang="ts">
  /**
   * MessageItem: un mensaje de un hilo interno (ADR-106) en su lista. Autor,
   * hora, si se editó, de qué habla (una función del bolo) o qué es (la marca
   * «Solo el equipo» de la vista «hilo» de una conversación), y el texto. Lo
   * propio se corrige o se borra desde su menú.
   *
   * Es un `<li>`: lo pinta la lista de su hilo (ThreadBlock) o la línea de la
   * conversación, mezclado con lo hablado con fuera. Con `newBefore`, la raya
   * de «nuevos» va delante. Sin realtime: tras corregir o borrar, `onchange`
   * pide al dueño que recargue.
   */

  import { createMutation } from '@tanstack/svelte-query';
  import { mutateJSON } from '$lib/api';
  import Avatar from '$lib/components/Avatar.svelte';
  import Button from '$lib/components/Button.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import { MESSAGE_MAX, messageWhen, type ThreadMessage } from '$lib/threads';

  interface Props {
    message: ThreadMessage;
    /** El nombre de quien lo escribió (vacío: alguien que ya no comparte espacio). */
    author: string;
    /** Lo escribió quien mira: se corrige y se borra. */
    mine: boolean;
    /** De qué función habla, ya dicho («sáb 15 · 11h»). */
    about?: string;
    /** Qué es, cuando se mezcla con otras cosas: «Solo el equipo». */
    mark?: string;
    /** La raya de «nuevos» va justo delante. */
    newBefore?: boolean;
    locale: Locale;
    onchange: () => void;
  }

  let { message: m, author, mine, about, mark, newBefore = false, locale, onchange }: Props = $props();

  // Un mensaje es un momento: se dice en la zona de quien lo lee.
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let by = $derived(author || t('threads.someone', locale));

  let editing = $state(false);
  let draft = $state('');

  const editMutation = createMutation({
    mutationFn: (body: string) => mutateJSON('PATCH', `/api/messages/${m.id}`, { body }),
    onSuccess: () => {
      editing = false;
      onchange();
    },
    onError: (err) => messageFailed(err, 'threads.not_saved', locale),
  });

  const deleteMutation = createMutation({
    mutationFn: () => mutateJSON('DELETE', `/api/messages/${m.id}`),
    onSuccess: () => onchange(),
    onError: (err) => messageFailed(err, 'threads.not_deleted', locale),
  });

  function startEdit() {
    editing = true;
    draft = m.body;
  }

  function saveEdit() {
    const text = draft.trim();
    if (!text || $editMutation.isPending) return;
    if (text === m.body) {
      editing = false;
      return;
    }
    $editMutation.mutate(text);
  }

  function remove() {
    if (!window.confirm(t('threads.delete_confirm', locale))) return;
    $deleteMutation.mutate();
  }
</script>

{#if newBefore}
  <li class="thread__new" aria-label={t('threads.new_divider', locale)}>
    <span>{t('threads.new_divider', locale)}</span>
  </li>
{/if}
<li class="msg">
  <Avatar size="xs" name={by} />
  <div class="msg__main">
    <p class="msg__head">
      <span class="msg__by">{by}</span>
      <time datetime={m.created_at}>{messageWhen(m.created_at, locale, viewerTz)}</time>
      {#if m.edited_at}<span>{t('threads.edited', locale)}</span>{/if}
      {#if about}<span class="tag-chip" data-tone="blue">{about}</span>{/if}
      {#if mark}<span class="tag-chip">{mark}</span>{/if}
    </p>
    {#if editing}
      <form
        class="msg__edit"
        onsubmit={(e) => {
          e.preventDefault();
          saveEdit();
        }}
      >
        <textarea
          rows="2"
          maxlength={MESSAGE_MAX}
          aria-label={t('threads.edit_label', locale)}
          bind:value={draft}
          onkeydown={(e) => sendOnModEnter(e, saveEdit)}
        ></textarea>
        <div class="msg__edit-actions">
          <Button variant="outline" size="xs" onclick={() => (editing = false)}>{t('threads.cancel', locale)}</Button>
          <Button type="submit" size="xs" loading={$editMutation.isPending} disabled={!draft.trim()}>
            {t('threads.save', locale)}
          </Button>
        </div>
      </form>
    {:else}
      <p class="msg__text">{m.body}</p>
    {/if}
  </div>
  {#if mine && !editing}
    <Menu align="end" triggerClass="kebab" label={t('threads.message_actions', locale)}>
      {#snippet trigger()}<span aria-hidden="true">⋯</span>{/snippet}
      {#snippet children({ close })}
        <li role="none">
          <button type="button" role="menuitem" class="menu__item" onclick={() => { close(false); startEdit(); }}>
            {t('threads.edit', locale)}
          </button>
        </li>
        <li role="none">
          <button type="button" role="menuitem" class="menu__item menu__item--danger" onclick={() => { close(false); remove(); }}>
            {t('threads.delete', locale)}
          </button>
        </li>
      {/snippet}
    </Menu>
  {/if}
</li>

<style>
  @layer components {
    /* La raya de «nuevos»: una línea y su palabra, sin color de alarma. */
    .thread__new {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      color: var(--info, var(--text-muted));
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--mono-letter-spacing);
    }
    .thread__new::after {
      content: '';
      flex: 1;
      border-block-start: 1px solid currentColor;
      opacity: 0.4;
    }

    .msg {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: var(--space-s);
      align-items: start;
    }
    .msg__main {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
      min-inline-size: 0;
    }
    .msg__head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-xs);
      margin: 0;
      color: var(--text-faint);
      font-size: var(--text-xs);
    }
    .msg__by {
      color: var(--heading-color);
      font-weight: 500;
    }
    .msg__text {
      margin: 0;
      color: var(--text-color);
      font-size: var(--text-s);
      white-space: pre-line;
      overflow-wrap: anywhere;
    }
    .msg__edit {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .msg__edit-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-xs);
    }
  }
</style>
