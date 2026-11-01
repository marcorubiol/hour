<script lang="ts">
  /**
   * Ajustes › Espacio › Textos guardados (89, ADR-171): lo que se repite al
   * escribir desde una conversación, para insertarlo en el correo
   * («Insertar texto» del redactor).
   *
   *   TEXTOS GUARDADOS                                   Nuevo texto
   *   Presentación de la compañía   MüK Cia es una compañía de…   Editar
   *   Condiciones técnicas          Espacio mínimo 8 × 6 m…        Editar
   *
   * Lo escribe quien puede editar conversaciones (`can_edit`); los demás lo
   * leen. Crear y editar en un diálogo con título y cuerpo; borrar, dentro
   * del diálogo, con dos pulsaciones (como borrar una fecha). La lista es la
   * misma consulta que lee el redactor: al guardar, el menú ya lo tiene.
   */
  import BlockHead from '$lib/components/BlockHead.svelte';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import EmptyLine from '$lib/components/EmptyLine.svelte';
  import Input from '$lib/components/Input.svelte';
  import Textarea from '$lib/components/Textarea.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { mutateJSON } from '$lib/api';
  import { appLocale, t } from '$lib/i18n';
  import {
    TEXT_BODY_MAX,
    TEXT_TITLE_MAX,
    cleanText,
    sortTexts,
    textPreview,
    workspaceTextsQueryOptions,
    type WorkspaceText,
  } from '$lib/workspace-texts';

  let { workspaceId }: { workspaceId: string } = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();
  const query = createQuery(toStore(() => workspaceTextsQueryOptions(workspaceId)));

  let items = $derived(sortTexts($query.data?.items ?? []));
  let canEdit = $derived($query.data?.can_edit ?? false);
  let url = $derived(`/api/workspaces/${workspaceId}/texts`);

  // ── The dialog: a new one (editing null) or one of the list ───────────
  let open = $state(false);
  let editing = $state<WorkspaceText | null>(null);
  let title = $state('');
  let body = $state('');
  let armed = $state(false);
  let formEl = $state<HTMLFormElement | undefined>();

  function openNew() {
    editing = null;
    title = '';
    body = '';
    armed = false;
    open = true;
  }

  function openEdit(item: WorkspaceText) {
    editing = item;
    title = item.title;
    body = item.body;
    armed = false;
    open = true;
  }

  let clean = $derived(cleanText(title, body));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['workspace-texts', workspaceId] });
  const failed = (err: unknown) =>
    addToast({
      tone: 'danger',
      title: t('edit.not_saved', locale),
      message: err instanceof Error ? err.message : t('perf.unexpected', locale),
    });

  const save = createMutation({
    mutationFn: () =>
      editing
        ? mutateJSON('PATCH', url, { text_id: editing.id, ...clean! })
        : mutateJSON('POST', url, { ...clean! }),
    onSuccess: () => {
      open = false;
      addToast({ tone: 'success', message: t('settings.texts_saved', locale) });
    },
    onError: failed,
    onSettled: refresh,
  });

  const remove = createMutation({
    mutationFn: (id: string) => mutateJSON('DELETE', `${url}?text_id=${encodeURIComponent(id)}`),
    onSuccess: () => {
      open = false;
      addToast({ tone: 'info', message: t('settings.texts_deleted', locale) });
    },
    onError: failed,
    onSettled: refresh,
  });

  function pressDelete() {
    if (!editing) return;
    if (!armed) {
      armed = true;
      return;
    }
    $remove.mutate(editing.id);
  }

  let pending = $derived($save.isPending || $remove.isPending);
</script>

{#if $query.isSuccess}
  <section class="set-group" aria-labelledby="set-texts-title" data-testid="settings-texts">
    <BlockHead title={t('settings.texts_title', locale)} id="set-texts-title" count={items.length || undefined}>
      {#if canEdit}
        <button type="button" class="block-head__act" onclick={openNew}>{t('settings.texts_new', locale)}</button>
      {/if}
    </BlockHead>
    {#if items.length === 0}
      <EmptyLine label={t('settings.texts_title', locale)} text={t('settings.texts_empty', locale)} />
    {:else}
      <div class="set-group__body">
        {#each items as item (item.id)}
          <div class="set-row" data-testid="settings-text">
            <div class="set-row__lead">
              <div class="set-row__label">{item.title}</div>
              <div class="set-row__hint">{textPreview(item.body)}</div>
            </div>
            {#if canEdit}
              <div class="set-row__ctrl">
                <Button size="xs" variant="quiet" label={t('settings.texts_edit_full', locale, { title: item.title })} onclick={() => openEdit(item)}>
                  {t('person.edit', locale)}
                </Button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<Dialog
  bind:open
  title={editing ? t('settings.texts_edit_title', locale) : t('settings.texts_new_title', locale)}
  size="m"
  onclose={() => (armed = false)}
>
  <form
    class="set-texts__form"
    bind:this={formEl}
    onsubmit={(ev) => {
      ev.preventDefault();
      if (clean && !pending) $save.mutate();
    }}
  >
    <Input
      id="set-text-title"
      label={t('settings.texts_field_title', locale)}
      bind:value={title}
      error={title.trim().length > TEXT_TITLE_MAX ? t('settings.texts_title_long', locale, { n: TEXT_TITLE_MAX }) : undefined}
      required
    />
    <Textarea
      id="set-text-body"
      label={t('settings.texts_field_body', locale)}
      rows={8}
      maxlength={TEXT_BODY_MAX}
      bind:value={body}
      required
    />
  </form>
  {#snippet lead()}
    {#if editing}
      <Button variant="quiet" tone={armed ? 'warn' : undefined} disabled={pending} onclick={pressDelete}>
        {armed ? t('edit.delete_confirm', locale) : t('edit.delete', locale)}
      </Button>
    {/if}
  {/snippet}
  {#snippet actions()}
    <Button variant="quiet" onclick={() => (open = false)}>{t('create.cancel', locale)}</Button>
    <Button onclick={() => formEl?.requestSubmit()} loading={$save.isPending} disabled={!clean || pending}>
      {t('edit.save', locale)}
    </Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    /* The dialog's fields are rows, one under the other (ADR-139 p4). */
    .set-texts__form {
      display: flex;
      flex-direction: column;
      gap: var(--field-gap);
      margin-block-start: var(--space-s);
    }
  }
</style>
