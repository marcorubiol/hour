import { describe, expect, it } from 'vitest';
import {
  ALL,
  SALES,
  TEAM,
  addTagKey,
  canBulkSend,
  chipHref,
  filterByChip,
  lensChip,
  lensChips,
  otherTagsName,
  legacyViewRedirect,
  panelHref,
  panelOf,
  scopeTags,
  tagIdIn,
  tagKeysOf,
  tagLabel,
  workspaceTags,
  RESERVED_TAG_KEYS,
  TAG_KEY_RE,
  moveTag,
  newTagProblem,
  nextSort,
  settingsTags,
  sortsOf,
  tagKeyFromLabel,
  type TagVocabulary,
} from './conversation-tags';

const WS_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const WS_B = 'bbbbbbbb-0000-4000-8000-000000000002';

const vocab: TagVocabulary = {
  tags: [
    { id: 't-sales', workspace_id: null, key: 'sales', label: null, labels: {}, sort: 10 },
    { id: 't-press', workspace_id: null, key: 'press', label: null, labels: {}, sort: 20 },
    { id: 't-copro', workspace_id: null, key: 'coproduction', label: null, labels: {}, sort: 30 },
    { id: 't-dist', workspace_id: null, key: 'distribution', label: null, labels: {}, sort: 40 },
    { id: 't-fest', workspace_id: WS_A, key: 'festivals', label: 'Festivales', labels: { ca: 'Festivals' }, sort: 15 },
  ],
  settings: [
    // A turns Distribución off; B renames Prensa and moves it first.
    { workspace_id: WS_A, tag_id: 't-dist', label: null, labels: {}, active: false, sort: null },
    { workspace_id: WS_B, tag_id: 't-press', label: 'Medios', labels: {}, active: true, sort: 5 },
  ],
};

const q = (s: string) => new URLSearchParams(s);

describe('the chip comes from the URL', () => {
  it('without a parameter the lens opens on Todas (ADR-138 § 2)', () => {
    expect(lensChip(q(''), true)).toBe(ALL);
    expect(lensChip(q('etiqueta=all'), true)).toBe(ALL);
  });
  it('a tag key or Equipo', () => {
    expect(lensChip(q('etiqueta=sales'), true)).toBe(SALES);
    expect(lensChip(q('etiqueta=press'), true)).toBe('press');
    expect(lensChip(q('etiqueta=team'), true)).toBe(TEAM);
  });
  it('something that is not a key is Todas, never a filter', () => {
    expect(lensChip(q('etiqueta=Press!'), true)).toBe(ALL);
    expect(lensChip(q('etiqueta=x'), true)).toBe(ALL);
  });
  it('without Converses it is always Equipo', () => {
    expect(lensChip(q(''), false)).toBe(TEAM);
    expect(lensChip(q('etiqueta=sales'), false)).toBe(TEAM);
  });
});

describe('the views of ADR-134 redirect to chips', () => {
  it('?view=team and ?view=threads go to ?etiqueta=team, keeping the rest', () => {
    expect(legacyViewRedirect(q('view=team'))?.toString()).toBe('etiqueta=team');
    expect(legacyViewRedirect(q('view=threads&scope=s:playwright'))?.toString()).toBe('scope=s%3Aplaywright&etiqueta=team');
  });
  it('nothing to redirect otherwise', () => {
    expect(legacyViewRedirect(q(''))).toBeNull();
    expect(legacyViewRedirect(q('etiqueta=team'))).toBeNull();
    expect(legacyViewRedirect(q('view=other'))).toBeNull();
  });
});

describe('who sees which chips', () => {
  it('Todas, the tags in order, Equipo last', () => {
    const chips = lensChips(true, scopeTags(vocab, [WS_A]), 'es');
    expect(chips.map((c) => c.chip)).toEqual([ALL, 'sales', 'festivals', 'press', 'coproduction', TEAM]);
    expect(chips.map((c) => c.label)).toEqual(['Todas', 'Difusión', 'Festivales', 'Prensa', 'Coproducción', 'Equipo']);
  });
  it('without Converses only Equipo', () => {
    expect(lensChips(false, scopeTags(vocab, [WS_A]), 'es').map((c) => c.chip)).toEqual([TEAM]);
  });
  it('sales is named by the key of ADR-134 (its @music variant lives there)', () => {
    expect(tagLabel({ key: 'sales', label: null, labels: {} }, 'es')).toBe('Difusión');
  });
});

