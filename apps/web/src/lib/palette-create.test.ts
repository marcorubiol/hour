import { describe, expect, it } from 'vitest';
import {
  BASE_CREATES,
  CREATE_LABEL_KEYS,
  createEventType,
  paletteCreates,
  scopeCreatePresets,
  scopeTaskTarget,
  type CreateCan,
} from './palette-create';
import { buildLineIndex, buildProjectIndex, resolveScope, type NavWorkspace, type RawLine, type RawProject } from './nav';
import { t } from './i18n';
import { QUICK_MORE, QUICK_PRIMARY } from './quick-add';

const ALL: CreateCan = { plan: true, converse: true };
const kinds = (q: string, can: CreateCan = ALL) => paletteCreates(q, can).map((c) => c.kind);

describe('paletteCreates: what typing finds', () => {
  it('offers nothing for an empty query: the tree stays the tree', () => {
    expect(paletteCreates('', ALL)).toEqual([]);
    expect(paletteCreates('   ', ALL)).toEqual([]);
  });

  it('a verb in any of the four languages offers the four base actions', () => {
    for (const verb of ['nueva', 'nuevo', 'crear', 'new', 'create', 'add', 'nou', 'nova', 'afegeix', 'nouvelle', 'ajouter', 'Créer']) {
      expect(kinds(verb), verb).toEqual([...BASE_CREATES]);
    }
  });

  it('half a verb, as the last word, is enough', () => {
    expect(kinds('nue')).toEqual([...BASE_CREATES]);
    expect(kinds('cre')).toEqual([...BASE_CREATES]);
  });

  it('a kind word names its action, in any language and half-typed', () => {
    expect(kinds('ensayo')).toEqual(['rehearsal']);
    expect(kinds('assaig')).toEqual(['rehearsal']);
    expect(kinds('nuevo ensa')).toEqual(['rehearsal']);
    expect(kinds('viatge')).toEqual(['travel_day']);
    expect(kinds('residència')).toEqual(['residency']);
    expect(kinds('tâche')).toEqual(['task']);
    expect(kinds('tarea')).toEqual(['task']);
    expect(kinds('conversa')).toEqual(['conversation']);
    expect(kinds('Conversación')).toEqual(['conversation']);
    expect(kinds('nueva función')).toEqual(['performance']);
    expect(kinds('fecha')).toEqual(['date']);
  });

  it('a short prefix can name two kinds, and offers both', () => {
    expect(kinds('rep')).toEqual(['performance', 'rehearsal']);
  });

  it('what follows the words that named the action is the title', () => {
    expect(paletteCreates('nueva función Mercat de les Flors', ALL)).toEqual([
      { kind: 'performance', title: 'Mercat de les Flors' },
    ]);
    expect(paletteCreates('ensayo con luces', ALL)).toEqual([{ kind: 'rehearsal', title: 'con luces' }]);
    expect(paletteCreates('new Llamar a la sala', ALL).every((c) => c.title === 'Llamar a la sala')).toBe(true);
  });

  it('any other text offers the base actions with the whole text as title', () => {
    const out = paletteCreates('Mercat de les Flors', ALL);
    expect(out.map((c) => c.kind)).toEqual([...BASE_CREATES]);
    expect(out.every((c) => c.title === 'Mercat de les Flors')).toBe(true);
  });
});

describe('paletteCreates: never what the person cannot make', () => {
  it('without editing the plan, no performance and no date', () => {
    const can = { plan: false, converse: true };
    expect(kinds('nueva', can)).toEqual(['task', 'conversation']);
    expect(kinds('ensayo', can)).toEqual([]);
    expect(kinds('Mercat', can)).toEqual(['task', 'conversation']);
  });

  it('without Converses, no conversation', () => {
    const can = { plan: true, converse: false };
    expect(kinds('nueva', can)).toEqual(['performance', 'date', 'task']);
    expect(kinds('conversa', can)).toEqual([]);
  });

  it('a task is always there', () => {
    expect(kinds('tasca', { plan: false, converse: false })).toEqual(['task']);
  });
});

