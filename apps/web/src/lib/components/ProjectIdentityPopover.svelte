<script lang="ts">
  /**
   * ProjectIdentityPopover (ADR-081) — tap the monogram anywhere → a small
   * ANCHORED popover (not a modal) to change the monogram + color al momento,
   * plus an "Edit project →" door to the full editor. This is the interaction
   * Marco prototyped: quick identity edit in place, the rest one click away.
   *
   * Anchoring reuses Menu.svelte's proven pattern — a position:relative wrapper
   * with an absolutely-positioned panel + light-dismiss (click-outside / Esc) —
   * but the panel is role="dialog" (a form), not role="menu".
   *
   * Presentational-when-read-only: pass editable={false} on surfaces where the
   * viewer can't edit (or nested inside a link) and it renders just the mark.
   */
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
    /** Other projects in scope — for the case-sensitive collision warning. */
    siblings?: Array<{ id: string; initials?: string | null }>;
    /** Trigger mark size (forwarded to IdentityMark). */
    size?: string;
    /** Read-only surfaces (or a mark nested in a link): render just the mark. */
    editable?: boolean;
  }

  let { project, siblings = [], size, editable = true }: Props = $props();

  const queryClient = useQueryClient();

  let open = $state(false);
  let fullOpen = $state(false);
  let wrapperEl: HTMLElement | undefined = $state();

  let initials = $state('');
  let accent = $state<string | null>(null);

  // Seed the form once per open transition (plain latch — same pattern as the
  // edit dialogs; writing it can't re-trigger the effect).
  let seeded = false;
  $effect(() => {
    if (open && !seeded) {
      initials = project.initials ?? '';
      accent = project.accent ?? null;
      seeded = true;
    }
    if (!open) seeded = false;
  });

  let previewAccent = $derived(accentVarFor({ slug: project.slug, accent }));
  let collision = $derived(
    initials.trim().length > 0 &&
      siblings.some((s) => s.id !== project.id && (s.initials ?? '') === initials.trim()),
  );

  // Light-dismiss: click outside / Escape close the popover.
  $effect(() => {
    if (!open || !wrapperEl) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapperEl?.contains(e.target as Node)) open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') open = false;
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
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
      open = false;
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
    open = false;
    fullOpen = true;
  }
</script>

<span class="idpop-wrap" bind:this={wrapperEl}>
  {#if editable}
    <button
      type="button"
      class="idpop-trigger"
      title="Project identity"
      aria-haspopup="dialog"
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      <IdentityMark
        variant="compact"
        accent={accentVarFor(project)}
        initials={project.initials}
        name={project.name}
        {size}
      />
    </button>
  {:else}
    <IdentityMark
      variant="compact"
      accent={accentVarFor(project)}
      initials={project.initials}
      name={project.name}
      {size}
    />
  {/if}

  {#if open}
    <div class="idpop" role="dialog" aria-label="Project identity">
      <p class="idpop__name">{project.name}</p>
      <span class="eyebrow">Identity</span>

      <div class="idpop__preview">
        <IdentityMark
          variant="compact"
          accent={previewAccent}
          initials={initials}
          name={project.name}
          size="30px"
        />
      </div>

      <label class="idpop__field">
        <span>Monogram</span>
        <input
          class="idpop__input"
          bind:value={initials}
          oninput={() => {
            if (initials.length > MONOGRAM_MAX) initials = initials.slice(0, MONOGRAM_MAX);
          }}
          placeholder="e.g. MdA"
          autocomplete="off"
        />
      </label>
      {#if collision}
        <p class="idpop__collision">Another project already uses “{initials.trim()}”.</p>
      {/if}

      <AccentSwatchPicker bind:accent autoSlug={project.slug} label="Project color" />

      <div class="idpop__actions">
        <button type="button" class="idpop__link" onclick={openFull}>Edit project →</button>
        <button
          type="button"
          class="idpop__save"
          onclick={() => $save.mutate()}
          disabled={$save.isPending}
        >
          Save
        </button>
      </div>
    </div>
  {/if}
</span>

<EditProjectDialog bind:open={fullOpen} {project} {siblings} />

<style>
  @layer components {
    .idpop-wrap {
      position: relative;
      display: inline-flex;
    }

    .idpop-trigger {
      all: unset;
      cursor: pointer;
      display: inline-flex;
      border-radius: var(--radius-s);
    }
    .idpop-trigger:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 2px;
    }

    .idpop {
      position: absolute;
      inset-block-start: calc(100% + var(--space-2xs));
      inset-inline-start: 0;
      z-index: 50;
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

    .idpop__name {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--text-l);
      color: var(--text-color);
    }

    .idpop__preview {
      display: flex;
      align-items: center;
      min-block-size: 2em;
    }

    .idpop__field {
      display: flex;
      flex-direction: column;
      gap: var(--space-2xs);
    }
    .idpop__field > span {
      font-size: var(--text-xs);
      color: var(--text-dark-muted);
    }
    .idpop__input {
      font: inherit;
      padding: var(--space-2xs) var(--space-xs);
      border: 1px solid var(--border-color-dark);
      border-radius: var(--radius-s);
      background: var(--bg);
      color: var(--text-color);
    }
    .idpop__input:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 1px;
    }

    .idpop__collision {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .idpop__actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-s);
      margin-block-start: var(--space-2xs);
    }

    .idpop__link {
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
    .idpop__link:hover {
      color: var(--text-color);
    }

    .idpop__save {
      font: inherit;
      font-size: var(--text-s);
      padding: var(--space-2xs) var(--space-m);
      border: 0;
      border-radius: var(--radius-s);
      background: var(--primary);
      color: var(--bg-ultra-light);
      cursor: pointer;
    }
    .idpop__save:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
</style>
