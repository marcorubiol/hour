<script module lang="ts">
  import { addToast } from '$lib/components/Toast.svelte';
  import { viewerTimeZone } from '$lib/datetime';
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
   *
   * Tres formas (punto 110), un solo dueño de corregir y borrar:
   *  - `row`: la fila del tablón, con su monograma;
   *  - `note`: la nota del equipo intercalada en el hilo de una conversación,
   *    sombreada y con su marca, para que no se confunda con lo de fuera;
   *  - `bubble`: el mensaje de un grupo (el hilo de un bolo), en su lado.
   *
   * Una línea del sistema (121 B, ADR-180: «Pau llega tarde · desde su hoja»,
   * «Núria movió carga de 16:00 a 16:20») va centrada y sin menú, en cualquier
   * forma: no la escribió nadie del hilo, o es la huella de un cambio de hora.
   */

  import { createMutation } from '@tanstack/svelte-query';
  import { mutateJSON } from '$lib/api';
  import Avatar from '$lib/components/Avatar.svelte';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Menu from '$lib/components/Menu.svelte';
  import { hourMark, timeInTz } from '$lib/datetime';
  import { MESSAGE_MAX, messageWhen, type ThreadMessage } from '$lib/threads';
  import { lateLineText } from '$lib/roadsheet-late';

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
    look?: 'row' | 'note' | 'bubble';
    /** Sólo la hora: el día ya lo dice el separador del hilo. */
    timeOnly?: boolean;
    locale: Locale;
    onchange: () => void;
  }

  let {
    message: m,
    author,
    mine,
    about,
    mark,
    newBefore = false,
    look = 'row',
    timeOnly = false,
    locale,
    onchange,
  }: Props = $props();

  // Un mensaje es un momento: se dice en la zona de quien lo lee.
  const viewerTz = viewerTimeZone();
  let by = $derived(author || t('threads.someone', locale));
  let when = $derived(timeOnly ? hourMark(timeInTz(m.created_at, viewerTz)) : messageWhen(m.created_at, locale, viewerTz));

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

  // Deleting asks first, in the app's own dialog (never the browser's).
  let confirmDelete = $state(false);
  function remove() {
    confirmDelete = true;
  }
  function confirmRemove() {
    confirmDelete = false;
    $deleteMutation.mutate();
  }
</script>

{#if newBefore}
  <li class="thread__new" aria-label={t('threads.new_divider', locale)}>
    <span>{t('threads.new_divider', locale)}</span>
  </li>
{/if}
{#if m.system}
<li class="msg msg--system" data-testid="message-system">
  <p class="msg__system">
    {lateLineText(m.system, m.late, author, m.body, locale, viewerTz)} · <time datetime={m.created_at}>{when}</time>
  </p>
  {#if m.system === 'late_notice' && m.late?.note}<p class="msg__system-note">{m.late.note}</p>{/if}
</li>
{:else}
<li class="msg msg--{look}" class:msg--mine={mine}>
  {#if look === 'row'}<Avatar size="xs" name={by} />{/if}
  <div class="msg__main">
    <p class="msg__head">
      {#if look === 'note' && mark}<span class="msg__mark">{mark}</span>{/if}
      {#if !(look === 'bubble' && mine)}<span class="msg__by">{by}</span>{/if}
      <time datetime={m.created_at}>{when}</time>
      {#if m.edited_at}<span>{t('threads.edited', locale)}</span>{/if}
      {#if about}<span class="tag-chip" data-tone="blue">{about}</span>{/if}
      {#if mark && look !== 'note'}<span class="tag-chip">{mark}</span>{/if}
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
          <Button variant="quiet" size="xs" onclick={() => (editing = false)}>{t('threads.cancel', locale)}</Button>
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
{/if}

<Dialog bind:open={confirmDelete} size="s" title={t('threads.delete_title', locale)} description={t('threads.delete_confirm', locale)}>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (confirmDelete = false)}>{t('create.cancel', locale)}</Button>
    <Button tone="warn" onclick={confirmRemove}>{t('threads.delete', locale)}</Button>
  {/snippet}
</Dialog>

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
      border-block-start: var(--line-hairline) solid currentColor;
      opacity: 0.4;
    }

    .msg {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: var(--space-s);
      align-items: start;
    }
    /* Una línea del sistema: centrada, pequeña, en la mano del aviso. */
    .msg--system {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-2xs);
      text-align: center;
    }
    .msg__system {
      margin: 0;
      color: var(--tone-warning-fg);
      font-size: var(--text-xs);
    }
    .msg__system-note {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-xs);
      font-style: italic;
      overflow-wrap: anywhere;
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
    /* La nota del equipo en el hilo de fuera: sombreada, con su raya y su
       marca en versalita, como «Solo el equipo» del boceto A2. */
    .msg--note {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-xs);
      max-inline-size: var(--thread-letter-max);
      padding: var(--space-xs) var(--space-s);
      background: var(--thread-team-bg);
      border-inline-start: var(--line) solid var(--thread-team-rule);
      border-radius: var(--radius-s);
    }
    .msg__mark {
      color: var(--thread-team-fg);
      font-family: var(--font-mono);
      letter-spacing: var(--mono-letter-spacing);
      text-transform: uppercase;
    }
    /* Un grupo: cada mensaje en su lado, el texto en su globo. */
    .msg--bubble {
      grid-template-columns: minmax(0, auto) auto;
      justify-content: start;
      gap: var(--space-2xs);
      max-inline-size: var(--thread-bubble-max);
    }
    .msg--bubble.msg--mine {
      justify-content: end;
      align-self: flex-end;
    }
    .msg--bubble .msg__text {
      padding: var(--space-xs) var(--space-s);
      background: var(--thread-theirs-bg);
      border: var(--line-hairline) solid var(--border-color-light);
      border-radius: var(--radius-l);
    }
    .msg--bubble.msg--mine .msg__text {
      background: var(--thread-ours-bg);
    }
    .msg--bubble.msg--mine .msg__head {
      justify-content: flex-end;
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
