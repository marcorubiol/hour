<script lang="ts">
  /**
   * Las etiquetas de conversación del espacio (ADR-138, fase 4; plan
   * `2026-10-19-conversations-tags.md` § 2 «Fijas o por espacio»).
   *
   * Las estándar de Hour y las propias, en su orden. El admin renombra una
   * estándar en su espacio (vacío vuelve al nombre de Hour), apaga y enciende
   * (apagar la quita de los chips y no deja ponerla; las asignaciones se
   * quedan), crea una propia (la clave sale del nombre; `all` y `team` no,
   * que son chips) y ordena (↑ ↓, o Alt y las flechas en la fila). Los demás
   * la ven. Todo se guarda en sitio y dice «guardado» en su fila (ADR-139 p7).
   *
   * Lee el mismo vocabulario que la lente, la ficha y «Añadir»
   * (`conversationTagsQueryOptions`): al guardar se invalida y los chips salen
   * sin recargar. Quién es admin lo dice la consulta de Secciones.
   */
  import RecordHead from '$lib/components/RecordHead.svelte';
  import BlockHead from '$lib/components/BlockHead.svelte';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';
  import Switch from '$lib/components/Switch.svelte';
  import SavedMark from '$lib/components/SavedMark.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
  import { appLocale, t } from '$lib/i18n';
  import { SaveFlash } from '$lib/save-flash.svelte';
  import { conversationTagsQueryOptions } from '$lib/conversation-tags-query';
  import {
    TAG_LABEL_MAX,
    moveTag,
    newTagProblem,
    settingsTags,
    tagKeyFromLabel,
    tagLabel,
    type SettingsTag,
    type TagKeyProblem,
  } from '$lib/conversation-tags';

  interface Props {
    workspaceId: string | undefined;
  }
  let { workspaceId }: Props = $props();

  const locale = appLocale();
  const queryClient = useQueryClient();

  const vocabQuery = createQuery(toStore(() => conversationTagsQueryOptions(Boolean(workspaceId))));
  // The same read as the Sections block: who administers the space.
  const adminQuery = createQuery(
    toStore(() => ({
      queryKey: ['workspace-lenses', workspaceId] as const,
      enabled: Boolean(workspaceId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJSON<{ can_edit: boolean }>(`/api/workspaces/${workspaceId}/lenses`, signal),
    })),
  );

  let tags = $derived($vocabQuery.data && workspaceId ? settingsTags($vocabQuery.data, workspaceId) : []);
  let canEdit = $derived($adminQuery.data?.can_edit ?? false);
  let url = $derived(`/api/workspaces/${workspaceId}/conversation-tags`);

  const saved = new SaveFlash();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['conversation-tags'] });
  const failed = (err: unknown) =>
    addToast({ tone: 'danger', title: t('edit.not_saved', locale), message: err instanceof Error ? err.message : String(err) });

  type Patch = { tag_id: string; label?: string | null; active?: boolean };
  const patch = createMutation({
    mutationFn: (body: Patch) => mutateJSON('PATCH', url, body),
    onError: failed,
    onSettled: refresh,
  });
  const order = createMutation({
    mutationFn: (ids: string[]) => mutateJSON('PUT', url, { order: ids }),
    onError: failed,
    onSettled: refresh,
  });

  let busy = $derived($patch.isPending || $order.isPending);

  function hourName(tag: SettingsTag): string {
    return tagLabel({ key: tag.key, label: null, labels: {} }, locale);
  }

  function rename(tag: SettingsTag, input: HTMLInputElement) {
    const value = input.value.trim();
    const stored = tag.label ?? '';
    if (value === stored) return;
    if (!tag.standard && !value) {
      // An own tag always has a name: there is no Hour's to go back to.
      input.value = stored;
      return;
    }
    $patch.mutate(
      { tag_id: tag.id, label: value || null },
      { onSuccess: () => saved.show(`name-${tag.id}`) },
    );
  }

  function backToHour(tag: SettingsTag) {
    $patch.mutate({ tag_id: tag.id, label: null }, { onSuccess: () => saved.show(`name-${tag.id}`) });
  }

  function setActive(tag: SettingsTag, active: boolean) {
    $patch.mutate({ tag_id: tag.id, active }, { onSuccess: () => saved.show(`row-${tag.id}`) });
  }

  function move(tag: SettingsTag, step: -1 | 1) {
    const ids = tags.map((x) => x.id);
    const next = moveTag(ids, tag.id, step);
    if (next.every((id, i) => id === ids[i])) return;
    $order.mutate(next, { onSuccess: () => saved.show(`row-${tag.id}`) });
  }

  function onRowKey(tag: SettingsTag, ev: KeyboardEvent) {
    if (!canEdit || busy || !ev.altKey) return;
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      move(tag, ev.key === 'ArrowUp' ? -1 : 1);
    }
  }

  // ── New tag ──────────────────────────────────────────────────────────────
  let draft = $state('');
  /** What the server said no to, until the name changes. */
  let refused = $state<{ label: string; problem: TagKeyProblem } | null>(null);
  let draftKey = $derived(tagKeyFromLabel(draft.trim()));
  let localProblem = $derived(draft.trim() ? newTagProblem(draft, tags.map((x) => x.key)) : null);
  let problem = $derived(refused && refused.label === draft ? refused.problem : localProblem);
  let showProblem = $state(false);

  const create = createMutation({
    mutationFn: (label: string) => mutateJSON('POST', url, { label }),
    onSuccess: () => {
      draft = '';
      showProblem = false;
      saved.show('new');
    },
    onError: (err, label) => {
      const code = err instanceof ApiError ? err.body?.error : null;
      if (code === 'reserved' || code === 'taken' || code === 'invalid') {
        refused = { label, problem: code };
        showProblem = true;
      } else failed(err);
    },
    onSettled: refresh,
  });

  function submitNew(ev: SubmitEvent) {
    ev.preventDefault();
    if (!draft.trim()) return;
    showProblem = true;
    if (problem) return;
    $create.mutate(draft);
  }

  let newError = $derived(
    showProblem && problem ? t(`settings.tags_error_${problem}`, locale, { key: draftKey ?? '' }) : undefined,
  );
  let newHelper = $derived(
    draftKey ? t('settings.tags_new_key', locale, { key: draftKey }) : t('settings.tags_new_hint', locale),
  );
