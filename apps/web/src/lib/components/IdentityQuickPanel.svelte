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
  import { accentVarFor, accentHue, hueDistance } from '$lib/utils/accent';
  import { MONOGRAM_MAX, type EditableProject, type IdentitySibling } from '$lib/utils/identity';

  interface Props {
    project: EditableProject;
    siblings?: IdentitySibling[];
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

  // Colour warning (soft): the chosen/auto hue is within this many degrees of a
  // sibling's. The accent is a grouping cue, so this informs, never blocks.
  const COLOR_CLASH_DEG = 25;
  let colorClash = $derived.by((): string | null => {
    const mine = accentHue({ slug: project.slug, accent });
    for (const s of siblings) {
      if (s.id === project.id) continue;
      if (hueDistance(accentHue({ slug: s.slug, accent: s.accent }), mine) <= COLOR_CLASH_DEG)
        return s.name ?? 'another project';
    }
    return null;
  });

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

  // Panel mounts fresh per open → focus the monogram with the caret at the
  // start (no select-all), ready to edit from the first character.
  function focusAtStart(node: HTMLInputElement) {
    node.focus();
    node.setSelectionRange(0, 0);
  }
</script>

<div class="iqp" role="dialog" aria-label="Project identity">
  <header class="iqp__head">
    <p class="iqp__name">{project.name}</p>
    <IdentityMark
      variant="compact"
      accent={previewAccent}
      initials={initials}
      name={project.name}
      size="34px"
    />
  </header>
  <div class="iqp__identity">
    <span class="eyebrow">Identity</span>
    <input
      class="iqp__input"
      bind:value={initials}
      use:focusAtStart
      oninput={() => {
        if (initials.length > MONOGRAM_MAX) initials = initials.slice(0, MONOGRAM_MAX);
      }}
      placeholder="e.g. MdA"
      autocomplete="off"
      aria-label="Monogram"
    />
    <p class="iqp__hint">1–{MONOGRAM_MAX} characters, upper or lower case</p>
    {#if collision}
      <p class="iqp__collision">Another project already uses “{initials.trim()}”.</p>
    {/if}
  </div>

  <div class="iqp__color">
    <AccentSwatchPicker bind:accent autoSlug={project.slug} label="Project color" hideLegend />
    <!-- Space is always reserved so the warning appears without a layout jump. -->
    <p class="iqp__clash">
      {#if colorClash}A similar colour is used by {colorClash}.{/if}
    </p>
  </div>

  <div class="iqp__actions">
    <button
      type="button"
      class="iqp__save"
      onclick={() => $save.mutate()}
      disabled={$save.isPending}
    >
      Save identity
    </button>

    <hr class="iqp__rule" />

    <button type="button" class="iqp__link" onclick={openFull}>Edit project →</button>
  </div>
</div>

<EditProjectDialog bind:open={fullOpen} {project} {siblings} />

<style>
  @layer components {
    .iqp {
      inline-size: 18.5rem;
      max-inline-size: min(18.5rem, 92vw);
      display: flex;
      flex-direction: column;
      gap: var(--space-l);
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

    .iqp__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s);
    }

    /* Eyebrow + monogram input + hint stay a tight group; the larger panel
       gap gives air between this block, the colour picker and the actions. */
    .iqp__identity {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }

    .iqp__color {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }

    .iqp__hint {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--text-faint);
    }

    .iqp__input {
      inline-size: 100%;
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

    /* Colour warning — space reserved (one line) so it never shifts layout. */
    .iqp__clash {
      margin: 0;
      min-block-size: 1.2em;
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    /* Save · rule · Edit sit tighter than the panel's roomy rhythm above. */
    .iqp__actions {
      display: flex;
      flex-direction: column;
      gap: var(--space-s);
    }

    .iqp__save {
      font: inherit;
      font-weight: 600;
      font-size: var(--text-s);
      inline-size: 100%;
      padding: var(--space-xs) var(--space-m);
      border: 0;
      border-radius: var(--radius-s);
      background: var(--primary);
      color: var(--bg-ultra-light);
      cursor: pointer;
    }
    .iqp__save:hover:not(:disabled) {
      filter: brightness(0.96);
    }
    .iqp__save:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .iqp__rule {
      inline-size: 100%;
      block-size: 0;
      border: 0;
      border-block-start: 1px solid var(--border-color-light);
      margin: 0;
    }

    .iqp__link {
      align-self: center;
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
  }
</style>
