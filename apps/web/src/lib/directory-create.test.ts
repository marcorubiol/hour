/**
 * Alta directa de persona y organización (136): lo que manda el diálogo, la
 * organización que nombra un texto y el `ilike` que la busca entera.
 */
import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
  OrganizationCreateSchema,
  ilikeExact,
  matchOrganization,
  organizationCreateBody,
  personCreateBody,
} from './directory-create';

const WS = '0190a0b0-0000-7000-8000-0000000000ff';

describe('personCreateBody', () => {
  it('sends the name trimmed and only the fields with something', () => {
    expect(
      personCreateBody({ workspaceId: WS, fullName: '  Anna Puig ', title: '', email: ' anna@x.cat ', phone: '  ', organizationId: null }),
    ).toEqual({ workspace_id: WS, full_name: 'Anna Puig', email: 'anna@x.cat' });
  });

  it('carries the organization when there is one', () => {
    expect(
      personCreateBody({ workspaceId: WS, fullName: 'Anna', title: 'Programadora', email: '', phone: '600', organizationId: 'o1' }),
    ).toEqual({ workspace_id: WS, full_name: 'Anna', title: 'Programadora', phone: '600', organization_id: 'o1' });
  });
});

describe('organizationCreateBody and its schema', () => {
  it('sends the name and only the facts given, and the endpoint reads them', () => {
    const body = organizationCreateBody({ workspaceId: WS, name: ' Mercat de les Flors ', kind: 'theatre', city: 'Barcelona', email: '' });
    expect(body).toEqual({ workspace_id: WS, name: 'Mercat de les Flors', kind: 'theatre', city: 'Barcelona' });
    expect(v.safeParse(OrganizationCreateSchema, body).success).toBe(true);
  });

  it('refuses a blank name, an unknown type and a bad email', () => {
    expect(v.safeParse(OrganizationCreateSchema, { workspace_id: WS, name: '   ' }).success).toBe(false);
    expect(v.safeParse(OrganizationCreateSchema, { workspace_id: WS, name: 'X', kind: 'bar' }).success).toBe(false);
    expect(v.safeParse(OrganizationCreateSchema, { workspace_id: WS, name: 'X', email: 'nope' }).success).toBe(false);
    expect(v.safeParse(OrganizationCreateSchema, { workspace_id: WS, name: 'X', kind: 'solo', email: '' }).success).toBe(true);
  });
});

describe('matchOrganization', () => {
  const items = [
    { id: 'a', workspace_id: WS, name: 'Teatre Lliure' },
    { id: 'b', workspace_id: 'other', name: 'Mercat de les Flors' },
  ];

  it('the same name in that space, case and spaces aside', () => {
    expect(matchOrganization(items, WS, '  teatre lliure ')?.id).toBe('a');
  });

  it('none in another space, for half a name or for nothing typed', () => {
    expect(matchOrganization(items, WS, 'Mercat de les Flors')).toBeNull();
    expect(matchOrganization(items, WS, 'Teatre')).toBeNull();
    expect(matchOrganization(items, WS, '  ')).toBeNull();
  });
});

describe('ilikeExact', () => {
  it('escapes the wildcards so the name matches whole', () => {
    expect(ilikeExact('100% Teatre_*')).toBe('100\\% Teatre\\_\\*');
    expect(ilikeExact('Sala Beckett')).toBe('Sala Beckett');
  });
});