</script>

<RecordHead crumbs={[{ label: t('settings.title', locale) }, { label: t('settings.lenses_kicker', locale) }]} title={t('settings.nav_tags', locale)}>
  {#snippet facts()}<span>{t('settings.tags_sub', locale)}</span>{/snippet}
</RecordHead>

<section class="set-group" data-testid="settings-tags">
  <BlockHead title={t('settings.tags_group', locale)} count={canEdit ? t('settings.tags_order_hint', locale) : undefined} />
  <div class="set-group__body">
    {#each tags as tag, i (tag.id)}
      {@const name = tagLabel(tag, locale)}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="set-row tagset"
        class:is-off={!tag.active}
        data-tag={tag.key}
        role="group"
        aria-label={name}
        onkeydown={(ev) => onRowKey(tag, ev)}
      >
        <div class="set-row__lead">
          <div class="set-row__label">{name}</div>
          <div class="set-row__hint">
            {tag.standard ? t('settings.tags_standard', locale, { name: hourName(tag) }) : t('settings.tags_own', locale)}
          </div>
        </div>
        <div class="set-row__ctrl">
          {#if canEdit}
            <Field id="tag-name-{tag.id}" saved={saved.is(`name-${tag.id}`)}>
              <input
                id="tag-name-{tag.id}"
                type="text"
                maxlength={TAG_LABEL_MAX}
                aria-label={t('settings.tags_name', locale, { name })}
                placeholder={tag.standard ? hourName(tag) : undefined}
                value={tag.label ?? ''}
                disabled={busy}
                onblur={(ev) => rename(tag, ev.currentTarget)}
                onkeydown={(ev) => {
                  if (ev.key === 'Enter') ev.currentTarget.blur();
                }}
              />
            </Field>
            {#if tag.standard && tag.label}
              <Button size="xs" variant="quiet" disabled={busy} onclick={() => backToHour(tag)}>
                {t('settings.tags_back_to_hour', locale)}
              </Button>
            {/if}
            <span class="tagset__tools">
              <Switch
                checked={tag.active}
                label={t('settings.tags_active', locale, { name })}
                testid="tag-active-{tag.key}"
                disabled={busy}
                onchange={(next) => setActive(tag, next)}
              />
              <Button size="xs" variant="quiet" label={t('settings.tags_up', locale, { name })} disabled={busy || i === 0} onclick={() => move(tag, -1)}>↑</Button>
              <Button
                size="xs"
                variant="quiet"
                label={t('settings.tags_down', locale, { name })}
                disabled={busy || i === tags.length - 1}
                onclick={() => move(tag, 1)}>↓</Button
              >
              <SavedMark shown={saved.is(`row-${tag.id}`)} />
            </span>
          {:else}
            <span class="set-row__value">{tag.active ? t('settings.tags_on', locale) : t('settings.tags_off', locale)}</span>
          {/if}
        </div>
      </div>
    {/each}

    {#if canEdit && $vocabQuery.data}
      <form class="set-row" onsubmit={submitNew} novalidate>
        <div class="set-row__lead">
          <label class="set-row__label" for="tag-new">{t('settings.tags_new', locale)}</label>
        </div>
        <div class="set-row__ctrl">
          <Field id="tag-new" error={newError} helper={newHelper} saved={saved.is('new')}>
            <input
              id="tag-new"
              type="text"
              maxlength={TAG_LABEL_MAX}
              bind:value={draft}
              oninput={() => (showProblem = false)}
              disabled={$create.isPending}
            />
          </Field>
          <Button size="s" variant="secondary" type="submit" loading={$create.isPending} disabled={!draft.trim()}>
            {t('settings.tags_create', locale)}
          </Button>
        </div>
      </form>
    {/if}

    {#if !canEdit && $adminQuery.data}
      <div class="set-row">
        <span class="set-row__hint">{t('settings.lenses_admin_only', locale)}</span>
      </div>
    {/if}
  </div>
</section>

<style>
  @layer components {
    .tagset.is-off .set-row__label {
      color: var(--text-faint);
    }
    .tagset__tools {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2xs);
    }
  }
</style>
