/**
 * The dialog's save model (ADR-139 p7): nothing written is lost to Esc or a
 * click outside; with nothing written it closes as before; ⌘↵ saves from any
 * field; the caret starts in the first field, not on a type pill.
 */
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

afterEach(() => cleanup());
import DialogHarness from './test/DialogHarness.svelte';

beforeAll(() => {
  // jsdom draws <dialog> but does not run it: the two calls the frame uses.
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & Record<string, unknown>;
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

async function settle() {
  await tick();
  await tick();
  await new Promise((r) => setTimeout(r, 0));
}

function esc(target: Element) {
  return fireEvent.keyDown(target, { key: 'Escape' });
}

describe('Dialog · the save model', () => {
  it('puts the caret in the first field, not on the type pill', async () => {
    render(DialogHarness);
    await settle();
    expect(document.activeElement?.id).toBe('h-title');
  });

  it('closes on Esc when nothing is written', async () => {
    const { getByTestId, container } = render(DialogHarness);
    await settle();
    const dialog = container.querySelector('dialog')!;
    const ev = await esc(dialog);
    expect(ev).toBe(true); // not prevented: the native close goes ahead
  });

  it('asks before throwing away what was typed, and keeps it on «keep editing»', async () => {
    const { container, getByText, getByTestId } = render(DialogHarness);
    await settle();
    const input = document.querySelector<HTMLInputElement>('#h-title')!;
    await fireEvent.input(input, { target: { value: 'Ensayo con luces' } });
    const dialog = container.querySelector('dialog')!;
    const ev = await esc(dialog);
    expect(ev).toBe(false); // prevented: the dialog stays
    await settle();
    expect(getByText('There are unsaved changes.')).toBeTruthy();
    expect(getByTestId('state').textContent).toBe('open');
    await fireEvent.click(getByText('Keep editing'));
    await settle();
    expect(input.value).toBe('Ensayo con luces');
    expect(container.querySelector('.dialog__ask')).toBeNull();
  });

  it('asks on a click outside too, and «discard» closes', async () => {
    const { container, getByText, getByTestId } = render(DialogHarness);
    await settle();
    await fireEvent.input(document.querySelector('#h-title')!, { target: { value: 'x' } });
    const dialog = container.querySelector('dialog')!;
    await fireEvent.click(dialog); // the backdrop is the dialog itself
    await settle();
    expect(getByTestId('state').textContent).toBe('open');
    await fireEvent.click(getByText('Discard'));
    await settle();
    expect(getByTestId('state').textContent).toBe('closed');
  });

  it('does not ask when the text went back to what it was', async () => {
    const { container } = render(DialogHarness);
    await settle();
    const input = document.querySelector<HTMLInputElement>('#h-title')!;
    await fireEvent.input(input, { target: { value: 'x' } });
    await fireEvent.input(input, { target: { value: '' } });
    expect(await esc(container.querySelector('dialog')!)).toBe(true);
  });

  it('asks for unsaved work that is not a field (`dirty`)', async () => {
    const { container } = render(DialogHarness, { dirty: true });
    await settle();
    expect(await esc(container.querySelector('dialog')!)).toBe(false);
  });

  it('⌘↵ and Ctrl↵ press the primary from any field', async () => {
    const onsave = vi.fn();
    const { container } = render(DialogHarness, { onsave });
    await settle();
    const input = document.querySelector('#h-title')!;
    await fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    await fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onsave).toHaveBeenCalledTimes(2);
  });
});
