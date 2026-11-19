import { afterEach, describe, expect, it, vi } from 'vitest';
import { backThroughHistory, hasAppEntryBefore } from './back';

function setHistory(state: unknown) {
  vi.stubGlobal('history', { state, back: vi.fn() });
}
const click = (over: Partial<MouseEvent> = {}) =>
  ({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn(), ...over }) as unknown as MouseEvent;

afterEach(() => vi.unstubAllGlobals());

describe('hasAppEntryBefore', () => {
  it('is false on the first entry, with no state, and with a state without the index', () => {
    setHistory({ 'sveltekit:history': 0 });
    expect(hasAppEntryBefore()).toBe(false);
    setHistory(null);
    expect(hasAppEntryBefore()).toBe(false);
    setHistory({});
    expect(hasAppEntryBefore()).toBe(false);
  });
  it('is true from the second entry on', () => {
    setHistory({ 'sveltekit:history': 2 });
    expect(hasAppEntryBefore()).toBe(true);
  });
});

describe('backThroughHistory', () => {
  it('steps back when there is an app entry under this one', () => {
    setHistory({ 'sveltekit:history': 1 });
    const e = click();
    backThroughHistory(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(history.back).toHaveBeenCalled();
  });
  it('lets the link go to Hoy when there is none', () => {
    setHistory({ 'sveltekit:history': 0 });
    const e = click();
    backThroughHistory(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(history.back).not.toHaveBeenCalled();
  });
  it('leaves a modified click to the browser', () => {
    setHistory({ 'sveltekit:history': 3 });
    const e = click({ metaKey: true });
    backThroughHistory(e);
    expect(history.back).not.toHaveBeenCalled();
  });
});
