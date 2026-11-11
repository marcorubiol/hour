/**
 * Alta directa de persona (136): lo que manda el diálogo.
 */
import { describe, expect, it } from 'vitest';
import { personCreateBody } from './directory-create';

const WS = '0190a0b0-0000-7000-8000-0000000000ff';

describe('personCreateBody', () => {
  it('sends the name trimmed and only the fields with something', () => {
    expect(personCreateBody({ workspaceId: WS, fullName: '  Anna Puig ', title: '', email: ' anna@x.cat ', phone: '  ' })).toEqual({
      workspace_id: WS,
      full_name: 'Anna Puig',
      email: 'anna@x.cat',
    });
  });

  it('carries title and phone when given', () => {
    expect(personCreateBody({ workspaceId: WS, fullName: 'Anna', title: 'Programadora', email: '', phone: '600' })).toEqual({
      workspace_id: WS,
      full_name: 'Anna',
      title: 'Programadora',
      phone: '600',
    });
  });
});
