<script lang="ts">
  /**
   * Edit-project dialog (ADR-081) — the full project editor and the target of
   * the identity popover's "Edit project →" door. Identity section first (live
   * monogram preview + free-form initials + the 12-swatch color), then name +
   * description. PATCHed via update_project (owner/admin/member). Seeds from the
   * project on open; on success invalidates the projects caches so every
   * IdentityMark across the app repaints in place.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { ApiError, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Textarea from './Textarea.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Switch from '$lib/components/Switch.svelte';
  import { activeProjectsQueryOptions } from '$lib/nav-queries';
  import { moveThing, preparationPatch, readPreparation, type Preparation } from '$lib/preparation';
  import Input from '$lib/components/Input.svelte';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import AccentSwatchPicker from '$lib/components/create/AccentSwatchPicker.svelte';
  import { accentVarFor } from '$lib/utils/accent';
  import { appLocale, t } from '$lib/i18n';
  import { MONOGRAM_MAX, type EditableProject, type IdentitySibling } from '$lib/utils/identity';

  interface Props {
    open?: boolean;
    project: EditableProject | null;
    /** Other projects in scope — for the case-sensitive collision warning. */
    siblings?: IdentitySibling[];
  }

  let { open = $bindable(false), project, siblings = [] }: Props = $props();

  const queryClient = useQueryClient();
  const locale = appLocale();

  let name = $state('');
  let accent = $state<string | null>(null); // null = auto (hash of slug)
  let initials = $state('');
  let description = $state('');
  // «Qué preparamos para una función» (ADR-221): the project's list, from the
  // projects already read; sent only if it was changed here.
  const projectsQuery = createQuery(activeProjectsQueryOptions());
  let prep = $state<Preparation>(readPreparation(null));
  let prepSeed = '';
  const prepKey = (l: Preparation) => l.map((x) => `${x.id}:${x.on ? 1 : 0}`).join(',');
  let prepChanged = $derived(prepKey(prep) !== prepSeed);
  const THING_LABEL = {
    status: 'prep.thing_status',
    hours: 'prep.thing_hours',
    team: 'prep.thing_team',
    sheet: 'prep.thing_sheet',
  } as const;

  // Seed once per open transition (plain latch — writing it can't re-trigger).
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen && project) {
      name = project.name ?? '';
      accent = project.accent ?? null;
      initials = project.initials ?? '';
      description = project.description ?? '';
      prep = readPreparation($projectsQuery.data?.items.find((p) => p.id === project.id)?.preparation);
      prepSeed = prepKey(prep);
    }
    wasOpen = open;
  });

  let previewAccent = $derived(accentVarFor({ slug: project?.slug ?? null, accent }));

  // Collision = exact, case-sensitive match against a sibling's monogram
  // (ADR-081). 'MdM' and 'MDM' do NOT collide. Warn, never block.
  let collision = $derived(
    initials.trim().length > 0 &&
      siblings.some((s) => s.id !== project?.id && (s.initials ?? '') === initials.trim()),
  );

  function close() {
    open = false;
  }

  const save = createMutation({
    mutationFn: async () => {
      if (!project) throw new Error('No project');
      // Full state for the fields this dialog manages: '' / null clear.
      const body = {
        name: name.trim(),
        description: description.trim(),
        accent,
        initials: initials.trim(),
        ...(prepChanged ? { preparation: preparationPatch(prep) } : {}),
      };
      const res = await mutateJSON<{ project: { id: string; slug: string } }>(
        'PATCH',
        `/api/projects/${project.id}`,
        body,
      );
      if (!res?.project) throw new Error('Empty response');
      return res.project;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      if (project) await queryClient.invalidateQueries({ queryKey: ['project', project.slug] });
      // Calendar chips read the perf/date feeds — refetch so they repaint too.
      await queryClient.invalidateQueries({ queryKey: ['planner-performances'] });
      await queryClient.invalidateQueries({ queryKey: ['planner-dates'] });
      addToast({ tone: 'success', message: t('project.updated', locale) });
      close();
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: t('edit.not_saved', locale),
        message:
          err instanceof ApiError && err.status === 403
            ? t('project.no_permission', locale)
            : err instanceof Error
              ? err.message
              : t('perf.unexpected', locale),
      });
    },
  });

  /** The name's own word, under the field (ADR-139 p7); the native
      `required` covers the empty ones, this the blank ones. */
  let nameError = $state<string | undefined>();
  $effect(() => {
    void name;
    nameError = undefined;
  });
  let formEl: HTMLFormElement | undefined = $state();

  /** Runs from the form's submit, after the native constraints passed. */
  function submit(event?: Event) {
    event?.preventDefault();
    if (!name.trim()) {
      nameError = t('project.name_empty', locale);
      return;
    }
    $save.mutate();
  }
</script>

