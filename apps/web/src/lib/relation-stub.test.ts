import { describe, expect, it } from 'vitest';
import { RELATION_STUB_LIMIT, relationStubQueryOptions, relationStubUrl } from './relation-stub';

const ID = '0b6a3f4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

describe('relationStubQueryOptions: el bloque de conversaciones del proyecto', () => {
  it('filtra por el id del proyecto, nunca por su slug', () => {
    const url = new URL(relationStubUrl(ID), 'https://x');
    expect(url.pathname).toBe('/api/conversations');
    expect(url.searchParams.get('project_ids')).toBe(ID);
    expect(url.searchParams.has('project_slug')).toBe(false);
    expect(url.searchParams.get('status')).toBe('any');
    expect(url.searchParams.get('limit')).toBe(String(RELATION_STUB_LIMIT));
  });

  it('la clave lleva el id: dos proyectos con el mismo slug no comparten caché', () => {
    const a = relationStubQueryOptions(ID).queryKey;
    const b = relationStubQueryOptions('1b6a3f4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b').queryKey;
    expect(a).not.toEqual(b);
    expect(JSON.stringify(a)).not.toContain('slug');
  });

  it('sin proyecto resuelto no pide nada', () => {
    expect(relationStubQueryOptions(null).enabled).toBe(false);
    expect(relationStubQueryOptions(ID).enabled).toBe(true);
  });
});
