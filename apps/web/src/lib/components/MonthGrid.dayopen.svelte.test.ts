/**
 * EL DÍA SE ABRE EN EL SITIO (ADR-249). En el móvil, el día elegido bajo su
 * semana lo dibuja la página (`dayBody`), el mismo bloque que la Agenda, y no
 * hay puerta a una pantalla de Día («Día →»). Un día pedido desde fuera
 * (`pick`, una fecha tocada en Hoy) se abre él; cada elección se avisa.
 */
import { QueryClient } from '@tanstack/svelte-query';
import { fireEvent, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MonthGrid from './MonthGrid.svelte';
import { monthSpanWeeks } from '$lib/planner';

const body = createRawSnippet((iso: () => string) => ({
  render: () => `<p data-testid="open-body">${iso()}</p>`,
}));

function mount(over: Record<string, unknown> = {}) {
  const onPick = vi.fn();
  const onDayOpen = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  const r = render(MonthGrid, {
    props: {
      rows: monthSpanWeeks({ year: 2026, month: 11 }, { year: 2026, month: 12 }),
      shownMonth: { year: 2026, month: 11 },
      performances: [],
      dates: [],
      workspaceSlug: 'muk-cia',
      locale: 'es-ES',
      onDayOpen,
      onPick,
      dayBody: body,
      openDayWord: 'Día',
      ...over,
    },
    context: new Map([['$$_queryClient', client]]),
  });
  return { ...r, onPick, onDayOpen };
}

describe('MonthGrid — el día abierto en el móvil (ADR-249)', () => {
  const realMatch = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((q: string) => ({
      matches: true,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = realMatch;
  });

  it('opens the day asked for, drawn by the page, with no door to a Day screen', async () => {
    const { findByTestId, queryByText, onPick } = mount({ pick: '2026-11-20' });
    expect((await findByTestId('open-body')).textContent).toBe('2026-11-20');
    expect(queryByText(/Día →/)).toBeNull();
    expect(onPick).toHaveBeenCalledWith('2026-11-20');
  });

  it('a tap on another day opens it there; a tap on the same day folds it', async () => {
    const { container, findAllByTestId, onPick, onDayOpen } = mount({ pick: '2026-11-20' });
    const num = (iso: string) => container.querySelector<HTMLElement>(`.cal__num[data-day="${iso}"] button`)!;
    await fireEvent.click(num('2026-11-12'));
    // (jsdom never ends the outro, so the old week's day may linger.)
    expect((await findAllByTestId('open-body')).map((e) => e.textContent)).toContain('2026-11-12');
    expect(onPick).toHaveBeenLastCalledWith('2026-11-12');
    await fireEvent.click(num('2026-11-12'));
    expect(onPick).toHaveBeenLastCalledWith(null);
    expect(onDayOpen).not.toHaveBeenCalled();
  });
});

describe('MonthGrid — the page folds the open day (ADR-249)', () => {
  const realMatch = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((q: string) => ({
      matches: true,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = realMatch;
  });

  it('a pick of null from the page folds the day', async () => {
    const { rerender, container } = mount({ pick: '2026-11-20' });
    const sel = () => [...container.querySelectorAll('.cal__day--sel')].map((e) => e.getAttribute('data-day'));
    await vi.waitFor(() => expect(sel()).toContain('2026-11-20'));
    await rerender({ pick: null });
    await vi.waitFor(() => expect(sel()).toEqual([]));
  });
});

describe('MonthGrid — el día abierto también en el escritorio (ADR-251)', () => {
  const realMatch = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = realMatch;
  });

  it('a date opens under its week on a wide screen too, never a Day screen', async () => {
    const { container, findAllByTestId, onPick, onDayOpen } = mount({ pick: '2026-11-20' });
    expect((await findAllByTestId('open-body')).map((e) => e.textContent)).toContain('2026-11-20');
    const btn = container.querySelector<HTMLElement>('[data-day="2026-11-12"] button.cal__day-num')
      ?? container.querySelector<HTMLElement>('.cal__num[data-day="2026-11-12"] button')!;
    await fireEvent.click(btn);
    expect((await findAllByTestId('open-body')).map((e) => e.textContent)).toContain('2026-11-12');
    expect(onPick).toHaveBeenLastCalledWith('2026-11-12');
    expect(onDayOpen).not.toHaveBeenCalled();
  });
});
