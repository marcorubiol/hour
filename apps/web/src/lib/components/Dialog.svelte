<script lang="ts">
  /**
   * Dialog — the one frame for every add and edit (ADR-139 p4, p7).
   *
   * The paper sits one step above the canvas with a hairline, so it never
   * melts into a dark page. The title is the lens title one step down, in
   * the same italic (numbers upright, LensTitle). The body scrolls on its
   * own and the foot stays put; on a phone the paper is a sheet from below.
   *
   * The foot has two ends: `actions` on the right (a quiet «Cancelar» and
   * the one primary), `lead` on the left for the action that is not the
   * point of the dialog (delete, switch to another form) — always a word.
   *
   * THE SAVE MODEL (p7 A): a dialog writes nothing until its primary
   * button. So the frame owns what every dialog would otherwise get wrong:
   * - Esc or a click outside, with something written, does not throw it
   *   away: the foot asks, in one line, «discard or keep editing». With
   *   nothing written it closes, as before. «Cancelar» is an explicit
   *   discard and never asks. «Written» is read from the fields themselves
   *   (any value that differs from the one the dialog opened with), plus
   *   `dirty` for what is not a field (a list of people changed in place).
   *   A host that keeps its own draft (`keepsDraft`: «Añadir al plan», whose
   *   draft comes back on reopen) has nothing to lose, so the frame just
   *   closes.
   * - ⌘↵ / Ctrl↵ presses the primary button from any field.
   * - The first focus lands on the first field, never on a type pill.
   */
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';
  import LensTitle from './LensTitle.svelte';
  import { firstField, isSubmitShortcut, snapshotControls, submitTarget } from '$lib/dialog-guard';
  import { claimInvalidFocus } from '$lib/field-validity';
  import { appLocale, t } from '$lib/i18n';

  type Size = 's' | 'm' | 'l';

  interface Props {
    open?: boolean;
    title?: string;
    description?: string;
    size?: Size;
    closeOnBackdrop?: boolean;
    /** Unsaved work that is not a field value (the frame reads fields itself). */
    dirty?: boolean;
    /** The host keeps what was written across a close (a draft that comes
        back on reopen, with its own «Descartar»), so Esc and a click outside
        simply close: there is nothing to lose, nothing to ask. */
    keepsDraft?: boolean;
    onclose?: () => void;
    children?: Snippet;
    actions?: Snippet;
    lead?: Snippet;
  }

  let {
    open = $bindable(false),
    title,
    description,
    size = 'm',
    closeOnBackdrop = true,
    dirty = false,
    keepsDraft = false,
    onclose,
    children,
    actions,
    lead,
  }: Props = $props();

  const locale = appLocale();

  let dialogEl: HTMLDialogElement | undefined = $state();
  let panelEl: HTMLDivElement | undefined = $state();
  let keepEl: HTMLButtonElement | undefined = $state();
  let titleId = $derived(`dialog-${Math.random().toString(36).slice(2, 8)}`);

  /** The question in the foot: «discard or keep editing». */
  let confirming = $state(false);
  /** Something was typed or picked since the dialog opened. */
  let touched = false;
  /** The fields as the dialog opened with them. */
  let snapshot = '';
  let returnFocus: HTMLElement | null = null;

  $effect(() => {
    if (!dialogEl) return;
    if (open && !dialogEl.open) {
      confirming = false;
      touched = false;
      dialogEl.showModal();
      void settle();
    } else if (!open && dialogEl.open) {
      confirming = false;
      dialogEl.close();
    }
  });

  /** After the parent's open-reset has painted: remember the fields and
      put the caret in the first one (unless a field asked for autofocus). */
  async function settle() {
    await tick();
    if (!panelEl) return;
    snapshot = snapshotControls(panelEl);
    const active = document.activeElement;
    const autofocused = active instanceof HTMLElement && active.hasAttribute('autofocus');
    if (!autofocused) firstField(panelEl.querySelector<HTMLElement>('.dialog__body') ?? panelEl)?.focus();
  }

  $effect(() => {
    if (typeof document === 'undefined') return;
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = prev;
    };
  });

  function hasUnsaved(): boolean {
    if (keepsDraft) return false;
    if (dirty) return true;
    return touched && Boolean(panelEl) && snapshotControls(panelEl!) !== snapshot;
  }

  function finish() {
    confirming = false;
    if (open) {
      open = false;
      onclose?.();
    }
  }

  /** Esc or a click outside: close, or ask when something is written. */
  async function requestClose() {
    if (confirming) return;
    if (!hasUnsaved()) return finish();
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirming = true;
    await tick();
    keepEl?.focus();
  }

  function keepEditing() {
    confirming = false;
    returnFocus?.focus();
    returnFocus = null;
  }

  function handleClose() {
    // The native close (Esc with nothing written, or `open = false`).
    finish();
  }

  function handleCancel(event: Event) {
    // Backup for a close request that skipped keydown: never lose work.
    if (confirming || hasUnsaved()) {
      event.preventDefault();
      if (!confirming) void requestClose();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      if (confirming) {
        event.preventDefault();
        keepEditing();
      } else if (hasUnsaved()) {
        event.preventDefault();
        void requestClose();
      }
      return;
    }
    // ⌘↵ saves what is being written: a dialog with no field (a confirm
    // before sending or deleting) keeps its click.
    if (isSubmitShortcut(event) && panelEl && !confirming && firstField(panelEl)) {
      const target = submitTarget(panelEl);
      event.preventDefault();
      if (target?.kind === 'button') target.el.click();
      else target?.el.requestSubmit();
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    if (!closeOnBackdrop) return;
    if (event.target === dialogEl) void requestClose();
  }

  /** No browser bubble anywhere in a dialog: a Field says it under the
      value; a bare control at least gets the caret. */
  function handleInvalid(event: Event) {
    event.preventDefault();
    const el = event.target;
    if (el instanceof HTMLElement && !el.closest('.field') && claimInvalidFocus()) el.focus();
  }

  let dialogClasses = $derived(`dialog dialog--${size}`);
</script>

<dialog
  bind:this={dialogEl}
  class={dialogClasses}
  aria-labelledby={title ? titleId : undefined}
  onclose={handleClose}
  oncancel={handleCancel}
  onkeydown={handleKeydown}
  onclick={handleBackdropClick}
>
  <div
    class="dialog__panel"
    bind:this={panelEl}
    oninput={() => (touched = true)}
    onchange={() => (touched = true)}
    oninvalidcapture={handleInvalid}
  >
    {#if title || description}
      <header class="dialog__header">
        {#if title}<h2 id={titleId} class="dialog__title"><LensTitle text={title} /></h2>{/if}
        {#if description}
          <p class="dialog__description">{description}</p>
        {/if}
      </header>
    {/if}

    {#if children}
      <div class="dialog__body" inert={confirming || undefined}>{@render children()}</div>
    {/if}

    {#if confirming}
      <footer class="dialog__actions">
        <p class="dialog__lead dialog__ask" role="alert">{t('dialog.unsaved', locale)}</p>
        <button type="button" class="btn--quiet btn--s" bind:this={keepEl} onclick={keepEditing}
          >{t('dialog.keep_editing', locale)}</button
        >
        <button type="button" class="btn--secondary btn--s is-warn" onclick={finish}
          >{t('dialog.discard', locale)}</button
        >
      </footer>
    {:else if actions || lead}
      <footer class="dialog__actions">
        {#if lead}<div class="dialog__lead">{@render lead()}</div>{/if}
        {#if actions}{@render actions()}{/if}
      </footer>
    {/if}
  </div>
</dialog>
