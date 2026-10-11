import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
  CONTACT_ROLE_MAX,
  CONVERSATION_SELECT,
  ContactSetSchema,
  ConversationCreateSchema,
  contactSetArgs,
  conversationCreateProblem,
  conversationTitle,
  conversationWhoBody,
  currentContacts,
  existingConversationId,
  normalizeConversationItem,
  sortContacts,
  type ConversationContact,
  type ConversationDbItem,
} from './conversation';

/** ADR-102, fase 2: la conversación es con la organización; las personas, sus contactos. */

const PROJECT = '11111111-1111-4111-8111-111111111111';
const ORG = '33333333-3333-4333-8333-333333333333';
const PERSON = '22222222-2222-4222-8222-222222222222';
const CONV = '44444444-4444-4444-8444-444444444444';

const contact = (over: Partial<ConversationContact>): ConversationContact => ({
  person_id: PERSON,
  role: null,
  since: null,
  until: null,
  is_primary: false,
  person: { slug: 'x', full_name: 'X', email: null, phone: null },
  ...over,
});

describe('create body', () => {
  const parse = (body: unknown) => v.parse(ConversationCreateSchema, body);

  it('accepts an organization alone, by id or by name', () => {
    expect(conversationCreateProblem(parse({ project_id: PROJECT, organization_id: ORG }))).toBeNull();
    expect(conversationCreateProblem(parse({ project_id: PROJECT, organization: { name: 'Pradillo' } }))).toBeNull();
  });

  it('accepts a person alone (their organization, or one named after them)', () => {
    expect(conversationCreateProblem(parse({ project_id: PROJECT, person_id: PERSON }))).toBeNull();
    expect(conversationCreateProblem(parse({ project_id: PROJECT, person: { full_name: 'Inés' } }))).toBeNull();
  });

  it('accepts an organization with its contact', () => {
    expect(
      conversationCreateProblem(parse({ project_id: PROJECT, organization_id: ORG, person: { full_name: 'Inés' } })),
    ).toBeNull();
  });

  it('rejects nothing, or both forms of the same thing', () => {
    expect(conversationCreateProblem(parse({ project_id: PROJECT }))).toMatch(/organization/);
    expect(
      conversationCreateProblem(parse({ project_id: PROJECT, organization_id: ORG, organization: { name: 'P' } })),
    ).toMatch(/organization_id or organization/);
    expect(
      conversationCreateProblem(parse({ project_id: PROJECT, person_id: PERSON, person: { full_name: 'I' } })),
    ).toMatch(/person_id or person/);
  });

  it('caps the role at the database limit', () => {
    const long = 'x'.repeat(CONTACT_ROLE_MAX + 1);
    expect(v.safeParse(ConversationCreateSchema, { project_id: PROJECT, organization_id: ORG, role: long }).success).toBe(false);
    expect(v.safeParse(ContactSetSchema, { person_id: PERSON, role: long }).success).toBe(false);
    expect(v.safeParse(ContactSetSchema, { person_id: PERSON, role: 'x'.repeat(CONTACT_ROLE_MAX) }).success).toBe(true);
  });
});

describe('the 409 that names the existing conversation', () => {
  it('reads the id from the DETAIL of create_conversation', () => {
    const body = JSON.stringify({ code: '23505', details: `conversation_id=${CONV.toUpperCase()}`, message: 'x' });
    expect(existingConversationId(body)).toBe(CONV);
  });
  it('returns null for any other conflict or a body that is not JSON', () => {
    expect(existingConversationId(JSON.stringify({ code: '23505', details: null }))).toBeNull();
    expect(existingConversationId(JSON.stringify({ code: '23505', details: 'Key (slug)=(x) exists' }))).toBeNull();
    expect(existingConversationId('<html>')).toBeNull();
  });
});

