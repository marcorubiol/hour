import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backThroughHistory, hasAppEntryBefore, noteNavigation, resetNavigationDepth } from './back';

const click = (over: Partial<MouseEvent> = {}) =>
  ({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn(), ...over }) as unknown as MouseEvent;

beforeEach(() => {
  resetNavigationDepth();
  vi.stubGlobal('history', { back: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe('hasAppEntryBefore', () => {
  it('is false on a page that was opened directly (no navigation yet)', () => {
    expect(hasAppEntryBefore()).toBe(false);
  });
  it('is true after a link navigation, false after goto, enter or leave', () => {
    noteNavigation({ type: 'goto' });
    noteNavigation({ type: 'enter' });
    noteNavigation({ type: 'leave' });
    expect(hasAppEntryBefore()).toBe(false);
    noteNavigation({ type: 'link' });
    expect(hasAppEntryBefore()).toBe(true);
  });
  it('follows Back and Forward by their delta, never below 0', () => {
    noteNavigation({ type: 'link' });
    noteNavigation({ type: 'link' });
    noteNavigation({ type: 'popstate', delta: -1 });
    expect(hasAppEntryBefore()).toBe(true);
    noteNavigation({ type: 'popstate', delta: -1 });
    expect(hasAppEntryBefore()).toBe(false);
    noteNavigation({ type: 'popstate', delta: -3 });
    expect(hasAppEntryBefore()).toBe(false);
    noteNavigation({ type: 'popstate', delta: 1 });
    expect(hasAppEntryBefore()).toBe(true);
  });
});

describe('backThroughHistory', () => {
  it('steps back when the app has an entry under this one', () => {
    noteNavigation({ type: 'link' });
    const e = click();
    backThroughHistory(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(history.back).toHaveBeenCalled();
  });
  it('lets the link go to Hoy on a page opened directly', () => {
    const e = click();
    backThroughHistory(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(history.back).not.toHaveBeenCalled();
  });
  it('leaves a modified click to the browser', () => {
    noteNavigation({ type: 'link' });
    backThroughHistory(click({ metaKey: true }));
    expect(history.back).not.toHaveBeenCalled();
  });
});
