<script lang="ts">
  /**
   * ScopePill — the scope, as one pill in the lens's title row (ADR-152,
   * amending ADR-145 § 5 and ADR-139 § 6). Same place on every lens, at every
   * width.
   *
   * - Unscoped it says «Todo», dashed (the shape of «+ acotar»), and opens
   *   the palette straight away: there is nothing to list yet.
   * - Scoped it says the name of what is scoped, never a different level
   *   («Txema Muñoz», «Gota», a line, a person), «+N» for the rest, and a
   *   small ▾. It opens a dialog: a sheet from below on a phone, a popover
   *   under the pill from 48 rem, with each token (removable ×), «+ añadir»,
   *   save, copy link and clear. Nothing of occasional use stays on screen.
   *
   * The dialog is the native modal `<dialog>` in the shared `.dialog` frame
   * (the phone's sheet comes from base.css): focus kept inside, Esc closes,
   * focus back on the pill, unless the dialog hands over to the palette.
   */
  import { tick } from 'svelte';
  import ScopeGlyph from '$lib/components/ScopeGlyph.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { copyText } from '$lib/clipboard';
  import { scopePillLabel, type ScopeDoor } from '$lib/scope-door';
  import { usePins, type PinKind } from '$lib/stores/pins.svelte';
  import { useScopes } from '$lib/stores/scopes.svelte';
  import { appLocale, t } from '$lib/i18n';

  let { door }: { door: ScopeDoor } = $props();

  const pins = usePins();
  const scopes = useScopes();
  const locale = appLocale();

  let label = $derived(scopePillLabel(pins.pins, door.tokenLabel));
  let everything = $derived(t('shell.everything', locale));

  /** The token's small kind word, in the session's language. */
  const KIND_KEY: Record<PinKind, string> = {
    space: 'picker.kind_space',
    project: 'picker.kind_project',
    line: 'picker.kind_line',
    person: 'planner.board_person_one',
  };
  const kindLabel = (kind: PinKind) => t(KIND_KEY[kind], locale);

  let pillEl: HTMLButtonElement | undefined = $state();
  let dialogEl: HTMLDialogElement | undefined = $state();
  let headEl: HTMLHeadingElement | undefined = $state();
  let open = $state(false);
  /** Closing to open the palette: the focus goes there, not back here. */
  let handoff = false;
  const headId = `lensscope-${Math.random().toString(36).slice(2, 8)}`;

  /** From 48 rem the dialog is a popover: it hangs from the pill's bottom
      edge, its right edge on the pill's. (On a phone base.css makes it a
      sheet and ignores these.) */
  function place() {
    if (!pillEl || !dialogEl) return;
    const r = pillEl.getBoundingClientRect();
    dialogEl.style.setProperty('--scope-pop-top', `${Math.round(r.bottom)}px`);
    dialogEl.style.setProperty('--scope-pop-end', `${Math.round(document.documentElement.clientWidth - r.right)}px`);
  }

  async function openDialog() {
    if (!dialogEl || dialogEl.open) return;
    place();
    dialogEl.showModal();
    open = true;
    await tick();
    // The dialog's name first, not the first token's ×: Enter must not remove.
    headEl?.focus();
  }

  function close() {
    if (dialogEl?.open) dialogEl.close();
  }

  function onPill() {
    if (label === null) door.openPalette();
    else void openDialog();
  }

  function handleClose() {
    open = false;
    if (!handoff) pillEl?.focus();
    handoff = false;
  }

  function handleBackdrop(event: MouseEvent) {
    if (event.target === dialogEl) close();
  }

  function removeToken(tok: string) {
    pins.remove(tok);
    // The last one gone: nothing left to list, the pill says «Todo».
    if (pins.pins.length === 0) close();
  }

  function add() {
    handoff = true;
    close();
    door.openPalette();
  }

  function clear() {
    door.clear();
    close();
  }

  // Copy link: the ADR-022 level-3 gesture. The URL already carries the
  // scope, canonical id-form by construction (pins hold slugs, never aliases).
  async function copyLink() {
    close();
    if (await copyText(location.href)) {
      addToast({ tone: 'success', message: t('shell.link_copied', locale) });
    } else {
      addToast({ tone: 'danger', message: t('shell.link_copy_failed', locale) });
    }
  }

  // The page does not scroll under an open dialog (the popover would come
  // loose from its pill). `scrollbar-gutter: stable` keeps the width.
  $effect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = prev;
    };
  });
