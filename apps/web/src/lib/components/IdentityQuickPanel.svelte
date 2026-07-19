<script lang="ts">
  /**
   * IdentityQuickPanel (ADR-081) — the quick identity form (monogram + color +
   * "Edit project →"), with NO trigger and NO anchoring of its own. The caller
   * positions it: ProjectIdentityPopover renders it absolute below a trigger;
   * the calendar renders it fixed at the clicked monogram's rect (so it escapes
   * the month cells' overflow:hidden). One form, two mountings.
   *
   * Mounts fresh per open, so it seeds straight from props — no open-latch.
   */
  import { untrack } from 'svelte';
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { ApiError, mutateJSON } from '$lib/api';
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import EditProjectDialog from '$lib/components/EditProjectDialog.svelte';
  import AccentSwatchPicker from '$lib/components/create/AccentSwatchPicker.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { accentVarFor } from '$lib/utils/accent';
  import { MONOGRAM_MAX, type EditableProject } from '$lib/utils/identity';

  interface Props {
    project: EditableProject;
    siblings?: Array<{ id: string; initials?: string | null }>;
    onclose: () => void;
  }

  let { project, siblings = [], onclose }: Props = $props();

  const queryClient = useQueryClient();

  // Panel mounts fresh per open → seed once from props (untrack silences the
  // state_referenced_locally lint; the capture is intentional).
  let initials = $state(untrack(() => project.initials ?? ''));
  let accent = $state<string | null>(untrack(() => project.accent ?? null));
  let fullOpen = $state(false);

  let previewAccent = $derived(accentVarFor({ slug: project.slug, accent }));
  let collision = $derived(
    initials.trim().length > 0 &&
      siblings.some((s) => s.id !== project.id && (s.initials ?? '') === initials.trim()),
  );

  const save = createMutation({
    mutationFn: async () => {
      const res = await mutateJSON<{ project: { id: string; slug: string } }>(
        'PATCH',
        `/api/projects/${project.id}`,
        { accent, initials: initials.trim() },
      );
      if (!res?.project) throw new Error('Empty response');
      return res.project;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      await queryClient.invalidateQueries({ queryKey: ['project', project.slug] });
      // The calendar chips read the project from the perf/date feeds, not the
      // projects cache — refetch those so the monogram/color repaint there too.
      await queryClient.invalidateQueries({ queryKey: ['planner-performances'] });
      await queryClient.invalidateQueries({ queryKey: ['planner-dates'] });
      onclose();
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Not saved',
        message:
          err instanceof ApiError && err.status === 403
            ? "You don't have permission to edit this project."
            : 'Unexpected error',
      });
    },
  });

  function openFull() {
    fullOpen = true;
  }
</script>

<div class="iqp" role="dialog" aria-label="Project identity">
  <p class="iqp__name">{project.name}</p>
  <span class="eyebrow">Identity</span>

  <div class="iqp__preview">
    <IdentityMark
      variant="compact"
      accent={previewAccent}
      initials={initials}
      name={project.name}
      size="30px"
    />
  </div>

  <label class="iqp__field">
    <span>Monogram</span>
    <input
      class="iqp__input"
      bind:value={initials}
      oninput={() => {
        if (initials.length > MONOGRAM_MAX) initials = initials.slice(0, MONOGRAM_MAX);
      }}
      placeholder="e.g. MdA"
      autocomplete="off"
    />
  </label>
  {#if collision}
    <p class="iqp__collision">Another project already uses “{initials.trim()}”.</p>
  {/if}

  <AccentSwatchPicker bind:accent autoSlug={project.slug} label="Project color" />

  <div class="iqp__actions">
    <button type="button" class="iqp__link" onclick={openFull}>Edit project →</button>
    <button
      type="button"
      class="iqp__save"
      onclick={() => $save.mutate()}
      disabled={$save.isPending}
    >
      Save
    </button>
  </div>
</div>

<EditProjectDialog bind:open={fullOpen} {project} {siblings} />

<style>
  @layer components {
    .iqp {
      inline-size: 15rem;
      max-inline-size: min(15rem, 90vw);
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
      padding: var(--space-m);
      background: var(--bg-ultra-light);
      border: 1px solid var(--border-color-light);
      border-radius: var(--radius-m);
      box-shadow: var(--box-shadow-3, 0 8px 24px rgb(0 0 0 / 12%));
    }

    .iqp__name {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--text-l);
      color: var(--text-color);
    }

    .iqp__preview {
      display: flex;
      align-items: center;
      min-block-size: 2em;
    }

    .iqp__field {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }
    .iqp__field > span {
      font-size: var(--text-xs);
      color: var(--text-dark-muted);
    }
    .iqp__input {
      font: inherit;
      padding: var(--space-2xs) var(--space-xs);
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-s);
      background: var(--bg);
      color: var(--text-color);
    }
    .iqp__input:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 1px;
    }

    .iqp__collision {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .iqp__actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s);
      margin-block-start: var(--space-2xs);
    }

    .iqp__link {
      background: transparent;
      border: 0;
      padding: 0;
      font: inherit;
      font-size: var(--text-s);
      color: var(--text-muted);
      cursor: pointer;
      text-decoration: underline dotted;
      text-underline-offset: 2px;
    }
    .iqp__link:hover {
      color: var(--text-color);
    }

    .iqp__save {
      font: inherit;
      font-size: var(--text-s);
      padding: var(--space-2xs) var(--space-m);
      border: 0;
      border-radius: var(--radius-s);
      background: var(--primary);
      color: var(--bg-ultra-light);
      cursor: pointer;
    }
    .iqp__save:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
</style>
