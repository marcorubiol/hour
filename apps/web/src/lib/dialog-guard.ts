/**
 * The dialog's save model, in plain DOM (ADR-139 p7): what counts as «there
 * is something written here», which key saves, and where the eye starts.
 *
 * Dialog.svelte is the only caller. It lives apart so it can be tested
 * without a <dialog> (jsdom has no showModal) and so the rules read in one
 * place: a dialog writes nothing until its primary button, and closing it
 * with something written asks first.
 */

const CONTROLS = 'input, select, textarea';

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function controlsOf(root: HTMLElement): Control[] {
  // Cloudflare's worker types shadow the DOM `Element`, so a select does
  // not type as an HTMLElement here: narrow by instanceof, one by one.
  const out: Control[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(CONTROLS)) as unknown[]) {
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      out.push(el);
    }
  }
  return out;
}

/** Every value a person can change inside `root`, as one comparable string. */
export function snapshotControls(root: HTMLElement): string {
  const parts: string[] = [];
  for (const el of controlsOf(root)) {
    if (el instanceof HTMLInputElement && (el.type === 'hidden' || el.type === 'submit' || el.type === 'button')) {
      continue;
    }
    const value =
      el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')
        ? String(el.checked)
        : el.value;
    parts.push(`${el.name || el.id}=${value}`);
  }
  return parts.join('\u0000');
}

/** ⌘↵ on a Mac, Ctrl↵ elsewhere: «save this dialog», from any field. */
export function isSubmitShortcut(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.isComposing;
}

/**
 * The first field to type into: a text-like input, a select or a textarea
 * that can take focus. Never a radio (a type pill), a checkbox or a button.
 */
export function firstField(root: HTMLElement): HTMLElement | null {
  for (const el of controlsOf(root)) {
    if (el.disabled) continue;
    if (el instanceof HTMLInputElement) {
      if (['hidden', 'radio', 'checkbox', 'submit', 'button', 'reset', 'file'].includes(el.type)) continue;
      if (el.readOnly) continue;
    }
    if (el.closest('[hidden], [inert]')) continue;
    return el as unknown as HTMLElement;
  }
  return null;
}

/**
 * What ⌘↵ presses: the foot's primary button when it is live, otherwise the
 * body's form (its own submit handler decides). Null when the dialog has
 * nothing to save (a read-only one).
 */
export function submitTarget(
  panel: HTMLElement,
): { kind: 'button'; el: HTMLButtonElement } | { kind: 'form'; el: HTMLFormElement } | null {
  const primaries = panel.querySelectorAll<HTMLButtonElement>('.dialog__actions .btn--primary');
  const primary = primaries[primaries.length - 1];
  if (primary) return primary.disabled ? null : { kind: 'button', el: primary };
  const form = panel.querySelector('form');
  return form ? { kind: 'form', el: form } : null;
}
