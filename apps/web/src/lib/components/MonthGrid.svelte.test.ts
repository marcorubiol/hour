/**
 * Crear desde la celda del Mes (ADR-139, después). Cada gesto llega a la
 * MISMA puerta, `onDayCreate(iso)`, con el día de la celda: el «+» (que se
 * llama «Añadir el 14 de noviembre»), el doble clic en el hueco libre, la
 * pulsación larga con el dedo, y el foco del teclado lleva el día que `N`
 * abrirá. Un clic suelto en el hueco sigue sin abrir nada, y un día que no es
 * de esta hoja no es una puerta.
 */
import { QueryClient } from '@tanstack/svelte-query';
import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MonthGrid from './MonthGrid.svelte';
import { focusedDay, LONG_PRESS_MS } from '$lib/cell-create';
import { dayMonthLong } from '$lib/datetime';
import { t } from '$lib/i18n';

const DAY = '2026-11-14';

function mount(over: Record<string, unknown> = {}) {
  const onDayCreate = vi.fn();
  const onDayOpen = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  const r = render(MonthGrid, {
    props: {
      year: 2026,
      month: 11,
      performances: [],
      dates: [],
      workspaceSlug: 'muk-cia',
      locale: 'es-ES',
      onDayCreate,
      onDayOpen,
      createLabel: (iso: string) => t('planner.new_on', 'es', { day: dayMonthLong(iso, 'es-ES') }),
      openDayLabel: (iso: string) => `Abrir ${iso}`,
      ...over,
    },
    context: new Map([['$$_queryClient', client]]),
  });
  const cellOf = (iso: string) => r.container.querySelector<HTMLElement>(`.cal__day[data-day="${iso}"]`)!;
  const headOf = (iso: string) => r.container.querySelector<HTMLElement>(`.cal__num[data-day="${iso}"]`)!;
  return { ...r, onDayCreate, onDayOpen, cellOf, headOf };
}

describe('MonthGrid — crear en el día de la celda', () => {
  it('the «+» says its day in words and opens the quick add on it', async () => {
    const { getByRole, onDayCreate } = mount();
    const plus = getByRole('button', { name: 'Añadir el 14 de noviembre' });
    await fireEvent.click(plus);
    expect(onDayCreate).toHaveBeenCalledExactlyOnceWith(DAY);
  });

  it('a double click on the free space creates on that day; a single one does nothing', async () => {
    const { cellOf, headOf, onDayCreate } = mount();
    await fireEvent.click(cellOf(DAY));
    expect(onDayCreate).not.toHaveBeenCalled();
    await fireEvent.dblClick(cellOf(DAY));
    expect(onDayCreate).toHaveBeenLastCalledWith(DAY);
    // The number row is the same day: its blank is the cell's blank too.
    await fireEvent.dblClick(headOf('2026-11-20'));
    expect(onDayCreate).toHaveBeenLastCalledWith('2026-11-20');
  });

  it('a double click on the day number is the number’s (it opens the Day)', async () => {
    const { headOf, onDayCreate, onDayOpen } = mount();
    const num = headOf(DAY).querySelector('button.cal__day-num')!;
    await fireEvent.dblClick(num);
    expect(onDayCreate).not.toHaveBeenCalled();
    await fireEvent.click(num);
    expect(onDayOpen).toHaveBeenCalledWith(DAY);
  });

  it('a day of the neighbouring month is not a door', async () => {
    const { container, onDayCreate } = mount();
    // November 2026 starts on a Sunday: the sheet opens with 26–31 October.
    const out = container.querySelector<HTMLElement>('.cal__day.cal__day--out')!;
    expect(out.dataset.day).toBeUndefined();
    await fireEvent.dblClick(out);
    expect(onDayCreate).not.toHaveBeenCalled();
  });

  it('the keyboard: a focused day carries the day `N` opens', () => {
    const { headOf } = mount();
    const plus = headOf(DAY).querySelector<HTMLButtonElement>('.cal__new')!;
    plus.focus();
    expect(focusedDay(document.activeElement)).toBe(DAY);
    headOf(DAY).querySelector<HTMLButtonElement>('button.cal__day-num')!.focus();
    expect(focusedDay(document.activeElement)).toBe(DAY);
  });

  describe('a finger', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('a long press on the free space creates on that day', () => {
      const { cellOf, onDayCreate } = mount();
      const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
      Object.defineProperty(down, 'pointerType', { value: 'touch' });
      Object.defineProperty(down, 'isPrimary', { value: true });
      cellOf(DAY).dispatchEvent(down);
      vi.advanceTimersByTime(LONG_PRESS_MS);
      expect(onDayCreate).toHaveBeenCalledExactlyOnceWith(DAY);
    });
  });

  it('«+N más» on a full cell opens the Day, not the quick add', async () => {
    const dates = [1, 2, 3, 4, 5].map((i) => ({
      id: `d${i}`,
      kind: 'rehearsal',
      status: 'confirmed',
      title: `Ensayo ${i}`,
      starts_at: `${DAY}T0${i}:00:00Z`,
      ends_at: `${DAY}T0${i}:30:00Z`,
      all_day: false,
      venue_name: null,
      city: null,
      project: null,
      venue: null,
    }));
    const { container, onDayCreate, onDayOpen } = mount({ dates });
    const more = container.querySelector<HTMLButtonElement>('.cal__day[data-day="' + DAY + '"] [data-testid="month-more"]')!;
    expect(more.textContent).toMatch(/^\+\d+ /);
    await fireEvent.click(more);
    expect(onDayOpen).toHaveBeenCalledExactlyOnceWith(DAY);
    expect(onDayCreate).not.toHaveBeenCalled();
  });

  it('without a door there is no gesture: no «+», and a double click does nothing', async () => {
    const { container, cellOf } = mount({ onDayCreate: undefined });
    expect(container.querySelector('.cal__new')).toBeNull();
    await fireEvent.dblClick(cellOf(DAY));
  });
});
