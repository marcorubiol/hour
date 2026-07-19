<script lang="ts">
  /**
   * AccentSwatchPicker — the 12-swatch accent selector shared by the create
   * dialogs (workspace / project / line) and the identity editors. Auto is
   * implicit: no swatch selected means accent=null and the server derives the
   * color via hash(slug); the hint previews what Auto would pick.
   *
   * Formerly copy-pasted verbatim per dialog (~70 lines each).
   */

  import { accentVar } from '$lib/utils/accent';

  interface Props {
    /** Selected accent "1".."12", or null for auto. */
    accent?: string | null;
    /** Slug the server would hash when accent is null (auto preview). */
    autoSlug: string;
    /** Radiogroup accessible name, e.g. "Line color". */
    label: string;
    disabled?: boolean;
  }

  let { accent = $bindable(null), autoSlug, label, disabled = false }: Props = $props();
</script>

<fieldset class="swatches">
  <legend>Color</legend>
  <div class="swatch-grid" role="radiogroup" aria-label={label}>
    {#each [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as n (n)}
      {@const isOn = accent === String(n)}
      <button
        type="button"
        role="radio"
        aria-checked={isOn}
        class={['swatch', isOn && 'swatch--on'].filter(Boolean).join(' ')}
        style={`background: var(--accent-${n})`}
        aria-label={`Color ${n}`}
        {disabled}
        onclick={() => (accent = isOn ? null : String(n))}
      ></button>
    {/each}
  </div>
  <p class="swatch-hint">
    {#if accent}
      <button
        type="button"
        class="swatch-clear"
        onclick={() => (accent = null)}
        {disabled}
      >Clear · use auto</button>
    {:else}
      <span class="swatch-auto">
        <span
          class="swatch-auto-chip"
          style={`background: ${accentVar(autoSlug)}`}
          aria-hidden="true"
        ></span>
        Auto from name
      </span>
    {/if}
  </p>
</fieldset>

<style>
  @layer components {
    .swatches {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      border: 0;
      padding: 0;
      margin: 0;
    }

    .swatches > legend {
      padding: 0;
      font-size: var(--text-xs);
      color: var(--text-dark-muted);
    }

    .swatch-grid {
      display: flex;
      gap: var(--space-xs);
      flex-wrap: wrap;
    }

    .swatch {
      inline-size: 22px;
      block-size: 22px;
      padding: 0;
      border: 0;
      border-radius: var(--radius-50);
      cursor: pointer;
      box-shadow: 0 0 0 1px var(--border-color-light) inset;
      transition: box-shadow var(--transition), transform var(--transition);
    }

    .swatch:hover:not(:disabled) {
      transform: scale(1.08);
    }

    .swatch:focus-visible {
      outline: var(--focus-width) solid var(--focus-color);
      outline-offset: 2px;
    }

    .swatch--on {
      box-shadow:
        0 0 0 2px var(--bg),
        0 0 0 4px var(--text-color);
    }

    .swatch:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .swatch-hint {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--text-faint);
      min-block-size: 1.2em;
    }

    .swatch-auto {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
    }

    .swatch-auto-chip {
      inline-size: 10px;
      block-size: 10px;
      border-radius: var(--radius-50);
      box-shadow: 0 0 0 1px var(--border-color-light) inset;
    }

    .swatch-clear {
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

    .swatch-clear:hover {
      color: var(--text-color);
    }
  }
</style>
