/**
 * Las facetas del espacio en Ajustes (comms carril 2, fase 4), con datos
 * inventados: el admin ve el vocabulario, lo que da cada paquete y los
 * ajustes por persona, y elegir un verbo lo guarda por `set_membership_facet`;
 * quien no es admin ve el vocabulario y los paquetes, sin controles ni personas.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Harness from '../test/FacetsSectionHarness.svelte';
import type { FacetsPayload } from '$lib/workspace-facets';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 4; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
  }
}

const WS = 'a0000000-0000-4000-8000-000000000001';
const URL = `/api/workspaces/${WS}/facets`;

const BASE: FacetsPayload = {
  can_edit: true,
  facets: [
    { id: 'f-tec', workspace_id: null, key: 'tecnica', label: null, labels: {}, sort: 30, levels: [{ level: 'bolo' }, { level: 'project' }] },
    { id: 'f-com', workspace_id: null, key: 'comidas', label: null, labels: {}, sort: 55, levels: [{ level: 'bolo' }] },
    { id: 'f-own', workspace_id: WS, key: 'vestuari', label: 'Vestuari', labels: {}, sort: 70, levels: [] },
  ],
  settings: [{ workspace_id: WS, facet_id: 'f-com', label: null, labels: {}, active: false, sort: null }],
  presets: [
    { key: 'minim', sort: 10, container_verb: 'view', can_edit_meta: false },
    { key: 'equip', sort: 20, container_verb: 'view', can_edit_meta: false },
  ],
  preset_facets: [
    { preset_key: 'equip', facet_key: 'tecnica', verb: 'view' },
    { preset_key: 'equip', facet_key: 'comidas', verb: 'view' },
  ],
  grants: [
    {
      id: 'm1',
      level: 'bolo',
      user_id: 'u1',
      preset: 'equip',
      name: 'Pau Riera',
      container: 'Teatre Lliure, Barcelona',
      facets: [{ facet_id: 'f-tec', verb: 'view', source: 'preset' }],
    },
  ],
};

function stubFetch(payload: FacetsPayload) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === 'GET') return new Response(JSON.stringify(payload), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }),
  );
  return calls;
}

describe('FacetsSection', () => {
  it('the admin sees the facets, what each package gives and the per-person adjustments', async () => {
    stubFetch(BASE);
    const { container } = render(Harness);
    await settle();

    const rows = [...container.querySelectorAll('[data-facet]')].filter((el) => el.classList.contains('facetset'));
    expect(rows.map((el) => el.getAttribute('data-facet'))).toEqual(['tecnica', 'comidas', 'vestuari']);
    expect(container.querySelector('[data-facet="comidas"].facetset')?.classList.contains('is-off')).toBe(true);
    // An own facet without a level says it cannot be given yet.
    expect(container.querySelector('[data-facet="vestuari"] .set-row__hint')?.textContent).toMatch(/no level/);

    const equip = container.querySelector('[data-preset="equip"]')!;
    expect(equip.textContent).toMatch(/Technical sees · Meals sees/);
    expect(container.querySelector('[data-preset="minim"]')?.textContent).toMatch(/No facet/);

    const pau = container.querySelector('[data-membership="m1"]')!;
    expect(pau.textContent).toMatch(/Pau Riera/);
    expect(pau.textContent).toMatch(/deal · Teatre Lliure, Barcelona · Team package · 1 by hand/);
    // Equip gives Meals and Pau does not have it: taken away by hand.
    expect(pau.querySelector('[data-facet="comidas"]')?.textContent).toMatch(/by hand · the package: sees/);
    // The own facet exists at no level, so it is not offered (absent is not denied).
    expect(pau.querySelector('[data-facet="vestuari"]')).toBeNull();
  });

  it('choosing a verb saves it in place through the grants endpoint', async () => {
    const calls = stubFetch(BASE);
    const { container } = render(Harness);
    await settle();

    const edit = container.querySelector(
      '[data-membership="m1"] [data-facet="tecnica"] input[value="edit"]',
    ) as HTMLInputElement;
    await fireEvent.click(edit);
    await settle();
    expect(calls.find((c) => c.method === 'PUT')).toEqual({
      method: 'PUT',
      url: `${URL}/grants`,
      body: { membership_id: 'm1', facet_id: 'f-tec', verb: 'edit' },
    });
  });

  it('turning a facet off patches its setting', async () => {
    const calls = stubFetch(BASE);
    render(Harness);
    await settle();

    await fireEvent.click(screen.getByTestId('facet-active-tecnica'));
    await settle();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ facet_id: 'f-tec', active: false });
  });

  it('whoever is not admin sees the facets and the packages, without controls or people', async () => {
    stubFetch({ ...BASE, can_edit: false, grants: [] });
    const { container } = render(Harness);
    await settle();

    expect(container.querySelectorAll('.facetset').length).toBe(3);
    expect(container.querySelector('input[type="text"]')).toBeNull();
    expect(container.querySelector('[data-testid="settings-facets-presets"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-facets-grants"]')).toBeNull();
  });
});
