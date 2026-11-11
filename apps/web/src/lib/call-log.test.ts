import { describe, expect, it } from 'vitest';
import {
  byLastTouched,
  callEvent,
  contactEvent,
  freshContactLog,
  hasWho,
  withKind,
  callInFuture,
  callOccurredAt,
  callTargetConversations,
  callTargetWho,
  localTime,
  mergeCallTargets,
  touchedAt,
  type CallTarget,
} from './call-log';

const base: CallTarget = {
  kind: 'person',
  workspace_id: 'ws',
  id: 'p1',
  name: 'Laia Puig',
  title: null,
  house: null,
  org_kind: null,
  city: null,
  team: false,
  conversations: [],
};

describe('touchedAt', () => {
  it('takes the later of last contact and last write', () => {
    expect(touchedAt({ last_contacted_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-03T10:00:00Z' })).toBe('2026-11-03T10:00:00Z');
    expect(touchedAt({ last_contacted_at: '2026-11-04T10:00:00Z', updated_at: '2026-11-03T10:00:00Z' })).toBe('2026-11-04T10:00:00Z');
  });
  it('lives with either missing', () => {
    expect(touchedAt({ last_contacted_at: null, updated_at: '2026-11-03T10:00:00Z' })).toBe('2026-11-03T10:00:00Z');
    expect(touchedAt({ last_contacted_at: '2026-11-03T10:00:00Z', updated_at: null })).toBe('2026-11-03T10:00:00Z');
    expect(touchedAt({ last_contacted_at: null, updated_at: null })).toBeNull();
  });
});

describe('byLastTouched', () => {
  it('puts the last touched first, the undated last, each once', () => {
    const rows = [
      { id: 'a', touched_at: '2026-10-01T00:00:00Z' },
      { id: 'b', touched_at: null },
      { id: 'c', touched_at: '2026-11-01T00:00:00Z' },
      { id: 'a', touched_at: '2026-10-01T00:00:00Z' },
    ];
    expect(byLastTouched(rows).map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('mergeCallTargets', () => {
  it('drops the organization a person is alone in and named after (ADR-177 § 3)', () => {
    const persons = [{ ...base, house: 'laia puig', organization_id: 'o1' }];
    const orgs: CallTarget[] = [
      { ...base, kind: 'organization', id: 'o1', name: 'Laia Puig' },
      { ...base, kind: 'organization', id: 'o2', name: 'La Llotja' },
    ];
    const out = mergeCallTargets(persons, orgs);
    expect(out.organizations.map((o) => o.id)).toEqual(['o2']);
    expect(out.persons).toHaveLength(1);
    expect('organization_id' in out.persons[0]!).toBe(false);
  });
  it('keeps an organization when the person only works there', () => {
    const persons = [{ ...base, house: 'Teatre de la Llum', organization_id: 'o1' }];
    const orgs: CallTarget[] = [{ ...base, kind: 'organization', id: 'o1', name: 'Teatre de la Llum' }];
    expect(mergeCallTargets(persons, orgs).organizations).toHaveLength(1);
  });
});

describe('callTargetWho', () => {
  it('a person of outside: her house and city, round', () => {
    expect(callTargetWho({ ...base, title: 'programadora', house: 'Teatre de la Llum', city: 'Girona' }, 'es')).toEqual({
      shape: 'person',
      words: ['programadora de Teatre de la Llum', 'Girona'],
    });
    expect(callTargetWho({ ...base, house: 'Teatre de la Llum' }, 'es').words).toEqual(['Teatre de la Llum']);
  });
  it('a person who is her own house is «por libre»', () => {
    expect(callTargetWho({ ...base, house: 'Laia Puig', city: 'Lleida' }, 'es').words).toEqual(['por libre', 'Lleida']);
    expect(callTargetWho({ ...base, house: 'Cia X', org_kind: 'solo' }, 'es').words).toEqual(['por libre']);
  });
  it('an organization: its type and city, square', () => {
    expect(callTargetWho({ ...base, kind: 'organization', name: 'La Llotja', org_kind: 'theatre', city: 'Lleida' }, 'es')).toEqual({
      shape: 'organization',
      words: ['sala', 'Lleida'],
    });
  });
  it('someone of the team says so', () => {
    expect(callTargetWho({ ...base, team: true, house: 'X', city: 'Y' }, 'es')).toEqual({ shape: 'person', words: ['del equipo'] });
  });
});

describe('callTargetConversations', () => {
  const conv = (id: string, project_name: string | null) => ({ id, project_id: id, project_name, touched_at: null });
  it('counts and names the projects', () => {
    expect(callTargetConversations({ ...base, conversations: [conv('a', 'MaMeMi')] }, 'es')).toBe('1 conversación · MaMeMi');
    expect(callTargetConversations({ ...base, conversations: [conv('a', 'MaMeMi'), conv('b', 'Ona')] }, 'es')).toBe(
      '2 conversaciones · MaMeMi y Ona',
    );
  });
  it('says when there is none, and why the team is not here', () => {
    expect(callTargetConversations(base, 'es')).toBe('sin conversación');
    expect(callTargetConversations({ ...base, team: true }, 'es')).toMatch(/grupo del bolo/);
  });
});

describe('when the call was', () => {
  const now = new Date(2026, 10, 5, 11, 24);
  it('untouched sends nothing: the server stamps now', () => {
    expect(callOccurredAt({ day: '2026-11-05', time: '11:24', edited: false })).toBeUndefined();
    expect(callInFuture({ day: '2026-11-09', time: '23:00', edited: false }, now)).toBe(false);
  });
  it('changed sends that day at that time, in the viewer’s zone', () => {
    expect(callOccurredAt({ day: '2026-11-04', time: '18:30', edited: true })).toBe(new Date(2026, 10, 4, 18, 30).toISOString());
  });
  it('a time not come yet is refused', () => {
    expect(callInFuture({ day: '2026-11-05', time: '12:00', edited: true }, now)).toBe(true);
    expect(callInFuture({ day: '2026-11-06', time: '08:00', edited: true }, now)).toBe(true);
    expect(callInFuture({ day: '2026-11-05', time: '11:00', edited: true }, now)).toBe(false);
  });
  it('localTime is HH:MM', () => {
    expect(localTime(new Date(2026, 0, 1, 9, 5))).toBe('09:05');
  });
});

describe('callEvent', () => {
  it('is the composer’s call: kind, direction, trimmed note', () => {
    expect(callEvent({ direction: 'inbound', note: '  pide dossier ', day: '2026-11-05', time: '11:24', edited: false })).toEqual({
      kind: 'call',
      direction: 'inbound',
      body: 'pide dossier',
    });
    expect(callEvent({ direction: 'outbound', note: ' ', day: '2026-11-04', time: '10:00', edited: true })).toEqual({
      kind: 'call',
      direction: 'outbound',
      body: null,
      occurred_at: new Date(2026, 10, 4, 10, 0).toISOString(),
    });
  });
});

describe('contactEvent: one form for the two doors (tarea 134)', () => {
  const now = new Date(2026, 10, 5, 11, 24);
  it('starts as what is logged most: a call I made, now', () => {
    expect(freshContactLog('call', now)).toEqual({
      kind: 'call',
      via: 'whatsapp',
      direction: 'outbound',
      day: '2026-11-05',
      time: '11:24',
      edited: false,
    });
  });
  it('a meeting or a note has no «who»; switching back keeps the last answer', () => {
    expect(hasWho('meeting')).toBe(false);
    expect(hasWho('note')).toBe(false);
    expect(hasWho('message')).toBe(true);
    const meeting = withKind({ ...freshContactLog('call', now), direction: 'inbound' }, 'meeting');
    expect(meeting.direction).toBe('');
    expect(withKind(meeting, 'call').direction).toBe('outbound');
    expect(withKind({ ...freshContactLog('call', now), direction: 'inbound' }, 'message').direction).toBe('inbound');
  });
  it('a message says its app; any other kind does not', () => {
    const log = { ...freshContactLog('message', now), via: 'telegram' as const };
    expect(contactEvent(log, ' ok ')).toEqual({ kind: 'message', via: 'telegram', direction: 'outbound', body: 'ok' });
    expect(contactEvent({ ...log, kind: 'email' }, '')).toEqual({ kind: 'email', direction: 'outbound', body: null });
  });
  it('a note sends no direction even if one was left; another day sends its instant', () => {
    const log = { ...freshContactLog('note', now), direction: 'inbound' as const, day: '2026-11-03', time: '09:00', edited: true };
    expect(contactEvent(log, 'x')).toEqual({
      kind: 'note',
      direction: null,
      body: 'x',
      occurred_at: new Date(2026, 10, 3, 9, 0).toISOString(),
    });
  });
});
