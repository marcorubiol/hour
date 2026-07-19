<script lang="ts">
  /**
   * Edit-project dialog (ADR-081) — the full project editor and the target of
   * the identity popover's "Edit project →" door. Identity section first (live
   * monogram preview + free-form initials + the 12-swatch color), then name +
   * description. PATCHed via update_project (owner/admin/member). Seeds from the
   * project on open; on success invalidates the projects caches so every
   * IdentityMark across the app repaints in place.
   *
   * i18n: strings are literal English here, matching the sibling create/edit
   * dialogs (not yet keyed); folds into the i18n sweep later.
   */
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { ApiError, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import AccentSwatchPicker from '$lib/components/create/AccentSwatchPicker.svelte';
  import { accentVarFor } from '$lib/utils/accent';
  import { MONOGRAM_MAX } from '$lib/utils/identity';

  export type EditableProject = {
    id: string;
    slug: string;
    name: string;
    accent?: string | null;
    initials?: string | null;
    description?: string | null;
  };

  interface Props {
    open?: boolean;
    project: EditableProject | null;
    /** Other projects in scope — for the case-sensitive collision warning. */
    siblings?: Array<{ id: string; initials?: string | null }>;
  }

  let { open = $bindable(false), project, siblings = [] }: Props = $props();

  const queryClient = useQueryClient();

  let name = $state('');
  let accent = $state<string | null>(null); // null = auto (hash of slug)
  let initials = $state('');
  let description = $state('');

  // Seed once per open transition (plain latch — writing it can't re-trigger).
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen && project) {
      name = project.name ?? '';
      accent = project.accent ?? null;
      initials = project.initials ?? '';
      description = project.description ?? '';
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
      addToast({ tone: 'success', message: 'Project updated.' });
      close();
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Not saved',
        message:
          err instanceof ApiError && err.status === 403
            ? "You don't have permission to edit this project."
            : err instanceof Error
              ? err.message
              : 'Unexpected error',
      });
    },
  });

  function submit(event?: Event) {
    event?.preventDefault();
    if (!name.trim()) {
      addToast({ tone: 'warning', message: 'Name cannot be empty.' });
      return;
    }
    $save.mutate();
  }
</script>

<Dialog bind:open title="Edit project" size="s">
  <form class="epj__form" onsubmit={submit}>
    <section class="epj__identity" aria-label="Project identity">
      <span class="eyebrow">Identity</span>
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
        label="Monogram"
        name="project-initials"
        bind:value={initials}
        oninput={() => {
          if (initials.length > MONOGRAM_MAX) initials = initials.slice(0, MONOGRAM_MAX);
        }}
        placeholder="e.g. MdA"
        autocomplete="off"
        helper="Up to 3 characters. Blank = derived from the name."
        disabled={$save.isPending}
      />
      {#if collision}
        <p class="epj__collision" role="status">
          Another project already uses “{initials.trim()}”. It still works — the color keeps
          them apart — but you may want a distinct monogram.
        </p>
      {/if}

      <AccentSwatchPicker
        bind:accent
        autoSlug={project?.slug || name.trim() || 'project'}
        label="Project color"
        disabled={$save.isPending}
      />
    </section>

    <Input
      label="Name"
      name="project-name"
      bind:value={name}
      required
      autocomplete="off"
      disabled={$save.isPending}
    />

    <label class="field">
      <span>Description</span>
      <textarea
        class="epj__desc"
        bind:value={description}
        maxlength="280"
        rows="3"
        placeholder="Optional. What is this project?"
        disabled={$save.isPending}
      ></textarea>
      <span class="epj__desc-count">{description.length} / 280</span>
    </label>

    <button type="submit" hidden aria-hidden="true"></button>
  </form>

  {#snippet actions()}
    <Button variant="outline" disabled={$save.isPending} onclick={close}>Cancel</Button>
    <Button loading={$save.isPending} onclick={submit}>Save</Button>
  {/snippet}
</Dialog>

<style>
  @layer components {
    .epj__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }

    .epj__identity {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding: var(--space-s);
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-m);
      background: var(--bg-light);
    }

    .epj__preview {
      display: flex;
      align-items: center;
      min-block-size: 2.4em;
    }

    .epj__collision {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .epj__desc {
      resize: vertical;
      min-block-size: 5em;
    }

    .epj__desc-count {
      font-size: var(--text-xs);
      color: var(--text-faint);
      text-align: end;
    }
  }
</style>