<Dialog bind:open title={t('project.edit_title', locale)} size="s">
  <form class="epj__form" bind:this={formEl} onsubmit={submit}>
    <section class="epj__identity" aria-label={t('project.identity_aria', locale)}>
      <span class="eyebrow">{t('project.identity', locale)}</span>
      <div class="epj__preview">
        <IdentityMark
          variant="full"
          accent={previewAccent}
          initials={initials}
          name={name || project?.name}
          size="28px"
        />
      </div>

      <Input
        label={t('project.monogram', locale)}
        name="project-initials"
        bind:value={initials}
        oninput={() => {
          if (initials.length > MONOGRAM_MAX) initials = initials.slice(0, MONOGRAM_MAX);
        }}
        placeholder={t('project.monogram_ph', locale)}
        autocomplete="off"
        helper={t('project.monogram_help', locale)}
        disabled={$save.isPending}
      />
      {#if collision}
        <p class="epj__collision" role="status">
          {t('project.monogram_collision', locale, { initials: initials.trim() })}
        </p>
      {/if}

      <AccentSwatchPicker
        bind:accent
        autoSlug={project?.slug || name.trim() || 'project'}
        label={t('project.color', locale)}
        disabled={$save.isPending}
      />
    </section>

    <Input
      label={t('conversations.col_name', locale)}
      name="project-name"
      bind:value={name}
      error={nameError}
      required
      autocomplete="off"
      disabled={$save.isPending}
    />

    <Textarea
      label={t('project.description', locale)}
      bind:value={description}
      maxlength={280}
      counter
      rows={3}
      placeholder={t('project.description_ph', locale)}
      disabled={$save.isPending}
    />

    <section class="epj__prep" aria-labelledby="epj-prep-title" data-testid="project-preparation">
      <span class="eyebrow" id="epj-prep-title">{t('prep.title', locale)}</span>
      <p class="epj__help">{t('prep.help', locale)}</p>
      <ul class="epj__things" role="list">
        {#each prep as thing, i (thing.id)}
          <li class="epj__thing" data-thing={thing.id}>
            <span class="epj__thing-name" class:epj__thing-name--off={!thing.on}>
              {t(THING_LABEL[thing.id], locale)}
              <small>{t('prep.by_app', locale)}</small>
            </span>
            <span class="epj__thing-acts">
              <button
                type="button"
                class="epj__move"
                aria-label={t('prep.move_up', locale, { name: t(THING_LABEL[thing.id], locale) })}
                disabled={i === 0 || $save.isPending}
                onclick={() => (prep = moveThing(prep, i, i - 1))}>↑</button
              >
              <button
                type="button"
                class="epj__move"
                aria-label={t('prep.move_down', locale, { name: t(THING_LABEL[thing.id], locale) })}
                disabled={i === prep.length - 1 || $save.isPending}
                onclick={() => (prep = moveThing(prep, i, i + 1))}>↓</button
              >
              <Switch
                checked={thing.on}
                label={t('prep.ask', locale, { name: t(THING_LABEL[thing.id], locale) })}
                disabled={$save.isPending}
                testid={`prep-switch-${thing.id}`}
                onchange={(next) => (prep = prep.map((x) => (x.id === thing.id ? { ...x, on: next } : x)))}
              />
            </span>
          </li>
        {/each}
      </ul>
    </section>

    <button type="submit" hidden aria-hidden="true"></button>
  </form>

  {#snippet actions()}
    <Button variant="quiet" disabled={$save.isPending} onclick={close}>{t('create.cancel', locale)}</Button>
    <Button loading={$save.isPending} onclick={() => formEl?.requestSubmit()}>{t('ui.save', locale)}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .epj__form {
      display: flex;
      flex-direction: column;
      gap: var(--field-gap);
    }

    .epj__identity {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .epj__preview {
      display: flex;
      align-items: center;
      min-block-size: 2.4em;
    }

    .epj__prep {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .epj__help {
      margin: 0;
      font-size: var(--text-s);
      color: var(--text-muted);
    }
    .epj__things {
      display: grid;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .epj__thing {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s);
      padding-block: var(--space-xs);
      border-block-start: var(--line-hairline) solid var(--border-color-light);
    }
    .epj__thing-name {
      display: grid;
      font-size: var(--text-m);
    }
    .epj__thing-name--off {
      color: var(--text-muted);
    }
    .epj__thing-name small {
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: var(--mono-letter-spacing-loose);
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .epj__thing-acts {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
    }
    .epj__move {
      appearance: none;
      min-inline-size: 2.25rem;
      min-block-size: 2.25rem;
      border: var(--line-hairline) solid var(--border-color-dark);
      border-radius: var(--radius);
      background: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .epj__move:disabled {
      opacity: var(--disabled-opacity);
      cursor: default;
    }

    .epj__collision {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
  }
</style>
