import { describe, expect, it } from 'vitest';
import {
  levelDiff,
  newFacetProblem,
  ownLevels,
  personGrants,
  presetSummaries,
  settingsFacets,
  type ContainerLevel,
  type FacetRow,
  type FacetSettingRow,
  type GrantRow,
  type PresetFacetRow,
  type PresetRow,
} from './workspace-facets';

const WS = 'ws-1';

const lv = (...levels: ContainerLevel[]) => levels.map((level) => ({ level }));

const FACETS: FacetRow[] = [
  { id: 'f-tec', workspace_id: null, key: 'tecnica', label: null, labels: {}, sort: 30, levels: lv('bolo', 'project', 'line') },
  { id: 'f-din', workspace_id: null, key: 'diners', label: null, labels: {}, sort: 60, levels: lv('workspace', 'project', 'line', 'bolo') },
  { id: 'f-com', workspace_id: null, key: 'comidas', label: null, labels: {}, sort: 55, levels: lv('project', 'bolo', 'performance') },
  { id: 'f-own', workspace_id: WS, key: 'vestuari', label: 'Vestuari', labels: {}, sort: 70, levels: lv('bolo') },
  { id: 'f-other', workspace_id: 'ws-2', key: 'altre', label: 'Altre', labels: {}, sort: 5, levels: lv('bolo') },
];

const SETTINGS: FacetSettingRow[] = [
  { workspace_id: WS, facet_id: 'f-din', label: null, labels: {}, active: false, sort: 10 },
  { workspace_id: WS, facet_id: 'f-com', label: 'Càterin', labels: { es: 'Cáterin' }, active: true, sort: null },
  { workspace_id: 'ws-2', facet_id: 'f-tec', label: 'Nope', labels: {}, active: false, sort: 1 },
];

const PRESETS: PresetRow[] = [
  { key: 'equip', sort: 20, container_verb: 'view', can_edit_meta: false },
  { key: 'minim', sort: 10, container_verb: 'view', can_edit_meta: false },
  { key: 'coordinacio', sort: 30, container_verb: 'edit', can_edit_meta: true },
];

const PRESET_FACETS: PresetFacetRow[] = [
  { preset_key: 'equip', facet_key: 'tecnica', verb: 'view' },
  { preset_key: 'equip', facet_key: 'comidas', verb: 'view' },
  { preset_key: 'coordinacio', facet_key: 'tecnica', verb: 'edit' },
  { preset_key: 'coordinacio', facet_key: 'diners', verb: 'view' },
];

describe('settingsFacets', () => {
  const list = settingsFacets(FACETS, SETTINGS, WS);

  it("keeps Hour's and the space's own, never another space's", () => {
    expect(list.map((f) => f.key)).not.toContain('altre');
    expect(list.find((f) => f.key === 'vestuari')).toMatchObject({ standard: false, label: 'Vestuari' });
  });

  it("orders by the space's sort over Hour's, and reads the space's setting only", () => {
    expect(list.map((f) => f.key)).toEqual(['diners', 'tecnica', 'comidas', 'vestuari']);
    expect(list.find((f) => f.key === 'tecnica')).toMatchObject({ active: true, label: null });
    expect(list.find((f) => f.key === 'diners')?.active).toBe(false);
    expect(list.find((f) => f.key === 'comidas')).toMatchObject({ label: 'Càterin', labels: { es: 'Cáterin' } });
  });

  it('lists the levels in the order of the ladder', () => {
    expect(list.find((f) => f.key === 'tecnica')?.levels).toEqual(['project', 'line', 'bolo']);
  });
});

describe('newFacetProblem', () => {
  const taken = FACETS.map((f) => f.key);
  it('refuses a name whose key the space already uses, standard included', () => {
    expect(newFacetProblem('Técnica', taken)).toBe('taken');
    expect(newFacetProblem('Vestuari', taken)).toBe('taken');
  });
  it('refuses an empty or too long name', () => {
    expect(newFacetProblem('  ', taken)).toBe('invalid');
    expect(newFacetProblem('x'.repeat(61), taken)).toBe('invalid');
    expect(newFacetProblem('!', taken)).toBe('invalid');
  });
  it('takes a new name', () => {
    expect(newFacetProblem('Escenografia', taken)).toBeNull();
  });
});

