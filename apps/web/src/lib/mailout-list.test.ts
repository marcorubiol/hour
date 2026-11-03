import { describe, expect, it } from 'vitest';
import { kindOfType, mailoutLeft, parseMailoutType } from './mailout-list';

describe('la vista Envíos (ADR-176)', () => {
  it('el tipo de la URL, y sin uno conocido, todos', () => {
    expect(parseMailoutType('difusion')).toBe('difusion');
    expect(parseMailoutType('invitaciones')).toBe('invitaciones');
    expect(parseMailoutType(null)).toBe('todos');
    expect(parseMailoutType('outreach')).toBe('todos');
    expect(kindOfType('difusion')).toBe('outreach');
    expect(kindOfType('invitaciones')).toBe('invitation');
    expect(kindOfType('todos')).toBeNull();
  });
  it('sólo lo que salió tiene cifras: un borrador no', () => {
    expect(mailoutLeft('draft')).toBe(false);
    expect(mailoutLeft('review')).toBe(false);
    for (const s of ['queued', 'sending', 'paused', 'done']) expect(mailoutLeft(s)).toBe(true);
  });
});