</script>

<svelte:window onresize={() => open && place()} />

<button
  bind:this={pillEl}
  type="button"
  class="lensscope"
  class:lensscope--all={label === null}
  aria-label={label === null
    ? t('shell.scope_door_aria', locale, { scope: everything })
    : t('shell.scope_pill_aria', locale, { scope: label })}
  aria-haspopup={label === null ? undefined : 'dialog'}
  aria-expanded={label === null ? undefined : open}
  title={label === null ? t('shell.everything_all', locale) : label}
  onclick={onPill}
>
  {#if label === null}
    {everything}
  {:else}
    <span class="lensscope__name">{label}</span><span class="lensscope__caret" aria-hidden="true">▾</span>
  {/if}
</button>

<dialog
  bind:this={dialogEl}
  class="dialog dialog--s lensscope__dialog"
  aria-labelledby={headId}
  onclose={handleClose}
  onclick={handleBackdrop}
>
  <div class="dialog__panel lensscope__panel">
    <h2 class="lensscope__head" id={headId} tabindex="-1" bind:this={headEl}>{t('planner.lanes_scope', locale)}</h2>
    <div class="lensscope__toks">
      {#each pins.pins as tok (tok)}
        <span class="tok tok--{door.tokenKind(tok)}">
          <ScopeGlyph kind={door.tokenKind(tok)} accent={door.tokenAccent(tok)} lineKind={door.tokenLineKind(tok)} />
          <span class="tok__label">
            <span class="tok__kind">{kindLabel(door.tokenKind(tok))}</span>
            <span class="tok__name">{door.tokenLabel(tok)}</span>
          </span>
          <button
            type="button"
            class="tok__x hit"
            onclick={() => removeToken(tok)}
            aria-label={t('shell.remove_pin', locale, { name: door.tokenLabel(tok) })}>×</button
          >
        </span>
      {/each}
      <button type="button" class="lensscope__add hit" onclick={add}>{t('shell.add', locale)}</button>
    </div>
    <div class="lensscope__acts">
      {#if door.exactSaved}
        <button type="button" class="lensscope__act hit" onclick={() => scopes.remove(pins.pins)}
          >× {t('shell.delete_scope', locale)}</button
        >
      {:else if door.isModified}
        <button type="button" class="lensscope__act hit" onclick={door.update}>↺ {t('shell.scope_update', locale)}</button>
        <button type="button" class="lensscope__act hit" onclick={door.save}>☆ {t('shell.save_new_scope', locale)}</button>
      {:else}
        <button type="button" class="lensscope__act hit" onclick={door.save}>☆ {t('shell.scope_save', locale)}</button>
      {/if}
      <button type="button" class="lensscope__act hit" onclick={copyLink}>{t('shell.copy_link', locale)}</button>
      <button type="button" class="lensscope__act lensscope__clear hit" onclick={clear}>{t('shell.clear', locale)}</button>
    </div>
  </div>
</dialog>

<style>
  /* THE PILL. A chip in the body face, one tint above the page, so it reads
     as «what you are looking at» and not as a button calling for a press.
     Unscoped, the dashed door of «+ acotar», «Todo» in the italic display. */
  .lensscope {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2xs);
    /* A long name ellipsizes; the title row keeps its title. */
    max-inline-size: 14em;
    padding-block: var(--space-2xs);
    padding-inline: var(--space-s);
    border: var(--line-hairline) solid var(--border-color-dark);
    border-radius: var(--radius-circle);
    background: var(--bg-light);
    color: var(--text-color);
    font-family: var(--font-sans);
    font-style: normal;
    font-size: var(--text-s);
    line-height: 1.2;
    white-space: nowrap;
    cursor: pointer;
    transition:
      color var(--transition),
      border-color var(--transition);
  }
  .lensscope[aria-expanded='true'] {
    border-color: var(--text-muted);
  }
  /* Hover only where there is one: on a phone a tap left the pill dark. */
  @media (hover: hover) {
    .lensscope:hover {
      border-color: var(--text-muted);
    }
    .lensscope--all:hover {
      color: var(--text-color);
    }
  }
  /* The touch target grows past the drawn pill, never the pill itself. */
  .lensscope::before {
    content: '';
    position: absolute;
    inset: min(0em, calc((2em - var(--touch-target)) / 2));
  }
  .lensscope--all {
    border-style: dashed;
    background: none;
    color: var(--text-muted);
    font-family: var(--font-display);
    font-style: italic;
  }
  .lensscope__name {
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .lensscope__caret {
    flex: none;
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }

  /* THE DIALOG. On a phone base.css makes `.dialog` a sheet from below; from
     48 rem it is a popover hanging from the pill, its right edge on the
     pill's, over a clear backdrop: it belongs to the pill, not to a page. */
  .lensscope__panel {
    gap: var(--space-m);
    padding: var(--space-m);
    font-size: var(--text-s);
  }
  @media (max-width: 47.999rem) {
    .lensscope__panel {
      padding-block-end: max(var(--space-m), env(safe-area-inset-bottom));
    }
  }
  @media (min-width: 48rem) {
    .lensscope__dialog {
      position: fixed;
      inset-block: calc(var(--scope-pop-top) + var(--space-xs)) auto;
      inset-inline: auto var(--scope-pop-end);
      margin: 0;
    }
    .lensscope__dialog::backdrop {
      background: transparent;
    }
    .lensscope__panel {
      inline-size: min(calc(100vw - 2 * var(--shell-gutter)), 22rem);
      max-block-size: calc(100dvh - var(--scope-pop-top) - var(--dialog-gutter));
      box-shadow: var(--box-shadow-2);
    }
  }
  /* A label, not a block's head: the body face in its own case (mono
     capitals are for block heads only, ADR-145 § 3). */
  .lensscope__head {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 400;
    color: var(--text-faint);
  }
  .lensscope__head:focus {
    outline: none;
  }
  .lensscope__toks {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-s);
  }
  .lensscope__acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs) var(--space-m);
    padding-block-start: var(--space-s);
    border-block-start: var(--line-hairline) solid var(--border-color-light);
  }
  .lensscope__act {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .lensscope__act:hover {
    color: var(--text-color);
  }
  .lensscope__clear {
    margin-inline-start: auto;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  /* A token: glyph, kind and name, and its ×. */
  .tok {
    --glyph: 0.6875rem; /* the compact glyph of a token */
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    border-radius: var(--radius-circle);
    padding-block: var(--space-2xs);
    padding-inline: var(--space-xs);
    font-size: var(--text-s);
    line-height: 1;
    border: var(--line-hairline) solid var(--border-color-dark);
    background: var(--bg-light);
  }
  /* Kind label and name share a baseline INSIDE this group; the group, the
     glyph and the × stay centred as boxes via .tok's align-items. */
  .tok__label {
    display: inline-flex;
    align-items: baseline;
    gap: 0.15rem;
  }
  .tok__kind {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    line-height: 1;
    color: var(--text-faint);
  }
  .tok__name {
    line-height: 1;
  }
  .tok__x {
    display: grid;
    place-items: center;
    inline-size: 1rem;
    block-size: 1rem;
    padding: 0;
    border: 0;
    border-radius: var(--radius-circle);
    background: transparent;
    color: var(--text-faint);
    cursor: pointer;
    font-size: var(--text-m);
    line-height: 1;
  }
  .tok__x:hover {
    background: color-mix(in oklch, var(--text-color) 10%, transparent);
    color: var(--text-color);
  }
  .lensscope__add {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-faint);
    border: var(--line-hairline) dashed var(--border-color-dark);
    border-radius: var(--radius-circle);
    padding-block: var(--space-2xs);
    padding-inline: var(--space-s);
    cursor: pointer;
    background: transparent;
  }
  .lensscope__add:hover {
    color: var(--text-color);
    border-color: var(--text-muted);
  }
</style>
