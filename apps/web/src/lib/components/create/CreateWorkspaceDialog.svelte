<script lang="ts">
  /**
   * New-workspace dialog — the creation flow ported out of the retired
   * Plaza sidebar. Name + accent swatch (8-color palette, Auto = server
   * derives via hash(slug)) + description. POST /api/workspaces, then wait
   * for the ['workspaces'] cache to hold the new row BEFORE navigating —
   * the workspace page reads that cache and 404s if the row isn't there.
   */
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { ApiError, mutateJSON } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Input from '$lib/components/Input.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { accentVar } from '$lib/utils/accent';

  interface Props {
    open?: boolean;
  }

  let { open = $bindable(false) }: Props = $props();

  type CreatedWorkspace = { id: string; slug: string; name: string };

  const queryClient = useQueryClient();

  let name = $state('');
  let accent = $state<string | null>(null); // null = auto (hash of slug)
  let description = $state('');

  // Live preview of the color Auto would pick for the typed name.
  let autoAccentSlug = $derived(name.trim() || 'workspace');

  function reset() {
    name = '';
    accent = null;
    description = '';
  }

  function close() {
    open = false;
    reset();
  }

  const create = createMutation({
    mutationFn: async (input: { name: string; accent: string | null; description: string }) => {
      const body: Record<string, string> = { name: input.name };
      if (input.accent) body.accent = input.accent;
      if (input.description.trim()) body.description = input.description.trim();
      const res = await mutateJSON<{ workspace: CreatedWorkspace }>(
        'POST',
        '/api/workspaces',
        body,
      );
      if (!res?.workspace) throw new Error('Empty response');
      return res.workspace;
    },
    onSuccess: async (workspace) => {
      // Refetch must land before goto — the target page 404s otherwise.
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      await queryClient.refetchQueries({ queryKey: ['workspaces'] });
      close();
      await goto(`/h/${workspace.slug}/`);
    },
    onError: (err) => {
      addToast({
        tone: 'danger',
        title: 'Workspace not created',
        message:
          err instanceof ApiError && err.status === 409
            ? 'A workspace with that name already exists.'
            : err instanceof Error
              ? err.message
              : 'Unexpected error',
      });
    },
  });

  function submit(event?: Event) {
    event?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      addToast({ tone: 'warning', message: 'Name cannot be empty.' });
      return;
    }
    $create.mutate({ name: trimmed, accent, description });
  }
</script>

<Dialog
  bind:open
  title="New workspace"
  description="A workspace groups your projects under your personal account."
  size="s"
  onclose={reset}
>
  <form class="cws__form" onsubmit={submit}>
    <Input
      label="Name"
      name="workspace-name"
      bind:value={name}
      placeholder="e.g. Side projects"
      required
      autofocus
      autocomplete="off"
      disabled={$create.isPending}
    />

    <!-- Color picker: 8 swatches mapped to --accent-1..--accent-8. Auto is
         implicit — no swatch selected submits accent=null and the server
         derives via hash(slug); the hint previews what Auto would pick. -->
    <fieldset class="cws__swatches">
      <legend>Color</legend>
      <div class="cws__swatch-grid" role="radiogroup" aria-label="Workspace color">
        {#each [1, 2, 3, 4, 5, 6, 7, 8] as n (n)}
          {@const isOn = accent === String(n)}
          <button
            type="button"
            role="radio"
            aria-checked={isOn}
            class={['cws__swatch', isOn && 'cws__swatch--on'].filter(Boolean).join(' ')}
            style={`background: var(--accent-${n})`}
            aria-label={`Color ${n}`}
            disabled={$create.isPending}
            onclick={() => (accent = isOn ? null : String(n))}
          ></button>
        {/each}
      </div>
      <p class="cws__swatch-hint">
        {#if accent}
          <button
            type="button"
            class="cws__swatch-clear"
            onclick={() => (accent = null)}
            disabled={$create.isPending}
          >Clear · use auto</button>
        {:else}
          <span class="cws__swatch-auto">
            <span
              class="cws__swatch-auto-chip"
              style={`background: ${accentVar(autoAccentSlug)}`}
              aria-hidden="true"
            ></span>
            Auto from name
          </span>
        {/if}
      </p>
    </fieldset>

    <label class="field">
      <span>Description</span>
      <textarea
        class="cws__desc"
        bind:value={description}
        maxlength="280"
        rows="3"
        placeholder="Optional. What is this workspace for?"
        disabled={$create.isPending}
      ></textarea>
      <span class="cws__desc-count">{description.length} / 280</span>
    </label>

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
    .cws__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
    }

    /* Color picker — 8 round swatches in a single row (ported from Plaza).
       Selected state is a ring around the dot, not a border on the dot
       itself, so the palette color reads cleanly at all sizes. */
    .cws__swatches {
      border: 0;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .cws__swatches > legend {
      padding: 0;
      font-size: var(--text-s);
      color: var(--text-color);
    }

    .cws__swatch-grid {
      display: flex;
      gap: var(--space-xs);
      flex-wrap: wrap;
    }

    .cws__swatch {
      inline-size: 22px;
      block-size: 22px;
      padding: 0;
      border: 0;
      border-radius: var(--radius-50);
      cursor: pointer;
      box-shadow: 0 0 0 1px var(--border-color-light) inset;
      transition: box-shadow var(--transition), transform var(--transition);
    }

    .cws__swatch:hover:not(:disabled) {
      transform: scale(1.08);
    }

    .cws__swatch:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 2px;
    }

    .cws__swatch--on {
      box-shadow:
        0 0 0 2px var(--bg),
        0 0 0 4px var(--text-color);
    }

    .cws__swatch:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .cws__swatch-hint {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--text-faint);
      min-block-size: 1.2em;
    }

    .cws__swatch-auto {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
    }

    .cws__swatch-auto-chip {
      inline-size: 10px;
      block-size: 10px;
      border-radius: var(--radius-50);
      box-shadow: 0 0 0 1px var(--border-color-light) inset;
    }

    .cws__swatch-clear {
      background: transparent;
      border: 0;
      padding: 0;
      font-family: inherit;
      font-size: var(--text-xs);
      color: var(--text-muted);
      cursor: pointer;
      text-decoration: underline dotted;
      text-underline-offset: 2px;
    }

    .cws__swatch-clear:hover {
      color: var(--text-color);
    }

    .cws__desc {
      resize: vertical;
      min-block-size: 5em;
    }

    .cws__desc-count {
      font-size: var(--text-xs);
      color: var(--text-faint);
      text-align: end;
    }
  }
</style>
