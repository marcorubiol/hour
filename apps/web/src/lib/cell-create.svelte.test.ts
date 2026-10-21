/**
 * Crear en el día que se señala (`$lib/cell-create`): qué día lleva el foco,
 * qué es hueco libre y cuándo una pulsación larga crea. El Mes lo usa en
 * `MonthGrid.svelte.test.ts`; aquí van las reglas sin dibujo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusedDay, isFreeSpace, longPress, LONG_PRESS_MS, LONG_PRESS_SLOP } from './cell-create';

function cell(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el.firstElementChild as HTMLElement;
}

function pointer(type: string, over: Partial<PointerEvent> = {}): Event {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: over.clientX ?? 0, clientY: over.clientY ?? 0 });
  Object.defineProperty(e, 'pointerType', { value: over.pointerType ?? 'touch' });
  Object.defineProperty(e, 'isPrimary', { value: over.isPrimary ?? true });
  return e;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('focusedDay — the day `N` creates on', () => {
  it('is the nearest [data-day] of the focused control', () => {
    const c = cell('<div data-day="2026-11-14"><span><button>14</button></span></div>');
    const b = c.querySelector('button')!;
    b.focus();
    expect(focusedDay(document.activeElement)).toBe('2026-11-14');
  });

  it('is null outside a day, and for anything that is not an ISO day', () => {
    const c = cell('<div><button>+ date</button><div data-day="nope"><a href="#">x</a></div></div>');
    expect(focusedDay(c.querySelector('button'))).toBeNull();
    expect(focusedDay(c.querySelector('a'))).toBeNull();
    expect(focusedDay(null)).toBeNull();
    expect(focusedDay(document.body)).toBeNull();
  });
});

describe('isFreeSpace — a card opens, the space beside it creates', () => {
  const html =
    '<div class="cell"><span class="head"><span></span></span><div class="slip"><b>Sala</b></div><button>+</button><a href="#">x</a></div>';

  it('the cell itself and its empty wrappers are free', () => {
    const c = cell(html);
    expect(isFreeSpace(c, c)).toBe(true);
    expect(isFreeSpace(c.querySelector('.head span'), c)).toBe(true);
  });

  it('a card, a button, a link — and anything inside them — are not', () => {
    const c = cell(html);
    expect(isFreeSpace(c.querySelector('.slip b'), c)).toBe(false);
    expect(isFreeSpace(c.querySelector('button'), c)).toBe(false);
    expect(isFreeSpace(c.querySelector('a'), c)).toBe(false);
  });

  it('a target outside the cell is never its free space', () => {
    const c = cell(html);
    expect(isFreeSpace(document.body, c)).toBe(false);
    expect(isFreeSpace(null, c)).toBe(false);
  });
});

describe('longPress — a finger that stays means «here»', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function armed() {
    const c = cell('<div class="cell"><div class="slip">Sala</div></div>');
    const onPress = vi.fn();
    const off = longPress(onPress)(c) as () => void;
    return { c, onPress, off };
  }

  it('fires after LONG_PRESS_MS on the free space, and swallows the menu', () => {
    const { c, onPress } = armed();
    c.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(onPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onPress).toHaveBeenCalledOnce();
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    c.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });

  it('the click its lift makes is eaten, and only that one', () => {
    const { c, onPress } = armed();
    const outside = vi.fn();
    document.body.addEventListener('click', outside);
    c.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onPress).toHaveBeenCalledOnce();
    // The lift lands on what the press opened (a dialog's backdrop).
    document.body.dispatchEvent(pointer('pointerup'));
    const lift = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(lift);
    expect(lift.defaultPrevented).toBe(true);
    expect(outside).not.toHaveBeenCalled();
    // The next tap is the reader's own.
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(outside).toHaveBeenCalledOnce();
    document.body.removeEventListener('click', outside);
  });

  it('a press the browser cancels after it fired leaves the next click alone', () => {
    const { c } = armed();
    const outside = vi.fn();
    document.body.addEventListener('click', outside);
    c.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    document.body.dispatchEvent(pointer('pointercancel'));
    document.body.dispatchEvent(pointer('pointerup'));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(outside).toHaveBeenCalledOnce();
    document.body.removeEventListener('click', outside);
  });

  it('a lift, a scroll past the slop or a mouse never create', () => {
    const { c, onPress } = armed();
    c.dispatchEvent(pointer('pointerdown'));
    c.dispatchEvent(pointer('pointerup'));
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);

    c.dispatchEvent(pointer('pointerdown'));
    c.dispatchEvent(pointer('pointermove', { clientY: LONG_PRESS_SLOP + 1 }));
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);

    c.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse' }));
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('a press on a card is the card’s, not the cell’s', () => {
    const { c, onPress } = armed();
    c.querySelector('.slip')!.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('a small tremble is still a press', () => {
    const { c, onPress } = armed();
    c.dispatchEvent(pointer('pointerdown'));
    c.dispatchEvent(pointer('pointermove', { clientX: 3, clientY: 4 }));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('the cleanup disarms a pending press', () => {
    const { c, onPress, off } = armed();
    c.dispatchEvent(pointer('pointerdown'));
    off();
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(onPress).not.toHaveBeenCalled();
  });
});
