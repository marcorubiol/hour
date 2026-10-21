/**
 * What reaches each dialog when ⌘K (or any door) opens it through the
 * creation store: the type, the title, the lane's project, and the day,
 * which only a page that shows days knows.
 */
import { describe, expect, it } from 'vitest';
import { CreationStore } from './creation.svelte';

describe('creation store: the quick add', () => {
  it('without a host the day is left to the dialog (today)', () => {
    const c = new CreationStore();
    c.openEvent({ type: 'rehearsal', title: 'Mercat' });
    expect(c.eventOpen).toBe(true);
    expect(c.event).toEqual({ type: 'rehearsal', title: 'Mercat', date: null });
  });

  it('a host lends its view day, read when the door opens', () => {
    const c = new CreationStore();
    let day = '2026-11-02';
    const release = c.hostEvents({ day: () => day, canUnavailable: true });
    day = '2026-11-14';
    c.openEvent({ type: 'performance' });
    expect(c.event.date).toBe('2026-11-14');
    release();
    c.openEvent({});
    expect(c.event.date).toBeNull();
  });

  it('a door that knows its day and project keeps them', () => {
    const c = new CreationStore();
    c.hostEvents({ day: () => '2026-11-02', canUnavailable: true });
    c.openEvent({ date: '2026-12-01', projectId: 'p1' });
    expect(c.event).toEqual({ date: '2026-12-01', projectId: 'p1' });
  });

  it('the host is read live, and a stale release does not drop a newer host', () => {
    const c = new CreationStore();
    let ok = false;
    const first = c.hostEvents({
      day: () => '2026-01-01',
      get canUnavailable() {
        return ok;
      },
    });
    expect(c.eventHost?.canUnavailable).toBe(false);
    ok = true;
    expect(c.eventHost?.canUnavailable).toBe(true);
    c.hostEvents({ day: () => '2026-02-02', canUnavailable: false });
    first();
    expect(c.eventHost?.day()).toBe('2026-02-02');
  });
});

describe('creation store: task and conversation', () => {
  it('the task takes the typed text as its title', () => {
    const c = new CreationStore();
    c.openTask({ title: '  Llamar a la sala ' });
    expect(c.taskOpen).toBe(true);
    expect(c.taskTitle).toBe('Llamar a la sala');
  });

  it('the conversation takes it as its organization, and a tag when given', () => {
    const c = new CreationStore();
    c.openConversation({ who: 'Teatre Lliure' });
    expect(c.conversationOpen).toBe(true);
    expect(c.conversationWho).toBe('Teatre Lliure');
    expect(c.conversationTag).toBeNull();
    c.openConversation({ tag: 'press' });
    expect(c.conversationWho).toBe('');
    expect(c.conversationTag).toBe('press');
  });
});
