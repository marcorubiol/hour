<script lang="ts">
  /**
   * New-line dialog — THE TEMPLATE PICKER (ADR-056). Creating a line =
   * picking a template: the card fixes the kind, and the kind the modules
   * (ADR-166: the card lists them, nothing sends them), the 10-kind dropdown
   * is gone. One dialog, one step: template cards → project → name →
   * accent. On success, refetch the ['lines'] caches before navigating to
   * the new line detail.
   */
  import { currentSeason, seasonLabel } from '$lib/season-year';
  import { screenSeasonStart } from '$lib/season-start.svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { LINE_TEMPLATES, moduleLabel, modulesForKind, type LineTemplate } from '$lib/line-templates';
  import { appLocale, t, voiceFor } from '$lib/i18n';
  import { workspacesQueryOptions } from '$lib/nav-queries';
  import { accentVar } from '$lib/utils/accent';
  import AccentSwatchPicker from './AccentSwatchPicker.svelte';

  interface Props {
    open?: boolean;
    /** Narrows the project select to one workspace's projects. */
    workspaceId?: string | null;
    /** Locks the project (select hidden) when the caller already knows it. */
    projectId?: string | null;
  }

  let { open = $bindable(false), workspaceId = null, projectId = null }: Props = $props();

  type ProjectLite = { id: string; slug: string; name: string; workspace_id: string };
  type CreatedLine = { id: string; slug: string | null; project_id: string; workspace_id: string };

  const queryClient = useQueryClient();
  const locale = appLocale();
  const workspacesQ = createQuery(workspacesQueryOptions());
  const projectsQ = createQuery({
    queryKey: ['projects', { status: 'active' }],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchJSON<{ items: ProjectLite[] }>('/api/projects?status=active', signal),
  });

  let templateKey = $state(LINE_TEMPLATES[0].key);
  let projSelected = $state('');
  let name = $state('');
  let accent = $state<string | null>(null); // null = auto (hash of slug)

  let template = $derived(LINE_TEMPLATES.find((tpl) => tpl.key === templateKey) ?? LINE_TEMPLATES[0]);

  let projects = $derived($projectsQ.data?.items ?? []);
  let projectOptions = $derived(
    projects
      .filter((p) => !workspaceId || p.workspace_id === workspaceId)
      .map((p) => ({ value: p.id, label: p.name })),
  );
  let effectiveProjectId = $derived(projectId ?? projSelected);
  /** The trade of the space this writes to (tarea 142): the chosen project's,
      or the one the dialog was opened in; the screen's voice until then. */
  let voice = $derived(voiceFor(projects.find((p) => p.id === effectiveProjectId)?.workspace_id ?? workspaceId));
  const tr = (key: string, params?: Record<string, string | number>) => t(key, locale, params, voice);

  // Light name suggestion from the template + next year — "Difusión
  // 2027-28" for booking (the season after this one, by the month the
  // space's season starts: `$lib/season-year`), "Tour 2027" else.
  const nextYear = new Date().getFullYear() + 1;
  let nameSuggestion = $derived(
    template.key === 'booking'
      ? tr('line.suggest_booking', {
          season: seasonLabel(currentSeason(new Date(), screenSeasonStart()).year + 1, screenSeasonStart(), true),
        })
      : `${tr(template.nameKey)} ${nextYear}`,
  );

  // Live preview of the color Auto would pick; also feeds the selected
  // card's accent border via --c on the form.
  let autoAccentSlug = $derived(name.trim() || 'line');
  let accentPreview = $derived(accent ? `var(--accent-${accent})` : accentVar(autoAccentSlug));

  function reset() {
    templateKey = LINE_TEMPLATES[0].key;
    projSelected = '';
    name = '';
    accent = null;
  }

  function close() {
    open = false;
    reset();
  }

  const create = createMutation({
    mutationFn: async (input: {
      project_id: string;
      name: string;
      kind: LineTemplate['kind'];
      accent: string | null;
    }) => {
      const body: Record<string, unknown> = {
        project_id: input.project_id,
        name: input.name,
        kind: input.kind,
      };
      if (input.accent) body.accent = input.accent;
      const res = await mutateJSON<{ line: CreatedLine }>('POST', '/api/lines', body);
      if (!res?.line) throw new Error('Empty response');
      return res.line;
    },
    onSuccess: async (line) => {
      // Refetch must land before goto — the line detail reads these caches.
      await queryClient.invalidateQueries({ queryKey: ['lines'] });
      await queryClient.refetchQueries({ queryKey: ['lines'] });
      const wsSlug = ($workspacesQ.data?.items ?? []).find((w) => w.id === line.workspace_id)?.slug;
      const projSlug = projects.find((p) => p.id === line.project_id)?.slug;
      close();
      if (wsSlug && projSlug && line.slug) {
        await goto(`/h/${wsSlug}/project/${projSlug}/line/${line.slug}`);
      }
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: tr('line.not_created'),
        message:
          err instanceof ApiError && err.status === 409
            ? tr('line.name_taken')
            : err instanceof Error
              ? err.message
              : tr('perf.unexpected'),
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
    if (!effectiveProjectId) {
      return; // the select's `required` says it under the field
    }
    const trimmed = name.trim();
    if (!trimmed) {
      nameError = tr('project.name_empty');
      return;
    }
    $create.mutate({
      project_id: effectiveProjectId,
      name: trimmed,
      kind: template.kind,
      accent,
    });
  }
</script>

<Dialog
  bind:open
  title={tr('line.new_title')}
  description={tr('line.new_desc')}
  size="m"
  onclose={reset}
>
  <form class="cln__form" bind:this={formEl} onsubmit={submit} style={`--c: ${accentPreview}`}>
    <fieldset class="cln__templates">
      <legend class="eyebrow eyebrow--sub">{tr('line.template')}</legend>
      <div class="cln__template-grid" role="radiogroup" aria-label={tr('line.template_aria')}>
        {#each LINE_TEMPLATES as tpl (tpl.key)}
          {@const isOn = templateKey === tpl.key}
          <button
            type="button"
            role="radio"
            aria-checked={isOn}
            class={['cln__template', isOn && 'cln__template--on'].filter(Boolean).join(' ')}
            disabled={$create.isPending}
            onclick={() => (templateKey = tpl.key)}
          >
            <span class="cln__template-name">{tr(tpl.nameKey)}</span>
            <span class="cln__template-desc">{tr(tpl.descriptionKey)}</span>
            <span class="cln__template-modules">
              {modulesForKind(tpl.kind).map((m) => moduleLabel(m, locale, voice)).join(' · ')}
            </span>
          </button>
        {/each}
      </div>
    </fieldset>

    {#if !projectId}
      <Select
        label={tr('create.project')}
        bind:value={projSelected}
        options={projectOptions}
        placeholder={tr('line.pick_project_ph')}
        required
        disabled={$create.isPending}
      />
    {/if}

    <Input
      label={tr('conversations.col_name')}
      name="line-name"
      bind:value={name}
      error={nameError}
      placeholder={tr('line.name_ph', { example: nameSuggestion })}
      required
      autocomplete="off"
      disabled={$create.isPending}
    />

    <AccentSwatchPicker bind:accent autoSlug={autoAccentSlug} label={tr('line.color')} disabled={$create.isPending} />

    <!-- Hidden submit lets Enter inside an input trigger submit. -->
    <button type="submit" hidden aria-hidden="true"></button>
  </form>

  {#snippet actions()}
    <Button variant="quiet" disabled={$create.isPending} onclick={close}>{tr('create.cancel')}</Button>
    <Button loading={$create.isPending} onclick={() => formEl?.requestSubmit()}>{tr('project.create')}</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .cln__form {
      display: flex;
      flex-direction: column;
      gap: var(--field-gap);
    }

    /* Template cards — a radiogroup of bordered cards; the selected one
       borrows the accent (--c, set on the form from the swatch/auto
       preview) for its border. */
    .cln__templates {
      border: 0;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .cln__templates > legend {
      padding: 0;
    }

    .cln__templates {
      margin-block-end: var(--space-s);
    }

    .cln__template-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 14rem), 1fr));
      gap: var(--space-s);
    }

    .cln__template {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: var(--space-xs);
      padding: var(--space-s);
      font-family: inherit;
      text-align: start;
      background: none;
      border: var(--line-hairline) solid var(--border-color-light);
      border-radius: var(--radius);
      cursor: pointer;
      transition: border-color var(--transition), background var(--transition);
    }

    .cln__template:hover:not(:disabled) {
      background: var(--bg-hover);
    }

    .cln__template:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 2px;
    }

    .cln__template--on {
      border-color: var(--c);
      background: var(--bg-hover);
    }

    .cln__template:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .cln__template-name {
      font-size: var(--text-s);
      font-weight: 500;
      color: var(--text-color);
    }

    .cln__template-desc {
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .cln__template-modules {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

  }
</style>