describe('the vocabulary of a space and of a scope', () => {
  it('a space: its own tags, without the ones it turned off, in its order', () => {
    expect(workspaceTags(vocab, WS_A).map((x) => x.key)).toEqual(['sales', 'festivals', 'press', 'coproduction']);
    expect(workspaceTags(vocab, WS_B).map((x) => x.key)).toEqual(['press', 'sales', 'coproduction', 'distribution']);
  });
  it('an own tag of another space never shows', () => {
    expect(workspaceTags(vocab, WS_B).some((x) => x.key === 'festivals')).toBe(false);
  });
  it('several spaces: active in any; a rename only when they all agree', () => {
    const tags = scopeTags(vocab, [WS_A, WS_B]);
    expect(tags.map((x) => x.key)).toContain('distribution');
    expect(tagLabel(tags.find((x) => x.key === 'press')!, 'es')).toBe('Prensa');
    expect(tagLabel(scopeTags(vocab, [WS_B]).find((x) => x.key === 'press')!, 'es')).toBe('Medios');
  });
  it('an own tag reads its translation, then its name', () => {
    const fest = workspaceTags(vocab, WS_A).find((x) => x.key === 'festivals')!;
    expect(tagLabel(fest, 'ca')).toBe('Festivals');
    expect(tagLabel(fest, 'fr')).toBe('Festivales');
  });
  it('the id of a key in a space, or null where it is off', () => {
    expect(tagIdIn(vocab, WS_A, 'press')).toBe('t-press');
    expect(tagIdIn(vocab, WS_A, 'distribution')).toBeNull();
    expect(tagIdIn(vocab, WS_B, 'festivals')).toBeNull();
  });
});

describe('what a conversation carries', () => {
  it('its keys; none reads as sales', () => {
    expect(tagKeysOf([{ tag: { key: 'press' } }, { tag: { key: 'sales' } }])).toEqual(['press', 'sales']);
    expect(tagKeysOf([])).toEqual([SALES]);
    expect(tagKeysOf(null)).toEqual([SALES]);
    expect(tagKeysOf([{ tag: null }])).toEqual([SALES]);
  });
  it('a chip filters by its tag; an untagged row is Difusión; Todas keeps all', () => {
    const rows = [
      { id: '1', tags: ['sales'] },
      { id: '2', tags: ['press'] },
      { id: '3', tags: ['sales', 'coproduction'] },
      { id: '4', tags: [] },
    ];
    expect(filterByChip(rows, SALES).map((r) => r.id)).toEqual(['1', '3', '4']);
    expect(filterByChip(rows, 'press').map((r) => r.id)).toEqual(['2']);
    expect(filterByChip(rows, 'coproduction').map((r) => r.id)).toEqual(['3']);
    expect(filterByChip(rows, ALL)).toHaveLength(4);
  });
});

describe('naming a row’s tags off the lens (Desk, ADR-138 fase 3)', () => {
  it('only Difusión (or none) says nothing; otherwise all of them, in the scope’s order', () => {
    const known = scopeTags(vocab, [WS_A]);
    expect(otherTagsName([], known, 'en')).toBeNull();
    expect(otherTagsName([SALES], known, 'en')).toBeNull();
    expect(otherTagsName(['press'], known, 'en')).toBe('Press');
    expect(otherTagsName(['press', 'festivals', SALES], known, 'es')).toBe('Difusión · Festivales · Prensa');
  });
});

describe('what each chip offers', () => {
  it('the panel: Difusión whole, Equipo the threads, the rest the common one', () => {
    expect(panelOf(SALES)).toBe('sales');
    expect(panelOf(TEAM)).toBe('team');
    expect(panelOf(ALL)).toBe('common');
    expect(panelOf('press')).toBe('common');
  });
  it('bulk send only under Difusión (ADR-138 § 7)', () => {
    expect(canBulkSend(SALES)).toBe(true);
    expect(canBulkSend(ALL)).toBe(false);
    expect(canBulkSend('press')).toBe(false);
    expect(canBulkSend(TEAM)).toBe(false);
  });
  it('«Añadir» is born with the chip’s tag, or Difusión', () => {
    expect(addTagKey('press')).toBe('press');
    expect(addTagKey(SALES)).toBe(SALES);
    expect(addTagKey(ALL)).toBe(SALES);
    expect(addTagKey(TEAM)).toBe(SALES);
  });
});

