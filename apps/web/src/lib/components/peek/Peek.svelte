<script lang="ts">
  /**
   * Peek: the one frame of the vistazo (ADR-139 p1 A). A panel on the right
   * over the lens, the dialog's paper at a third of the screen; on a phone,
   * the whole screen. It holds a record (the same component its page draws)
   * and says only two things of its own: «abrir completa», where the whole
   * thing lives, and «cerrar».
   *
   *   | lens, still there        | Abrir completa   Cerrar |
   *   |                          | space › project › Ensayo |
   *   |                          | Ensayo con luces         |
   *   |                          | jue 14 nov · 10h–14h     |
   *   |                          | FALTA  …                 |
   *
   * A native modal <dialog>: the browser traps focus inside it, makes the
   * lens inert and gives focus back on close. Esc and a click on the veil
   * close it through `onclose` (the address bar is the truth: the host owns
   * what is open). A dialog opened from inside (editar) keeps its own Esc.
   */
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';
  import { appLocale, t } from '$lib/i18n';

  interface Props {
    open: boolean;
    /** The panel's accessible name: what kind of thing is open. */
    label: string;
    /** «Abrir completa»: the page of the thing, when it has one. */
    full?: { href: string; label: string } | null;
    /** What is open: when it changes (the panel followed a link) it starts at the top. */
    contentKey?: string;
    onclose: () => void;
    children: Snippet;
  }

  let { open, label, full = null, contentKey = '', onclose, children }: Props = $props();

  const locale = appLocale();
  let dialogEl: HTMLDialogElement | undefined = $state();
  let panelEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (!dialogEl) return;
    if (open && !dialogEl.open) {
      dialogEl.showModal();
      // The panel itself takes focus, not its first link: Esc works at
      // once, and a reader hears the panel's name before its contents.
      void tick().then(() => panelEl?.focus());
    } else if (!open && dialogEl.open) {
      dialogEl.close();
    }
  });

  /** One close per close: a second Esc before the address has moved would
      go back one page too many. Re-armed whenever what is open changes. */
  let closing = false;
  function requestClose() {
    if (closing) return;
    closing = true;
    onclose();
  }

  // Following a link inside the panel: the new record starts at its top,
  // and the focus (which was on the link, now gone) comes back to the panel.
  $effect(() => {
    void contentKey;
    void open;
    closing = false;
    panelEl?.scrollTo({ top: 0 });
    if (open && panelEl && !panelEl.contains(document.activeElement)) panelEl.focus();
  });

  // The lens under the panel keeps its scroll: only the page stops moving.
  $effect(() => {
    if (!open || typeof document === 'undefined') return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = prev;
    };
  });

  /* Esc is the browser's close request, which goes to the topmost modal
     only: a dialog opened from inside (editar) takes its own, and a menu
     that handles Esc on its keydown stops it before it gets here. It still
     arrives with the focus lost on <body>, which a keydown here would not. */
  function handleCancel(event: Event) {
    // The host closes, through the address; the frame follows `open`.
    event.preventDefault();
    requestClose();
  }

  /** Closed by the browser without asking (a repeated close request). */
  function handleClose() {
    if (open) requestClose();
  }

  /* A click outside the panel closes it. Over the shell's top bar, which
     the veil leaves clear on a desktop (ADR-140), it also does what it
     says: the modal made the bar inert, so once the panel is closed the
     click is handed to the control under it (a section, the search). */
  function handleClick(event: MouseEvent) {
    if (event.target !== dialogEl || !dialogEl) return;
    dialogEl.close();
    requestClose();
    const under = document.elementFromPoint(event.clientX, event.clientY);
    if (under?.closest('[data-peek-through]')) under.closest<HTMLElement>('a, button')?.click();
  }
</script>

<dialog
  bind:this={dialogEl}
  class="peek"
  aria-label={label}
  data-testid="peek"
  oncancel={handleCancel}
  onclose={handleClose}
  onclick={handleClick}
>
  <div class="peek__panel" bind:this={panelEl} tabindex="-1">
    <div class="peek__bar">
      {#if full}
        <a class="block-head__act" href={full.href} data-peek="off" data-testid="peek-full">{full.label}</a>
      {/if}
      <button type="button" class="block-head__act" aria-keyshortcuts="Escape" onclick={requestClose}
        >{t('peek.close', locale)}</button
      >
    </div>
    {#if open}{@render children()}{/if}
  </div>
</dialog>

<style>
  @layer components {
    /* The element is the full-height column on the right; its paper is
       the panel. Margins push it to the inline end, in both directions. */
    .peek {
      margin: 0;
      margin-inline-start: auto;
      padding: 0;
      border: 0;
      inline-size: min(100%, var(--peek-inline));
      max-inline-size: 100%;
      block-size: 100dvh;
      max-block-size: 100dvh;
      background: transparent;
      color: inherit;
      overflow: visible;
    }
    .peek::backdrop {
      background: var(--peek-backdrop);
    }
    /* A desktop: the panel starts under the top bar, and the veil leaves the
       bar out (the rail and the page dim, the bar does not): the sections
       never leave the screen (ADR-140). */
    @media (min-width: 48rem) {
      .peek {
        margin-block-start: var(--header-height);
        block-size: calc(100dvh - var(--header-height));
        max-block-size: calc(100dvh - var(--header-height));
      }
      /* Two sheets of the same veil: the rail's column, and the page under
         the bar. The bar's band stays clear but still catches the click
         (see handleClick). */
      .peek::backdrop {
        background:
          linear-gradient(var(--peek-backdrop), var(--peek-backdrop)) 0 0 / var(--rail-width) 100% no-repeat,
          linear-gradient(var(--peek-backdrop), var(--peek-backdrop)) var(--rail-width) var(--header-height) / 100% 100%
            no-repeat;
      }
    }
    .peek__panel {
      display: flex;
      flex-direction: column;
      gap: var(--space-m);
      block-size: 100%;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: var(--space-m) var(--space-l) var(--space-xxl);
      background: var(--dialog-paper);
      color: var(--text-color);
      border-inline-start: var(--border-size) solid var(--dialog-edge);
      box-shadow: var(--box-shadow-3);
    }
    .peek__panel:focus {
      outline: none;
    }
    /* Its own two words, at the top right, out of the record's way, in the
       voice of a block's action (base.css `.block-head__act`), both alike. */
    .peek__bar {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: var(--space-m);
    }
    @media (max-width: 47.999rem) {
      .peek {
        inline-size: 100%;
      }
      .peek__panel {
        border-inline-start: 0;
        padding-block-end: max(var(--space-xxl), env(safe-area-inset-bottom));
      }
    }
  }
</style>