describe('the dialog each action opens', () => {
  it('a date kind opens the quick add on its type; «Nueva fecha» on a rehearsal', () => {
    expect(createEventType('performance')).toBe('performance');
    expect(createEventType('travel_day')).toBe('travel_day');
    expect(createEventType('date')).toBe('rehearsal');
    expect(createEventType('task')).toBeNull();
    expect(createEventType('conversation')).toBeNull();
  });

  it('every event type it opens is a type of the quick add', () => {
    const quick = new Set<string>([...QUICK_PRIMARY, ...QUICK_MORE]);
    for (const kind of Object.keys(CREATE_LABEL_KEYS) as (keyof typeof CREATE_LABEL_KEYS)[]) {
      const type = createEventType(kind);
      if (type) expect(quick.has(type), kind).toBe(true);
    }
  });

  it('every label speaks the four languages, with the trade', () => {
    for (const key of Object.values(CREATE_LABEL_KEYS)) {
      for (const loc of ['ca', 'es', 'en', 'fr'] as const) expect(t(key, loc)).not.toBe(key);
    }
    expect(t('palette.new_performance', 'es', {}, 'music')).toBe('Nuevo concierto');
  });
});

// ── The scope's say ────────────────────────────────────────────────────
const WS: NavWorkspace[] = [
  { id: 'w1', slug: 'muk', name: 'MüK', kind: 'team' },
  { id: 'w2', slug: 'otra', name: 'Otra', kind: 'team' },
];
const PROJECTS = [
  { id: 'p1', slug: 'mamemi', name: 'MaMeMi', status: 'active', workspace_id: 'w1' },
  { id: 'p2', slug: 'otro', name: 'Otro', status: 'active', workspace_id: 'w2' },
] as RawProject[];
const LINES = [
  { id: 'l1', slug: 'gira', name: 'Gira', kind: 'tour', status: 'active', workspace_id: 'w1', project: { id: 'p1', slug: 'mamemi', name: 'MaMeMi', workspace_id: 'w1' } },
] as RawLine[];
const projectIndex = buildProjectIndex(WS, PROJECTS);
const lineIndex = buildLineIndex(WS, LINES);
const scopeOf = (pins: string[]) => resolveScope(pins, WS, lineIndex, projectIndex);
const ids = WS.map((w) => w.id);

describe('scopeCreatePresets', () => {
  it('a pinned line gives its project and line', () => {
    expect(scopeCreatePresets(scopeOf(['l:l1']), ids)).toEqual({ projectId: 'p1', lineId: 'l1', workspaceId: 'w1' });
  });
  it('a pinned project gives itself', () => {
    expect(scopeCreatePresets(scopeOf(['p:p2']), ids)).toEqual({ projectId: 'p2', lineId: null, workspaceId: 'w2' });
  });
  it('a pinned space gives only its workspace', () => {
    expect(scopeCreatePresets(scopeOf(['s:muk']), ids)).toEqual({ projectId: null, lineId: null, workspaceId: 'w1' });
  });
  it('Everything with two spaces says nothing; with one, that one', () => {
    expect(scopeCreatePresets(scopeOf([]), ids)).toEqual({ projectId: null, lineId: null, workspaceId: null });
    expect(scopeCreatePresets(scopeOf([]), ['w1']).workspaceId).toBe('w1');
  });
  it('two projects pinned: no project, and no workspace if they are in two', () => {
    expect(scopeCreatePresets(scopeOf(['p:p1', 'p:p2']), ids)).toEqual({ projectId: null, lineId: null, workspaceId: null });
  });
});

describe('scopeTaskTarget', () => {
  it('the pinned line, else the project, else the space', () => {
    expect(scopeTaskTarget(scopeOf(['l:l1']), WS)).toMatchObject({ kind: 'line', id: 'l1', lineKind: 'tour' });
    expect(scopeTaskTarget(scopeOf(['p:p2']), WS)).toMatchObject({ kind: 'project', id: 'p2' });
    expect(scopeTaskTarget(scopeOf(['s:otra']), WS)).toMatchObject({ kind: 'space', id: 'w2' });
    expect(scopeTaskTarget(scopeOf([]), WS)).toMatchObject({ kind: 'space', id: 'w1' });
  });
});
