/**
 * Lo que dura es una barra (tarea 165, el dibujo «Mes por compañía» del
 * 16-11): una tanda, una gira, el cierre de la compañía y —solo con «Quién
 * falta»— la ausencia de una persona dibujan la misma barra de una línea,
 * bajo los números. Las ausencias no salen por defecto; con el botón, dos
 * por semana y «+N más»; en rojo si esa persona tenía función confirmada, y
 * entonces el monograma de esa función lleva el borde rojo. Un punto por día.
 */
import { QueryClient } from '@tanstack/svelte-query';
import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import MonthGrid from './MonthGrid.svelte';
import { monthSpanWeeks } from '$lib/planner';
import type { AwayBandVM, BlackoutBandVM, ClashVM, DateEvent, PerformanceEvent } from '$lib/month-events';

const project = { id: 'p1', name: 'Gota', slug: 'gota', initials: 'GO', accent: null, workspace_id: 'w1' };

function absence(id: string, from: string, to: string, who: string, over: Partial<BlackoutBandVM> = {}): BlackoutBandVM {
  return { id, from, to, company: false, tentative: false, label: `${who} · no disponible`, subject: who, ...over };
}

const closure: BlackoutBandVM = {
  id: 'shut',
  from: '2026-11-23',
  to: '2026-11-29',
  company: true,
  tentative: false,
  label: 'Muk Cia',
  subject: 'Muk Cia',
};

const tour: AwayBandVM = {
  from: '2026-11-09',
  to: '2026-11-12',
  label: 'Gota de gira',
  project_id: 'p1',
  accent: 'var(--accent-3)',
  initials: 'GO',
  projectName: 'Gota',
  place: 'A Coruña',
  deduced: { word: 'deducida', legs: 'ida 8 nov · vuelta 13 nov' },
};

function rehearsal(id: string, day: string): DateEvent {
  return {
    id,
    kind: 'rehearsal',
    status: 'confirmed',
    title: 'Residencia de creación',
    starts_at: `${day}T09:00:00Z`,
    ends_at: `${day}T13:00:00Z`,
    all_day: false,
    venue_name: null,
    city: 'Valdemora',
    project,
    venue: null,
    series_id: 'run1',
  } as unknown as DateEvent;
}

const gig = {
  id: 'g1',
  slug: 'g1',
  performed_at: '2026-11-17',
  status: 'confirmed',
  start_at: '2026-11-17T20:00:00Z',
  venue_name: null,
  city: 'Girona',
  country: 'es',
  line_id: null,
  project,
  workspace_id: 'w1',
  venue: { name: 'Teatre Municipal', city: 'Girona', timezone: 'Europe/Madrid' },
} as unknown as PerformanceEvent;

const absences = [
  absence('a1', '2026-11-16', '2026-11-18', 'Clara', { hit: true }),
  absence('a2', '2026-11-17', '2026-11-17', 'Iván', { tentative: true }),
  absence('a3', '2026-11-18', '2026-11-19', 'Noa'),
  absence('a4', '2026-11-20', '2026-11-20', 'Txell'),
];

function mount(over: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  return render(MonthGrid, {
    props: {
      rows: monthSpanWeeks({ year: 2026, month: 11 }, { year: 2026, month: 11 }),
      shownMonth: { year: 2026, month: 11 },
      performances: [gig],
      dates: [rehearsal('r1', '2026-11-02'), rehearsal('r2', '2026-11-03'), rehearsal('r3', '2026-11-04')],
      workspaceSlug: 'muk-cia',
      locale: 'es-ES',
      blackouts: [...absences, closure],
      aways: [tour],
      absenceHitIds: new Set(['g1']),
      closedWord: 'compañía cerrada',
      closedShortWord: 'cerrado',
      tourWord: 'gira',
      moreAbsentLabel: (n: number) => `+${n} más`,
      ...over,
    },
    context: new Map([['$$_queryClient', client]]),
  });
}

const texts = (root: HTMLElement, sel: string) =>
  [...root.querySelectorAll<HTMLElement>(sel)].map((e) => e.textContent?.replace(/\s+/g, ' ').trim());

