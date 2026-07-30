import { render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import DateChip from './DateChip.svelte';
import type { DateEvent, ProjectLite } from '$lib/month-events';

const project: ProjectLite = {
  id: 'p1',
  slug: 'mamemi',
  name: 'MaMeMi',
  accent: null,
  initials: 'MM',
  workspace_id: 'w1',
};

function date(over: Partial<DateEvent> = {}): DateEvent {
  return {
    id: 'd1',
    kind: 'rehearsal',
    status: 'confirmed',
    title: 'Assaig general',
    starts_at: '2026-07-15T08:00:00.000Z',
    ends_at: null,
    all_day: false,
    series_id: null,
    venue_name: null,
    city: 'Igualada',
    country: 'ES',
    project,
    venue: null,
    ...over,
  };
}

const base = {
  edges: null,
  di: 0,
  viewerTz: 'Europe/Madrid',
  dateKindLabel: (k: string) => k,
  onMarkOpen: () => {},
};

describe('DateChip shells', () => {
  it('stays an inert span when no open handler is given', () => {
    const { container } = render(DateChip, { props: { g: [date()], ...base } });

    expect(container.querySelector('button.cal__event-hit')).toBeNull();
    expect(container.querySelector('span.cal__event')).not.toBeNull();
  });

  it('grows a hit button — a SIBLING, never a wrapper — when it can open', () => {
    const { container } = render(DateChip, {
      props: { g: [date()], ...base, onOpen: () => {} },
    });

    const chip = container.querySelector('.cal__event');
    const hit = container.querySelector('button.cal__event-hit');
    expect(chip?.tagName).toBe('SPAN');
    expect(hit).not.toBeNull();
    // The whole point of the overlay: the monogram button must not end up
    // INSIDE another button — the HTML parser would close the outer one and
    // tear the card in two on any server-rendered pass.
    expect(hit?.querySelector('button')).toBeNull();
    expect(chip?.querySelector('.cal__markbtn')).not.toBeNull();
  });

  it('opens on the LEAD row of a grouped day', () => {
    const onOpen = vi.fn();
    const lead = date({ id: 'lead' });
    const second = date({ id: 'second', starts_at: '2026-07-15T16:00:00.000Z' });
    const { container } = render(DateChip, {
      props: { g: [lead, second], ...base, onOpen },
    });

    (container.querySelector('button.cal__event-hit') as HTMLButtonElement).click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].id).toBe('lead');
  });

  it('the monogram still opens the identity panel, not the date', () => {
    const onOpen = vi.fn();
    const onMarkOpen = vi.fn();
    const { container } = render(DateChip, {
      props: { g: [date()], ...base, onMarkOpen, onOpen },
    });

    (container.querySelector('.cal__markbtn') as HTMLButtonElement).click();
    expect(onMarkOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  /**
   * The run classes drive the multi-day strip's borders and radii. A chip
   * that dropped one on becoming clickable would break the band across the
   * week — silently, and only for a block.
   */
  it('keeps the run grammar in both shells', () => {
    const g = [date({ series_id: 's1' })];
    const edges = { first: true, last: false };

    for (const props of [
      { g, ...base, edges },
      { g, ...base, edges, onOpen: () => {} },
    ]) {
      const { container } = render(DateChip, { props });
      const chip = container.querySelector('.cal__event') as HTMLElement;
      expect(chip.className).toContain('cal__event--run');
      expect(chip.className).toContain('cal__event--run-first');
      expect(chip.className).not.toContain('cal__event--run-last');
      expect(chip.className).toContain('cal__event--date');
    }
  });

  it('a travel day keeps its own container in both shells', () => {
    const g = [date({ kind: 'travel_day', travel_direction: 'outbound' })];

    for (const props of [
      { g, ...base },
      { g, ...base, onOpen: () => {} },
    ]) {
      const { container } = render(DateChip, { props });
      const chip = container.querySelector('.cal__event') as HTMLElement;
      expect(chip.className).toContain('cal__event--travel');
      expect(chip.className).not.toContain('cal__event--date');
      expect(container.querySelector('.cal__travel-text')?.textContent).toBe('→ Igualada');
    }
  });
});
