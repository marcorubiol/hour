import { describe, expect, it } from 'vitest';
import { noteFallback, noteFallbackBody } from './note';
import { buildLineIndex, buildProjectIndex, resolveScope, type NavWorkspace, type RawLine, type RawProject } from './nav';

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
const scopeOf = (pins: string[]) => resolveScope(pins, WS, buildLineIndex(WS, LINES), buildProjectIndex(WS, PROJECTS));

describe('noteFallback: where a note with nothing on its day falls', () => {
  it('one pinned project, that project', () => {
    const f = noteFallback(scopeOf(['p:p2']), WS, 'es');
    expect(f).toEqual({ label: 'Otro', project_id: 'p2' });
    expect(noteFallbackBody(f)).toEqual({ project_id: 'p2' });
  });
  it('one pinned line, that line', () => {
    expect(noteFallbackBody(noteFallback(scopeOf(['l:l1']), WS, 'es'))).toEqual({ line_id: 'l1' });
  });
  it('one pinned space, that space', () => {
    expect(noteFallbackBody(noteFallback(scopeOf(['s:otra']), WS, 'es'))).toEqual({ workspace_id: 'w2' });
  });
  it('anything else, the first space', () => {
    expect(noteFallbackBody(noteFallback(scopeOf([]), WS, 'es'))).toEqual({ workspace_id: 'w1' });
    expect(noteFallbackBody(noteFallback(scopeOf(['p:p1', 'p:p2']), WS, 'es'))).toEqual({ workspace_id: 'w1' });
  });
  it('no space at all, the company, with nothing to send', () => {
    const f = noteFallback(scopeOf([]), [], 'es');
    expect(f.label).toBe('la compañía');
    expect(noteFallbackBody(f)).toEqual({});
  });
});
