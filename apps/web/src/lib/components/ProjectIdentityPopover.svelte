<script lang="ts">
  /**
   * ProjectIdentityPopover (ADR-081) — a monogram trigger that opens the quick
   * identity editor (IdentityQuickPanel) ANCHORED below it: change the monogram
   * + color al momento, "Edit project →" for the rest. Non-modal, light-dismiss.
   *
   * For the anchored case (headers, legend) the panel is position:absolute in a
   * relative wrapper — fine where nothing clips it. The calendar, whose cells
   * clip, opens IdentityQuickPanel itself at a fixed rect instead.
   *
   * Read-only surfaces (or a mark nested in a link) pass editable={false} → just
   * the mark, no trigger.
   */
  import IdentityMark from '$lib/components/IdentityMark.svelte';
  import IdentityQuickPanel from '$lib/components/IdentityQuickPanel.svelte';
  import { accentVarFor } from '$lib/utils/accent';
  import type { EditableProject } from '$lib/utils/identity';

  interface Props {
    project: EditableProject;
    /** Other projects in scope — for the case-sensitive collision warning. */
    siblings?: Array<{ id: string; initials?: string | null }>;
    /** Trigger mark size (forwarded to IdentityMark). */
    size?: string;
    /** Trigger variant — 'full' shows the name too (legend chips). */
    variant?: 'compact' | 'full';
    /** Read-only surfaces (or a mark nested in a link): render just the mark. */
    editable?: boolean;
  }

  let { project, siblings = [], size, variant = 'compact', editable = true }: Props = $props();

  let open = $state(false);
  let wrapperEl: HTMLElement | undefined = $state();

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
      <IdentityMark {variant} accent={accentVarFor(project)} initials={project.initials} name={project.name} {size} />
    </button>
  {:else}
    <IdentityMark {variant} accent={accentVarFor(project)} initials={project.initials} name={project.name} {size} />
  {/if}

  {#if open}
    <div class="idpop-anchor">
      <IdentityQuickPanel {project} {siblings} onclose={() => (open = false)} />
    </div>
  {/if}
</span>

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

    .idpop-anchor {
      position: absolute;
      inset-block-start: calc(100% + var(--space-2xs));
      inset-inline-start: 0;
      z-index: 50;
    }
  }
</style>
