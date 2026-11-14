<script lang="ts">
  /**
   * ScopeTag — what is scoped, inside the frame's one field (ADR-202 § 12,
   * superseding the pill of ADR-152). Drawn only when something is scoped:
   * the name of the first thing («Txema Muñoz», «Gota», a line, a person),
   * «+N» for the rest, and its × that clears the scope.
   *
   * The name opens the tag's dialog (ADR-203 § 6): each token with its ×,
   * «+ añadir» (the palette as a filter, seeded with the scope), and the
   * tag's acts: save (or update, rename, delete), copy link, clear. A sheet
   * from below on a phone, a popover under the tag from 48 rem. The saved
   * scopes and the recents left this dialog for the palette's first rows.
   *
   * The dialog is the native modal `<dialog>` in the shared `.dialog` frame:
   * focus kept inside, Esc closes, focus back on the tag, unless the dialog
   * hands over to the palette or the scope is cleared (then `onclear`).
   */
  import { tick } from 'svelte';
  import ScopeGlyph from '$lib/components/ScopeGlyph.svelte';
  import { addToast } from '$lib/components/Toast.svelte';
  import { copyText } from '$lib/clipboard';
  import { scopePillLabel, type ScopeDoor } from '$lib/scope-door';
  import { usePins, type PinKind } from '$lib/stores/pins.svelte';
  import { useScopes } from '$lib/stores/scopes.svelte';
  import { appLocale, t } from '$lib/i18n';

  let { door, onclear }: { door: ScopeDoor; onclear?: () => void } = $props();

  const pins = usePins();
  const scopes = useScopes();
  const locale = appLocale();

  let label = $derived(scopePillLabel(pins.pins, door.tokenLabel) ?? '');

  /** The token's small kind word, in the session's language. */
  const KIND_KEY: Record<PinKind, string> = {
    space: 'picker.kind_space',
    project: 'picker.kind_project',
    line: 'picker.kind_line',
    person: 'planner.board_person_one',
  };
  const kindLabel = (kind: PinKind) => t(KIND_KEY[kind], locale);

  // Rename the saved scope on screen, in place.
  let renaming = $state(false);
  let renameValue = $state('');
  let renameEl: HTMLInputElement | undefined = $state();
  async function startRename() {
    if (!door.exactSaved) return;
    renaming = true;
    renameValue = door.exactSaved.name;
    await tick();
    renameEl?.select();
  }
  function commitRename() {
    if (!renaming || !door.exactSaved) return;
    scopes.rename(door.exactSaved.tokens, renameValue);
    renaming = false;
  }

  let tagEl: HTMLButtonElement | undefined = $state();
  let dialogEl: HTMLDialogElement | undefined = $state();
  let headEl: HTMLHeadingElement | undefined = $state();
  let open = $state(false);
  /** Closing to open the palette, or with the scope gone: the focus goes
      elsewhere, not back to the tag. */
  let handoff = false;
  const headId = `scopetag-${Math.random().toString(36).slice(2, 8)}`;

  /** From 48 rem the dialog is a popover hanging from the tag's bottom edge,
      its left edge on the tag's. (On a phone base.css makes it a sheet and
      ignores these.) */
  function place() {
    if (!tagEl || !dialogEl) return;
    const r = tagEl.getBoundingClientRect();
    dialogEl.style.setProperty('--scope-pop-top', `${Math.round(r.bottom)}px`);
    dialogEl.style.setProperty('--scope-pop-start', `${Math.round(r.left)}px`);
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

  function handleClose() {
    open = false;
    renaming = false;
    if (!handoff) tagEl?.focus();
    handoff = false;
  }

  function handleBackdrop(event: MouseEvent) {
    if (event.target === dialogEl) close();
  }

  function removeToken(tok: string) {
    // The last one gone: the tag goes with it, the focus to the field.
    if (pins.pins.length === 1) {
      handoff = true;
      close();
      pins.remove(tok);
      onclear?.();
      return;
    }
    pins.remove(tok);
  }

  function add() {
    handoff = true;
    close();
    door.openPalette();
  }

  /** The tag's × and the dialog's «Limpiar»: the scope goes (into Recent). */
  function clear() {
    handoff = true;
    close();
    door.clear();
    // The tag is gone with the scope: the focus goes to the field.
    onclear?.();
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
  // loose from its tag). `scrollbar-gutter: stable` keeps the width.
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

<span class="scopetag">
  <button
    bind:this={tagEl}
    type="button"
    class="scopetag__name"
    aria-label={t('shell.scope_pill_aria', locale, { scope: label })}
    aria-haspopup="dialog"
    aria-expanded={open}
    title={label}
    onclick={() => void openDialog()}>{label}</button
  ><button
    type="button"
    class="scopetag__x"
    aria-label={t('shell.remove_pin', locale, { name: label })}
    onclick={clear}><span aria-hidden="true">×</span></button
  >
</span>

<dialog
  bind:this={dialogEl}
  class="dialog dialog--s scopetag__dialog"
  aria-labelledby={headId}
  onclose={handleClose}
  onclick={handleBackdrop}
>
  <div class="dialog__panel scopetag__panel">
    <h2 class="scopetag__head" id={headId} tabindex="-1" bind:this={headEl}>{t('shell.scope_title', locale)}</h2>
    <div class="scopetag__toks">
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
      <button type="button" class="scopetag__add hit" onclick={add}>{t('shell.add', locale)}</button>
    </div>
    {#if renaming}
      <input
        class="scopetag__rename"
        aria-label={t('shell.scope_rename_aria', locale)}
        bind:this={renameEl}
        bind:value={renameValue}
        onblur={commitRename}
        onkeydown={(e) => {
          if (e.key === 'Enter') commitRename();
          else if (e.key === 'Escape') {
            // Esc leaves the rename, not the dialog.
            e.preventDefault();
            e.stopPropagation();
            renaming = false;
          }
        }}
      />
    {/if}
    <div class="scopetag__acts">
      {#if door.exactSaved}
        <button type="button" class="scopetag__act hit" onclick={() => void startRename()}
          >{t('shell.scope_rename', locale)}</button
        >
        <button type="button" class="scopetag__act hit" onclick={() => scopes.remove(pins.pins)}
          >× {t('shell.delete_scope', locale)}</button
        >
      {:else if door.isModified}
        <button type="button" class="scopetag__act hit" onclick={door.update}>↺ {t('shell.scope_update', locale)}</button>
        <button type="button" class="scopetag__act hit" onclick={door.save}>☆ {t('shell.save_new_scope', locale)}</button>
      {:else}
        <button type="button" class="scopetag__act hit" onclick={door.save}>☆ {t('shell.scope_save', locale)}</button>
      {/if}
      <button type="button" class="scopetag__act hit" onclick={copyLink}>{t('shell.copy_link', locale)}</button>
      <button type="button" class="scopetag__act scopetag__clear hit" onclick={clear}>{t('shell.clear', locale)}</button>
    </div>
  </div>
</dialog>

<style>
  /* THE TAG. A chip inside the field, one tint above it, the name in ink and
     its × faint: what you are looking at, not a button calling for a press.
     Above the field's own button, which takes every other press. */
  .scopetag {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    flex: 0 1 auto;
    min-inline-size: 0;
    max-inline-size: 60%;
    border-radius: var(--radius-circle);
    background: var(--bg-light);
    font-size: var(--text-s);
    line-height: 1.2;
  }
  .scopetag__name,
  .scopetag__x {
    position: relative;
    padding-block: var(--space-2xs);
    border: 0;
    background: none;
    font: inherit;
    cursor: pointer;
  }
  .scopetag__name {
    min-inline-size: 0;
    overflow: hidden;
    padding-inline: var(--space-s) var(--space-2xs);
    color: var(--heading-color);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .scopetag__x {
    flex: none;
    padding-inline: var(--space-2xs) var(--space-s);
    color: var(--text-faint);
  }
  @media (hover: hover) {
    .scopetag__x:hover,
    .scopetag__name:hover {
      color: var(--text-color);
    }
  }
  /* The × is small to the eye and finger-sized to the touch. */
  .scopetag__x::before {
    content: '';
    position: absolute;
    inset: min(0em, calc((1.5em - var(--touch-target)) / 2));
  }

  /* THE DIALOG. On a phone base.css makes `.dialog` a sheet from below; from
     48 rem it is a popover hanging from the tag, its left edge on the tag's,
     over a clear backdrop: it belongs to the tag, not to a page. */
  .scopetag__panel {
    gap: var(--space-m);
    padding: var(--space-m);
    font-size: var(--text-s);
  }
  @media (max-width: 47.999rem) {
    .scopetag__panel {
      padding-block-end: max(var(--space-m), env(safe-area-inset-bottom));
    }
  }
  @media (min-width: 48rem) {
    .scopetag__dialog {
      position: fixed;
      inset-block: calc(var(--scope-pop-top) + var(--space-xs)) auto;
      inset-inline: min(var(--scope-pop-start), calc(100vw - 22rem - var(--shell-gutter))) auto;
      margin: 0;
    }
    .scopetag__dialog::backdrop {
      background: transparent;
    }
    .scopetag__panel {
      inline-size: min(calc(100vw - 2 * var(--shell-gutter)), 22rem);
      max-block-size: calc(100dvh - var(--scope-pop-top) - var(--dialog-gutter));
      box-shadow: var(--box-shadow-2);
    }
  }
  /* A label, not a block's head: the body face in its own case (mono
     capitals are for block heads only, ADR-145 § 3). */
  .scopetag__head {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 400;
    color: var(--text-faint);
  }
  .scopetag__head:focus {
    outline: none;
  }
  .scopetag__toks {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-s);
  }
  .scopetag__rename {
    inline-size: 100%;
    padding: var(--space-xs);
    border: var(--line-hairline) solid var(--field-border-color-focus);
    border-radius: var(--radius-m);
    background: var(--bg-ultra-light);
    color: var(--text-color);
    font-family: var(--font-sans);
    font-size: var(--text-s);
    outline: none;
  }
  .scopetag__acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs) var(--space-m);
    padding-block-start: var(--space-s);
    border-block-start: var(--line-hairline) solid var(--border-color-light);
  }
  .scopetag__act {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .scopetag__act:hover {
    color: var(--text-color);
  }
  .scopetag__clear {
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
  .scopetag__add {
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
  .scopetag__add:hover {
    color: var(--text-color);
    border-color: var(--text-muted);
  }
</style>
