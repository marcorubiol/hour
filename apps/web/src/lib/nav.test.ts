import { describe, expect, it } from 'vitest';
import {
  buildLineIndex,
  buildProjectIndex,
  inScope,
  lineUrl,
  projectUrl,
  resolveScope,
  type NavWorkspace,
  type RawLine,
  type RawProject,
} from './nav';
import { linePin, parsePin, projectPin, spacePin } from './stores/pins.svelte';

const WS: NavWorkspace[] = [
  { id: 'ws-muk', slug: 'muk-cia', name: 'MüK Cia', kind: 'team' },
  { id: 'ws-demo', slug: 'demo', name: 'demo', kind: 'team' },
];

const PROJECTS: RawProject[] = [
  {
    id: 'proj-mamemi',
    slug: 'mamemi',
    name: 'MaMeMi',
    status: 'active',
    workspace_id: 'ws-muk',
    starts_on: null,
    ends_on: null,
    updated_at: '2026-07-01T00:00:00Z',
  },
  {
    id: 'proj-orbita',
    slug: 'ultima-orbita',
    name: 'Última órbita',
    status: 'active',
    workspace_id: 'ws-demo',
    starts_on: null,
    ends_on: null,
    updated_at: '2026-06-01T00:00:00Z',
  },
  {
    id: 'proj-ghost',
    slug: 'ghost',
    name: 'Ghost',
    status: 'active',
    workspace_id: 'ws-unknown',
    starts_on: null,
    ends_on: null,
    updated_at: '2026-06-01T00:00:00Z',
  },
];

const LINES: RawLine[] = [
  {
    id: 'line-difusion',
    slug: 'difusion-2026-27',
    name: 'Difusión 2026-27',
    kind: 'campaign',
    status: 'open',
    workspace_id: 'ws-muk',
    project: { id: 'proj-mamemi', slug: 'mamemi', name: 'MaMeMi', workspace_id: 'ws-muk' },
  },
  {
    id: 'line-gira',
    slug: 'gira',
    name: 'Gira',
    kind: 'tour',
    status: 'open',
    workspace_id: 'ws-demo',
    project: { id: 'proj-orbita', slug: 'ultima-orbita', name: 'Última órbita', workspace_id: 'ws-demo' },
  },
];

describe('parsePin', () => {
  it('round-trips the three pin kinds', () => {
    expect(parsePin(spacePin('muk-cia'))).toEqual({ kind: 'space', key: 'muk-cia' });
    expect(parsePin(projectPin('proj-mamemi'))).toEqual({ kind: 'project', key: 'proj-mamemi' });
    expect(parsePin(linePin('line-difusion'))).toEqual({ kind: 'line', key: 'line-difusion' });
  });
});

describe('buildProjectIndex', () => {
  it('resolves workspace display fields and drops unknown workspaces', () => {
    const index = buildProjectIndex(WS, PROJECTS);
    expect(index.map((p) => p.id)).toEqual(['proj-mamemi', 'proj-orbita']);
    const mamemi = index[0];
    expect(mamemi.workspaceSlug).toBe('muk-cia');
    expect(mamemi.workspaceName).toBe('MüK Cia');
    expect(mamemi.accent).toMatch(/^var\(--accent-([1-9]|1[0-2])\)$/);
    expect(projectUrl(mamemi)).toBe('/h/muk-cia/project/mamemi/');
  });
});

describe('resolveScope', () => {
  const projectIndex = buildProjectIndex(WS, PROJECTS);
  const lineIndex = buildLineIndex(WS, LINES);

  it('empty pins = empty scope', () => {
    const scope = resolveScope([], WS, lineIndex, projectIndex);
    expect(scope.isEmpty).toBe(true);
    expect(scope.projectIds).toEqual([]);
    expect(scope.projects).toEqual([]);
  });

  it('resolves the three pin kinds and unions projectIds', () => {
    const scope = resolveScope(
      [spacePin('muk-cia'), projectPin('proj-orbita'), linePin('line-difusion')],
      WS,
      lineIndex,
      projectIndex,
    );
    expect(scope.isEmpty).toBe(false);
    expect(scope.workspaceIds).toEqual(['ws-muk']);
    expect(scope.lineIds).toEqual(['line-difusion']);
    // Direct project pin + the pinned line's project, deduped.
    expect(scope.projectIds.sort()).toEqual(['proj-mamemi', 'proj-orbita']);
    // `projects` carries only DIRECT pins (lenses use it for exact-line
    // narrowing exceptions), never line-derived ones.
    expect(scope.projects.map((p) => p.id)).toEqual(['proj-orbita']);
  });

  it('dedupes a project pinned both directly and through its line', () => {
    const scope = resolveScope(
      [projectPin('proj-mamemi'), linePin('line-difusion')],
      WS,
      lineIndex,
      projectIndex,
    );
    expect(scope.projectIds).toEqual(['proj-mamemi']);
  });

  it('drops pins whose target is not in the caches (stale or still loading)', () => {
    const scope = resolveScope(
      [projectPin('gone'), linePin('gone'), spacePin('gone')],
      WS,
      lineIndex,
      projectIndex,
    );
    expect(scope.isEmpty).toBe(false);
    expect(scope.projectIds).toEqual([]);
    expect(scope.workspaceIds).toEqual([]);
    expect(scope.lineIds).toEqual([]);
  });
});

describe('inScope', () => {
  const projectIndex = buildProjectIndex(WS, PROJECTS);
  const lineIndex = buildLineIndex(WS, LINES);

  it('a direct project pin admits items of that project', () => {
    const scope = resolveScope([projectPin('proj-mamemi')], WS, lineIndex, projectIndex);
    expect(inScope(scope, { projectId: 'proj-mamemi' })).toBe(true);
    expect(inScope(scope, { projectId: 'proj-orbita' })).toBe(false);
  });

  it('a line pin admits by line id and reaches items through its project', () => {
    const scope = resolveScope([linePin('line-difusion')], WS, lineIndex, projectIndex);
    expect(inScope(scope, { lineId: 'line-difusion' })).toBe(true);
    expect(inScope(scope, { projectId: 'proj-mamemi' })).toBe(true);
    expect(inScope(scope, { projectId: 'proj-orbita' })).toBe(false);
  });

  it('empty scope admits everything', () => {
    const scope = resolveScope([], WS, lineIndex, projectIndex);
    expect(inScope(scope, {})).toBe(true);
  });
});

describe('lineUrl', () => {
  it('addresses lines inside their project', () => {
    const [line] = buildLineIndex(WS, LINES);
    expect(lineUrl(line)).toBe('/h/muk-cia/project/mamemi/line/difusion-2026-27');
  });
});
