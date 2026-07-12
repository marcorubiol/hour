<script lang="ts">
  /**
   * New-line dialog — THE TEMPLATE PICKER (ADR-056). Creating a line =
   * picking a template: the card fixes kind + starting module set (sent as
   * `modules` — the API accepts them since ADR-056), the 10-kind dropdown
   * is gone. One dialog, one step: template cards → project → name →
   * accent. On success, refetch the ['lines'] caches before navigating to
   * the new line detail.
   */
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { ApiError, fetchJSON, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { LINE_TEMPLATES, MODULE_LABELS, type LineTemplate } from '$lib/line-templates';
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

  let template = $derived(LINE_TEMPLATES.find((t) => t.key === templateKey) ?? LINE_TEMPLATES[0]);

  let projects = $derived($projectsQ.data?.items ?? []);
  let projectOptions = $derived(
    projects
      .filter((p) => !workspaceId || p.workspace_id === workspaceId)
      .map((p) => ({ value: p.id, label: p.name })),
  );
  let effectiveProjectId = $derived(projectId ?? projSelected);

  // Light name suggestion from the template + next year — "Difusión
  // 2027-28" for booking (a season spans two years), "Tour 2027" else.
  const nextYear = new Date().getFullYear() + 1;
  let nameSuggestion = $derived(
    template.key === 'booking'
      ? `Difusión ${nextYear}-${String((nextYear + 1) % 100).padStart(2, '0')}`
      : `${template.name} ${nextYear}`,
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
      modules: LineTemplate['modules'];
      accent: string | null;
    }) => {
      const body: Record<string, unknown> = {
        project_id: input.project_id,
        name: input.name,
        kind: input.kind,
        modules: input.modules,
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
        title: 'Line not created',
        message:
          err instanceof ApiError && err.status === 409
            ? 'A line with that name already exists in this project.'
            : err instanceof Error
              ? err.message
              : 'Unexpected error',
      });
    },
  });

  function submit(event?: Event) {
    event?.preventDefault();
    if (!effectiveProjectId) {
      addToast({ tone: 'warning', message: 'Pick a project.' });
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      addToast({ tone: 'warning', message: 'Name cannot be empty.' });
      return;
    }
    $create.mutate({
      project_id: effectiveProjectId,
      name: trimmed,
      kind: template.kind,
      modules: template.modules,
      accent,
    });
  }
</script>

<Dialog
  bind:open
  title="New line"
  description="Pick a template — it sets the line's kind and starting modules."
  size="m"
  onclose={reset}
>
  <form class="cln__form" onsubmit={submit} style={`--c: ${accentPreview}`}>
    <fieldset class="cln__templates">
      <legend>Template</legend>
      <div class="cln__template-grid" role="radiogroup" aria-label="Line template">
        {#each LINE_TEMPLATES as t (t.key)}
          {@const isOn = templateKey === t.key}
          <button
            type="button"
            role="radio"
            aria-checked={isOn}
            class={['cln__template', isOn && 'cln__template--on'].filter(Boolean).join(' ')}
            disabled={$create.isPending}
            onclick={() => (templateKey = t.key)}
          >
            <span class="cln__template-name">{t.name}</span>
            <span class="cln__template-desc">{t.description}</span>
            <span class="cln__template-modules">
              {t.modules.map((m) => MODULE_LABELS[m]).join(' · ')}
            </span>
          </button>
        {/each}
      </div>
    </fieldset>

    {#if !projectId}
      <Select
        label="Project"
        bind:value={projSelected}
        options={projectOptions}
        placeholder="Pick a project"
        required
        disabled={$create.isPending}
      />
    {/if}

    <Input
      label="Name"
      name="line-name"
      bind:value={name}
      placeholder={`e.g. ${nameSuggestion}`}
      required
      autocomplete="off"
      disabled={$create.isPending}
    />

    <AccentSwatchPicker bind:accent autoSlug={autoAccentSlug} label="Line color" disabled={$create.isPending} />

    <!-- Hidden submit lets Enter inside an input trigger submit. -->
    <button type="submit" hidden aria-hidden="true"></button>
  </form>

  {#snippet actions()}
    <Button variant="outline" disabled={$create.isPending} onclick={close}>Cancel</Button>
    <Button loading={$create.isPending} onclick={submit}>Create</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .cln__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
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
      font-size: var(--text-s);
      color: var(--text-color);
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
      border: 1px solid var(--border-color-light);
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