describe('MonthGrid — lo que dura es una barra', () => {
  it('a run of days is ONE bar with its name and place, and no hours per day', () => {
    const { container } = mount();
    const runs = container.querySelectorAll<HTMLElement>('.cal__run');
    expect(runs).toHaveLength(1);
    expect(runs[0].textContent).toMatch(/Residencia de creación/);
    expect(runs[0].textContent).toMatch(/Valdemora/);
    expect(runs[0].textContent).not.toMatch(/\d{1,2}h|09:00|hasta|días/);
    expect(runs[0].style.gridColumn.replace(/\s/g, '')).toBe('1/4');
  });

  it('each day of the run is its own door, and the picked day lists its row', async () => {
    const opened: string[] = [];
    const { container } = mount({ onDateOpen: (d: DateEvent) => opened.push(d.id) });
    const doors = container.querySelectorAll<HTMLButtonElement>('.cal__run .cal__bar-door');
    expect(doors).toHaveLength(3);
    await fireEvent.click(doors[2]);
    expect(opened).toEqual(['r3']);
  });

  it('a tour is a bar with «gira» and its place; the deduction stays in the title', () => {
    const { container } = mount();
    const [bar] = container.querySelectorAll<HTMLElement>('[data-testid="month-bar-tour"]');
    expect(bar.textContent?.replace(/\s+/g, ' ')).toMatch(/gira A Coruña/);
    expect(bar.textContent).not.toMatch(/deducida|ida|vuelta/);
    expect(bar.title).toMatch(/deducida/);
  });

  it('the company closure draws always, hatched and named', () => {
    const { container } = mount();
    expect(texts(container, '[data-testid="month-bar-closed"]')[0]).toMatch(/compañía cerrada/);
  });

  it('absences are off the sheet until «Quién falta» is on', () => {
    const { container } = mount();
    expect(container.querySelector('[data-testid="month-bar-absence"]')).toBeNull();
    expect(container.querySelector('[data-testid="month-bar-more"]')).toBeNull();
    expect(container.querySelector('.slip[data-absent]')).toBeNull();
  });

  it('on: two absences a week, then «+N más», a «?» when not sure, red when they had a show', () => {
    const { container } = mount({ showAbsences: true });
    const bars = [...container.querySelectorAll<HTMLElement>('[data-testid="month-bar-absence"]')];
    expect(bars.map((b) => b.textContent?.trim())).toEqual(['Clara', 'Iván?']);
    expect(bars[0].classList.contains('cal__bar--hit')).toBe(true);
    expect(bars[1].classList.contains('cal__bar--tent')).toBe(true);
    expect(bars[1].classList.contains('cal__bar--hit')).toBe(false);
    const more = container.querySelector<HTMLElement>('[data-testid="month-bar-more"]')!;
    expect(more.textContent).toBe('+2 más');
    expect(more.title).toMatch(/Noa/);
    expect(more.title).toMatch(/Txell/);
    // The gig the absent person was booked on: its monogram takes the red edge.
    expect(container.querySelector('.slip[data-absent]')).not.toBeNull();
  });

  it('the bars sit between the number and the day: the day starts under them', () => {
    const { container } = mount({ showAbsences: true });
    const day = container.querySelector<HTMLElement>('.cal__day[data-day="2026-11-17"]')!;
    // Two absence rows over the 17th: the day's contents start on row 4.
    expect(day.style.gridRow.replace(/\s/g, '')).toMatch(/^4\//);
  });

  it('one mark a day, at most, and it opens every clash of the day', async () => {
    const clash = (title: string, severity: ClashVM['severity']): ClashVM => ({
      severity,
      event_ids: ['g1'],
      title,
      body: `${title} body`,
      rows: [],
    });
    const { container } = mount({
      clashesByDay: new Map([['2026-11-17', [clash('Dos a la vez', 'possible'), clash('Fuera ese día', 'blackout')]]]),
    });
    const marks = container.querySelectorAll<HTMLButtonElement>('.cal__num[data-day="2026-11-17"] .cal__mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].dataset.severity).toBe('blackout');
    await fireEvent.click(marks[0]);
    const card = container.querySelector<HTMLElement>('.cal__clashcard')!;
    expect(card.textContent).toMatch(/Dos a la vez/);
    expect(card.textContent).toMatch(/Fuera ese día/);
  });

  it('the steps of a day are not on the Month any more', () => {
    const { container } = mount();
    expect(container.querySelector('[data-testid="month-steps"]')).toBeNull();
  });
});