describe('ownLevels and levelDiff', () => {
  it('never lets an own facet live at the space, and keeps the ladder order', () => {
    expect(ownLevels(['workspace', 'bolo', 'project', 'bolo', 'nope'])).toEqual(['project', 'bolo']);
  });
  it('adds and removes only what changes', () => {
    expect(levelDiff(['project', 'bolo'], ['bolo', 'performance'])).toEqual({ add: ['performance'], remove: ['project'] });
    expect(levelDiff(['bolo'], ['bolo'])).toEqual({ add: [], remove: [] });
  });
});

describe('presetSummaries', () => {
  const facets = settingsFacets(FACETS, SETTINGS, WS);
  const sums = presetSummaries(PRESETS, PRESET_FACETS, facets);

  it("goes in the presets' order, Minimal with no facet", () => {
    expect(sums.map((s) => s.key)).toEqual(['minim', 'equip', 'coordinacio']);
    expect(sums[0].facets).toEqual([]);
  });

  it("lists each preset's facets in the space's order, the ones turned off too", () => {
    expect(sums[2].facets.map((f) => [f.facet.key, f.verb])).toEqual([
      ['diners', 'view'],
      ['tecnica', 'edit'],
    ]);
  });
});

describe('personGrants', () => {
  const facets = settingsFacets(FACETS, SETTINGS, WS);
  const rows: GrantRow[] = [
    {
      id: 'm-bolo',
      level: 'bolo',
      user_id: 'u1',
      preset: 'equip',
      name: 'Laia',
      container: 'Teatre Lliure, Barcelona',
      facets: [
        { facet_id: 'f-tec', verb: 'view', source: 'preset' },
        { facet_id: 'f-own', verb: 'view', source: 'override' },
      ],
    },
    { id: 'm-ws', level: 'workspace', user_id: 'u2', preset: 'direccio', name: 'Marco', container: null, facets: [] },
    { id: 'm-perf', level: 'performance', user_id: 'u3', preset: null, name: null, container: null, facets: [] },
  ];
  const out = personGrants(rows, facets, PRESET_FACETS, 'No name');

  it('leaves out the space memberships: their facets are not decided', () => {
    // By name: «Laia» before the fallback «No name».
    expect(out.map((g) => g.membership_id)).toEqual(['m-bolo', 'm-perf']);
  });

  it('offers only the facets that exist at the membership level: absent is not denied', () => {
    const bolo = out.find((g) => g.membership_id === 'm-bolo')!;
    expect(bolo.facets.map((f) => f.facet.key)).toEqual(['diners', 'tecnica', 'comidas', 'vestuari']);
    const perf = out.find((g) => g.membership_id === 'm-perf')!;
    expect(perf.facets.map((f) => f.facet.key)).toEqual(['comidas']);
    expect(perf.name).toBe('No name');
  });

  it('marks what differs from the package: given, taken away or an own facet', () => {
    const bolo = out.find((g) => g.membership_id === 'm-bolo')!;
    const by = new Map(bolo.facets.map((f) => [f.facet.key, f]));
    expect(by.get('tecnica')).toMatchObject({ verb: 'view', presetVerb: 'view', adjusted: false });
    // Equip gives Comidas: missing here, so it was taken away by hand.
    expect(by.get('comidas')).toMatchObject({ verb: null, presetVerb: 'view', adjusted: true });
    // An own facet is never in a package.
    expect(by.get('vestuari')).toMatchObject({ verb: 'view', presetVerb: null, adjusted: true });
    expect(by.get('diners')).toMatchObject({ verb: null, presetVerb: null, adjusted: false });
    expect(bolo.adjusted).toBe(2);
  });
});
