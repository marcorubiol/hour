<script lang="ts">
  /**
   * «Nueva nota privada» from ⌘K (163): the Planner's margin post-it
   * (ADR-093) written from any screen. The margin gives the day it sits on;
   * here the day is asked, on the host's view day (the Planner's) or today.
   * What it is about falls as on a day with nothing to anchor it
   * (`$lib/note`), and it says where. POST /api/notes; «Deshacer» deletes it,
   * and outside the Planner «Abrir» goes to its day there.
   *
   * Mounted once by the /h shell, opened through the creation store.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Textarea from '$lib/components/Textarea.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { toastCreated } from '$lib/created';
  import { localDayISO } from '$lib/datetime';
  import { FormErrors } from '$lib/form-errors.svelte';
  import { appLocale, t } from '$lib/i18n';
  import type { NavWorkspace, ResolvedScope } from '$lib/nav';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { noteFallback, noteFallbackBody } from '$lib/note';
  import { plannerDayHref } from '$lib/planner';

  interface Props {
    open?: boolean;
    scope: ResolvedScope;
    /** Typed in ⌘K: the note. */
    body?: string;
    /** YYYY-MM-DD; absent, today. */
    day?: string | null;
  }
  let { open = $bindable(false), scope, body: preset = '', day = null }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();
  const formErrors = new FormErrors();
  const uid = $props.id();
  const bodyId = `note-body-${uid}`;
  const dayId = `note-day-${uid}`;
  const workspacesQuery = createQuery(workspacesQueryOptions());
  let fallback = $derived(noteFallback(scope, ($workspacesQuery.data?.items ?? []) as NavWorkspace[], locale));

  let text = $state('');
  let onDay = $state('');
  $effect(() => {
    if (!open) return;
    untrack(() => {
      text = preset;
      onDay = day ?? localDayISO();
      formErrors.clear();
    });
  });

  function refresh() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['planner-agenda-notes'] }),
      queryClient.invalidateQueries({ queryKey: ['planner-day-notes'] }),
    ]);
  }

  const create = createMutation({
    mutationFn: () =>
      mutateJSON<{ note?: { id?: string } }>('POST', '/api/notes', {
        body: text.trim(),
        on_day: onDay,
        ...noteFallbackBody(fallback),
      }),
    onSuccess: (res) => {
      open = false;
      void refresh();
      const id = res?.note?.id;
      // Inside the Planner the note is already on screen: no «Abrir».
      const day = onDay;
      const away = !page.url.pathname.startsWith('/h/planner');
      toastCreated({
        open: away ? () => void goto(plannerDayHref('day', day)) : undefined,
        locale,
        message: t('note.saved', locale),
        undo: id
          ? async () => {
              await mutateJSON('DELETE', `/api/notes/${encodeURIComponent(id)}`);
              await refresh();
            }
          : undefined,
      });
    },
    onError: (err) =>
      addToast({ tone: 'danger', message: err instanceof Error ? err.message : t('planner.note_save_error', locale) }),
  });

  function submit() {
    if ($create.isPending) return;
    formErrors.clear();
    if (!text.trim()) formErrors.set(bodyId, t('form.required', locale));
    if (!onDay) formErrors.set(dayId, t('form.required', locale));
    if (formErrors.any) return void formErrors.focusFirst();
    $create.mutate();
  }
</script>

<Dialog bind:open title={t('palette.new_note', locale)} size="s" description={t('note.desc', locale)}>
  <form
    class="note-form"
    novalidate
    oninput={formErrors.onedit}
    onchange={formErrors.onedit}
    onsubmit={(e) => {
      e.preventDefault();
      submit();
    }}
  >
    <Textarea
      id={bodyId}
      label={t('note.body', locale)}
      placeholder={t('planner.note_placeholder', locale)}
      bind:value={text}
      rows={4}
      maxlength={4000}
      required
      autofocus
      helper={t('note.about', locale, { name: fallback.label })}
      error={formErrors.of(bodyId)}
    />
    <Input id={dayId} label={t('perf.date', locale)} type="date" bind:value={onDay} required error={formErrors.of(dayId)} />
    <button type="submit" hidden aria-hidden="true"></button>
  </form>
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={submit} loading={$create.isPending}>{t('composer.add', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    /* The dialog's fields are rows, one under the other (ADR-139 p4). */
    .note-form {
      display: flex;
      flex-direction: column;
      gap: var(--field-gap);
      margin-block-start: var(--space-s);
    }
  }
</style>
