import { render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import CarrilsStrip, {
  type ConnectorVM,
  type LaneVM,
  type LoomGroupVM,
} from './CarrilsStrip.svelte';

const JULY = Array.from({ length: 31 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);

const lanes: LaneVM[] = [
  {
    key: 'ws-muk',
    label: 'MüK Cia',
    accent: 'var(--accent-2)',
    pips: [
      {
        id: 'perf-1',
        day: 11,
        kind: 'perf',
        state: 'confirmed',
        label: "Teatre de l'Aurora",
        time: '20:00',
        accent: 'var(--accent-3)',
        title: "MaMeMi · Teatre de l'Aurora, Igualada · Confirmed",
        href: '/h/muk/performance/aurora',
      },
      {
        id: 'perf-2',
        day: 29,
        kind: 'perf',
        state: 'hold',
        label: 'Fira Tàrrega',
        time: '18:30',
        accent: 'var(--accent-3)',
        title: 'MaMeMi · Fira Tàrrega · 1st hold',
      },
      {
        id: 'trav-1',
        day: 23,
        kind: 'travel',
        label: '→ London',
        accent: 'var(--accent-3)',
        title: 'Última · Travel day · London',
      },
      {
        id: 'date-1',
        day: 9,
        kind: 'date',
        label: 'press',
        accent: 'var(--accent-3)',
        title: 'MaMeMi · Entrevista',
      },
    ],
    bands: [
      { id: 'prep-1', from: 6, to: 10, kind: 'prep', label: 'Assaigs', accent: 'var(--accent-3)' },
      { id: 'blk-1', from: 15, to: 20, kind: 'blackout', label: 'Mia — away' },
      { id: 'away-1', from: 24, to: 25, kind: 'away', label: 'away · Última' },
    ],
  },
  { key: 'ws-demo', label: 'Demo', accent: 'var(--accent-5)', pips: [], bands: [] },
];

const connectors: ConnectorVM[] = [
  {
    id: '2026-07-17:a+b',
    day: 17,
    aKey: 'ws-muk',
    bKey: 'ws-demo',
    severity: 'people',
    label: 'Conflict on day 17 — open the decision',
  },
];

const loom: LoomGroupVM[] = [
  {
    key: 'proj-mamemi',
    label: 'MaMeMi',
    accent: 'var(--accent-3)',
    threads: [
      {
        person_id: 'anouk',
        name: 'Anouk Villé',
        shared: true,
        ghost: false,
        segments: [
          { from: 11, to: 11, state: 'confirmed', accent: 'var(--accent-3)', title: 'MaMeMi · 11' },
          { from: 17, to: 17, state: 'hold', accent: 'var(--accent-4)', title: 'Última · 17' },
        ],
        outs: [{ from: 26, to: 29, tentative: true }],
        knots: [17],
      },
      {
        person_id: 'zoe',
        name: 'Zoe',
        shared: false,
        ghost: true,
        segments: [],
        outs: [],
        knots: [],
      },
    ],
  },
];

describe('CarrilsStrip — lanes', () => {
  const props = {
    monthDays: JULY,
    todayIso: '2026-07-18',
    group: 'espai' as const,
    lanes,
    loom: [],
    connectors,
    onConnectorJump: () => {},
    locale: 'en' as const,
  };

  it('renders a lane per key with its sticky label', () => {
    const { container } = render(CarrilsStrip, props);
    const labels = [...container.querySelectorAll('[data-lane-label]')].map((n) =>
      n.textContent?.trim(),
    );
    expect(labels).toContain('MüK Cia');
    expect(labels).toContain('Demo');
    // Axis header speaks the grouping.
    expect(labels[0]).toBe('Space');
  });

  it('renders the pip grammar: solid/hold dots, mono travel and date pips', () => {
    const { container } = render(CarrilsStrip, props);
    expect(container.querySelectorAll('[data-pip]')).toHaveLength(4);
    const hold = container.querySelector('.strip__pip--hold')!;
    expect(hold.textContent).toContain('Fira Tàrrega');
    expect(container.querySelector('.strip__pip--travel')!.textContent).toContain('→ London');
    // Full title survives the ellipsis clamp.
    expect(container.querySelector('[title*="Igualada"]')).toBeInTheDocument();
    // Perf pips with a slug link to the detail page (same as month chips).
    expect(
      container.querySelector('a[href="/h/muk/performance/aurora"]'),
    ).toBeInTheDocument();
  });

  it('renders quiet in-lane bands (prep, blackout, away)', () => {
    const { container } = render(CarrilsStrip, props);
    expect(container.querySelector('.strip__band--prep')!.textContent).toBe('Assaigs');
    expect(container.querySelector('.strip__band--blackout')!.textContent).toBe('Mia — away');
    expect(container.querySelector('.strip__band--away')!.textContent).toBe('away · Última');
  });

  it('marks today on the axis and paints the line', () => {
    const { container } = render(CarrilsStrip, props);
    expect(container.querySelector('.strip__daynum--today')!.textContent).toBe('18');
    expect(container.querySelector('.strip__now-label')!.textContent).toBe('Today');
    expect(container.querySelector('.strip__now')).toBeInTheDocument();
  });

  it('reports the decision pair id when a connector is clicked', async () => {
    const onConnectorJump = vi.fn();
    const { container } = render(CarrilsStrip, { ...props, onConnectorJump });
    (container.querySelector('[data-connector]') as HTMLButtonElement).click();
    expect(onConnectorJump).toHaveBeenCalledWith('2026-07-17:a+b');
  });
});

describe('CarrilsStrip — loom (per persona)', () => {
  const props = {
    monthDays: JULY,
    todayIso: '2026-07-18',
    group: 'persona' as const,
    lanes: [],
    loom,
    connectors: [],
    onConnectorJump: () => {},
    locale: 'en' as const,
  };

  it('renders the legend, group header and one thread per person', () => {
    const { container } = render(CarrilsStrip, props);
    expect(container.querySelector('.strip__legend')).toBeInTheDocument();
    expect(container.querySelector('.strip__grp-name')!.textContent).toContain('MaMeMi');
    expect(container.querySelectorAll('.strip__thread')).toHaveLength(2);
  });

  it('speaks the thread grammar: segments, fora? pill, knot + flag, badges', () => {
    const { container } = render(CarrilsStrip, props);
    expect(container.querySelectorAll('.strip__seg')).toHaveLength(2);
    expect(container.querySelector('.strip__seg--hold')).toBeInTheDocument();
    expect(container.querySelector('.strip__out--tent')!.textContent).toBe('away?');
    expect(container.querySelector('.strip__knot')).toBeInTheDocument();
    expect(container.querySelector('.strip__kflag')!.textContent).toBe('knot · 17');
    const badges = [...container.querySelectorAll('.strip__badge')].map((b) => b.textContent);
    expect(badges).toEqual(['shared', 'no data']);
  });

  it('ghost threads render dashed with no segments', () => {
    const { container } = render(CarrilsStrip, props);
    expect(container.querySelector('.strip__thread--ghost')).toBeInTheDocument();
  });
});
