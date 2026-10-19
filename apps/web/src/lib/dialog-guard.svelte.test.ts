/**
 * The pieces of the save model (ADR-139 p7), each on its own: what counts
 * as written, which key saves, where the caret starts, a form's own words
 * under its fields, «guardado» for a moment, and the field that says a
 * native constraint in Hour's voice instead of the browser's bubble.
 */
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstField, isSubmitShortcut, snapshotControls, submitTarget } from './dialog-guard';
import { FormErrors } from './form-errors.svelte';
import { SAVE_FLASH_MS, SaveFlash } from './save-flash.svelte';
import Input from './components/Input.svelte';

function html(markup: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = markup;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('snapshotControls', () => {
  it('changes when a value, a tick or a choice changes, and only then', () => {
    const root = html(`
      <input id="a" value="x" />
      <input id="c" type="checkbox" />
      <input name="r" type="radio" value="1" checked /><input name="r" type="radio" value="2" />
      <select id="s"><option>a</option><option>b</option></select>
      <textarea id="t"></textarea>
      <input type="hidden" value="ignored" />`);
    const before = snapshotControls(root);
    expect(snapshotControls(root)).toBe(before);
    root.querySelector<HTMLInputElement>('#a')!.value = 'y';
    expect(snapshotControls(root)).not.toBe(before);
    root.querySelector<HTMLInputElement>('#a')!.value = 'x';
    expect(snapshotControls(root)).toBe(before);
    root.querySelectorAll<HTMLInputElement>('[name=r]')[1].checked = true;
    expect(snapshotControls(root)).not.toBe(before);
  });
});

describe('isSubmitShortcut', () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
  it('is ⌘↵ or Ctrl↵, never a plain Enter or ⌥↵', () => {
    expect(isSubmitShortcut(key({ key: 'Enter', metaKey: true }))).toBe(true);
    expect(isSubmitShortcut(key({ key: 'Enter', ctrlKey: true }))).toBe(true);
    expect(isSubmitShortcut(key({ key: 'Enter' }))).toBe(false);
    expect(isSubmitShortcut(key({ key: 'Enter', metaKey: true, altKey: true }))).toBe(false);
    expect(isSubmitShortcut(key({ key: 'a', metaKey: true }))).toBe(false);
  });
});

describe('firstField', () => {
  it('skips type pills, ticks, disabled and read-only fields', () => {
    const root = html(`
      <input type="radio" name="k" />
      <input type="checkbox" />
      <input id="off" disabled />
      <input id="ro" readonly />
      <select id="s"></select>
      <input id="later" />`);
    expect(firstField(root)?.id).toBe('s');
  });
  it('is null when there is nothing to type into (a confirm)', () => {
    expect(firstField(html('<p>Send it?</p><button>Send</button>'))).toBeNull();
  });
});

describe('submitTarget', () => {
  it('is the foot primary, or nothing while it is disabled', () => {
    const root = html(`<form></form><footer class="dialog__actions">
      <button class="btn--quiet">Cancel</button><button class="btn--primary">Save</button></footer>`);
    expect(submitTarget(root)).toMatchObject({ kind: 'button' });
    root.querySelector<HTMLButtonElement>('.btn--primary')!.disabled = true;
    expect(submitTarget(root)).toBeNull();
  });
  it('falls back to the body form when the foot has no primary', () => {
    expect(submitTarget(html('<form></form>'))).toMatchObject({ kind: 'form' });
  });
});

describe('FormErrors', () => {
  it('keeps a word per field, drops it when that field changes, focuses the first', async () => {
    const root = html('<input id="amount" /><input id="currency" />');
    const errors = new FormErrors();
    errors.set('amount', 'Must be positive');
    errors.set('currency', 'Three letters');
    expect(errors.any).toBe(true);
    await errors.focusFirst();
    expect(document.activeElement?.id).toBe('amount');
    errors.onedit({ target: root.querySelector('#amount') } as unknown as Event);
    expect(errors.of('amount')).toBeUndefined();
    expect(errors.of('currency')).toBe('Three letters');
  });
});

describe('SaveFlash', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('says «guardado» for one key, for a moment', () => {
    const saved = new SaveFlash();
    saved.show('name');
    expect(saved.is('name')).toBe(true);
    expect(saved.is('phone')).toBe(false);
    vi.advanceTimersByTime(SAVE_FLASH_MS);
    expect(saved.is('name')).toBe(false);
  });
});

describe('Field · a native constraint in Hour’s voice', () => {
  it('cancels the bubble, says it under the field and clears it on typing', async () => {
    const { container } = render(Input, { id: 'need', label: 'Name', required: true });
    const input = container.querySelector<HTMLInputElement>('#need')!;
    const invalid = new Event('invalid', { cancelable: true });
    input.dispatchEvent(invalid);
    expect(invalid.defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(container.querySelector('.field__msg')?.textContent?.trim()).toBe('This is needed.');
    expect(container.querySelector('.field--error')).not.toBeNull();
    await fireEvent.input(input, { target: { value: 'x' } });
    expect(container.querySelector('.field--error')).toBeNull();
  });
});