describe('links', () => {
  it('a chip keeps the scope and drops the panel filters', () => {
    expect(chipHref('press', q('scope=s:x&turno=nuestro&etiqueta=sales'))).toBe('/h/conversations?scope=s%3Ax&etiqueta=press');
    expect(chipHref(ALL, q('etiqueta=press&relacion=talking'))).toBe('/h/conversations');
  });
  it('a block of the panel carries the chip', () => {
    expect(panelHref(SALES, 'turno=nuestro#lista')).toBe('?etiqueta=sales&turno=nuestro#lista');
    expect(panelHref(ALL, 'turno=nuestro#lista')).toBe('?turno=nuestro#lista');
  });
});

describe('the settings of a space (ADR-138 fase 4)', () => {
  it('derives the key from the name', () => {
    expect(tagKeyFromLabel('Coproducción')).toBe('coproduccion');
    expect(tagKeyFromLabel('  Festivals d’estiu 2027 ')).toBe('festivals_d_estiu_2027');
    expect(tagKeyFromLabel('2027 giras')).toBe('t_2027_giras');
    expect(tagKeyFromLabel('ZZZ E2E tag')).toBe('zzz_e2e_tag');
    expect(tagKeyFromLabel('a'.repeat(40))).toHaveLength(32);
    expect(tagKeyFromLabel('ab' + ' '.repeat(29) + 'cd')).toBe('ab_cd');
    expect(tagKeyFromLabel('x')).toBeNull();
    expect(tagKeyFromLabel('—')).toBeNull();
  });

  it('refuses all and team, a key the space already uses (standard too) and an empty name', () => {
    const taken = ['sales', 'press', 'giras'];
    expect(newTagProblem('All', taken)).toBe('reserved');
    expect(newTagProblem('TEAM', taken)).toBe('reserved');
    expect(newTagProblem(' Team ', taken)).toBe('reserved');
    expect(newTagProblem('Teams', taken)).toBeNull();
    expect(newTagProblem('Press', taken)).toBe('taken');
    expect(newTagProblem('Giras', taken)).toBe('taken');
    expect(newTagProblem('   ', taken)).toBe('invalid');
    expect(newTagProblem('x'.repeat(61), taken)).toBe('invalid');
    expect(newTagProblem('Festivales', taken)).toBeNull();
    for (const k of RESERVED_TAG_KEYS) expect(TAG_KEY_RE.test(k)).toBe(true);
  });

  it('lists active and inactive tags in the order of the space', () => {
    const v: TagVocabulary = {
      tags: [
        { id: 't-sales', workspace_id: null, key: 'sales', label: null, labels: {}, sort: 10 },
        { id: 't-press', workspace_id: null, key: 'press', label: null, labels: {}, sort: 20 },
        { id: 't-own', workspace_id: WS_A, key: 'giras', label: 'Giras', labels: {}, sort: 50 },
        { id: 't-other', workspace_id: WS_B, key: 'otra', label: 'Otra', labels: {}, sort: 5 },
      ],
      settings: [
        { workspace_id: WS_A, tag_id: 't-press', label: 'Medios', labels: {}, active: false, sort: 5 },
        { workspace_id: WS_B, tag_id: 't-sales', label: null, labels: {}, active: false, sort: null },
      ],
    };
    const list = settingsTags(v, WS_A);
    expect(list.map((x) => [x.key, x.active, x.standard, x.label])).toEqual([
      ['press', false, true, 'Medios'],
      ['sales', true, true, null],
      ['giras', true, false, 'Giras'],
    ]);
    // The lens sees only the active ones, in the same order.
    expect(workspaceTags(v, WS_A).map((x) => x.key)).toEqual(['sales', 'giras']);
    expect(nextSort(list)).toBe(60);
  });

  it('moves a tag one place and saves the order ten by ten', () => {
    const ids = ['a', 'b', 'c'];
    expect(moveTag(ids, 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveTag(ids, 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveTag(ids, 'a', -1)).toEqual(ids);
    expect(moveTag(ids, 'c', 1)).toEqual(ids);
    expect(moveTag(ids, 'z', 1)).toEqual(ids);
    expect(sortsOf(['c', 'a'])).toEqual([
      { id: 'c', sort: 10 },
      { id: 'a', sort: 20 },
    ]);
  });
});