describe('set_conversation_contact arguments (review of phase 1)', () => {
  const current = { person_id: PERSON, role: 'programadora', since: '2025-01-01', until: null, is_primary: true };

  it('a role change keeps since and the primary mark', () => {
    expect(contactSetArgs(CONV, { person_id: PERSON, role: 'dirección' }, current)).toEqual({
      p_conversation_id: CONV,
      p_person_id: PERSON,
      p_role: 'dirección',
      p_since: '2025-01-01',
      p_is_primary: true,
    });
  });

  it('explicit nulls clear; a new contact gets nulls and not primary', () => {
    expect(contactSetArgs(CONV, { person_id: PERSON, since: null, role: null }, current)).toMatchObject({
      p_role: null,
      p_since: null,
    });
    expect(contactSetArgs(CONV, { person_id: PERSON }, null)).toMatchObject({
      p_role: null,
      p_since: null,
      p_is_primary: false,
    });
  });
});

describe('contacts and title', () => {
  it('sorts primary, then current by name, then closed by most recent', () => {
    const sorted = sortContacts([
      contact({ person_id: 'a', until: '2025-01-01', person: { slug: 'a', full_name: 'Ana', email: null, phone: null } }),
      contact({ person_id: 'b', person: { slug: 'b', full_name: 'Bea', email: null, phone: null } }),
      contact({ person_id: 'c', until: '2026-01-01', person: { slug: 'c', full_name: 'Cris', email: null, phone: null } }),
      contact({ person_id: 'd', is_primary: true, person: { slug: 'd', full_name: 'Dani', email: null, phone: null } }),
      contact({ person_id: 'e', person: { slug: 'e', full_name: 'Abel', email: null, phone: null } }),
    ]);
    expect(sorted.map((c) => c.person_id)).toEqual(['d', 'e', 'b', 'c', 'a']);
  });

  it('current contacts are the open ones and those closing today or later', () => {
    const list = [contact({ person_id: 'a' }), contact({ person_id: 'b', until: '2026-10-11' }), contact({ person_id: 'c', until: '2026-10-10' })];
    expect(currentContacts(list, '2026-10-11').map((c) => c.person_id)).toEqual(['a', 'b']);
  });

  it('the title is the organization; before ADR-102, the person', () => {
    expect(conversationTitle({ organization: { id: ORG, slug: 'p', name: 'Pradillo', kind: 'theatre', city: null }, person: null })).toBe('Pradillo');
    expect(
      conversationTitle({
        organization: null,
        person: { id: PERSON, slug: 'i', full_name: 'Inés', email: null, organization_name: null, country: null, city: null, website: null },
      }),
    ).toBe('Inés');
  });

  it('normalizes the embeds: organization and sorted contacts, person kept', () => {
    const item = normalizeConversationItem({
      person: null,
      project: null,
      organization: { id: ORG, slug: 'pradillo', name: 'Pradillo', kind: 'theatre', city: 'Madrid' },
      contacts: [contact({ person_id: 'b' }), contact({ person_id: 'a', is_primary: true })],
    } as unknown as ConversationDbItem);
    expect(item.organization?.name).toBe('Pradillo');
    expect(item.contacts.map((c) => c.person_id)).toEqual(['a', 'b']);
    expect(item.person).toBeNull();

    const old = normalizeConversationItem({ person: null, project: null } as unknown as ConversationDbItem);
    expect(old.organization).toBeNull();
    expect(old.contacts).toEqual([]);
  });

  it('the select embeds the organization by the FK the contract keeps', () => {
    expect(CONVERSATION_SELECT).toContain('workspace_organization!conversation_workspace_organization_fkey');
    expect(CONVERSATION_SELECT).toContain('contacts:conversation_contact(');
  });
});

describe('what the capture dialogs send', () => {
  it('a name sends the person, with the organization by name', () => {
    expect(conversationWhoBody({ name: ' Inés ', email: '', organization: 'Pradillo' })).toEqual({
      person: { full_name: 'Inés', email: null, organization_name: 'Pradillo' },
    });
    expect(conversationWhoBody({ name: 'Inés', phone: ' 600 ', organization: '' })).toEqual({
      person: { full_name: 'Inés', email: null, phone: '600', organization_name: null },
    });
  });
  it('only an organization sends the organization; neither sends nothing', () => {
    expect(conversationWhoBody({ name: ' ', organization: ' Pradillo ' })).toEqual({ organization: { name: 'Pradillo' } });
    expect(conversationWhoBody({ name: '', organization: '' })).toBeNull();
  });
});
