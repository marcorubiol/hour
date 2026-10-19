<script lang="ts">
  /**
   * The on/off switch: a `button` with `role="switch"`, 36×20, ink when on.
   *
   * Lifted from the privacy switch of the conversation file on its first reuse
   * («lo conozco», ADR-138 § 5), so the drawing has one home. The caller owns
   * the words: the visible label sits beside it, `label` names it for a
   * screen reader.
   */
  interface Props {
    checked: boolean;
    label: string;
    disabled?: boolean;
    onchange: (next: boolean) => void;
  }

  let { checked, label, disabled = false, onchange }: Props = $props();
</script>

<button
  type="button"
  class="switch"
  class:is-on={checked}
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  onclick={() => onchange(!checked)}
><span class="switch__dot"></span></button>

<style>
  @layer components {
    .switch {
      --switch-w: 2.25rem;
      --switch-h: 1.25rem;

      display: inline-flex;
      flex: none;
      align-items: center;
      inline-size: var(--switch-w);
      block-size: var(--switch-h);
      padding: var(--space-2xs);
      background: var(--border-color-dark);
      border: 0;
      border-radius: var(--radius-circle);
      cursor: pointer;
      transition: background var(--transition);
    }
    .switch:disabled {
      opacity: var(--disabled-opacity);
      cursor: default;
    }
    .switch__dot {
      inline-size: calc(var(--switch-h) - 0.25rem);
      block-size: calc(var(--switch-h) - 0.25rem);
      background: var(--bg-ultra-light);
      border-radius: 50%;
      box-shadow: var(--box-shadow-1);
      transition: transform var(--transition);
    }
    .switch.is-on {
      background: var(--text-color);
    }
    .switch.is-on .switch__dot {
      transform: translateX(calc(var(--switch-w) - var(--switch-h)));
    }

    /* Touch: a hit area at the finger's size, larger than the drawing. */
    @media (pointer: coarse) {
      .switch {
        position: relative;
      }
      .switch::before {
        content: '';
        position: absolute;
        inset: calc((var(--switch-h) - var(--touch-target)) / 2) calc((var(--switch-w) - var(--touch-target)) / 2);
      }
    }
  }
</style>
