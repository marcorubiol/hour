import { describe, expect, it } from 'vitest';
import { channelName } from './channels';

describe('channelName', () => {
  const wsId = '11111111-1111-7111-8111-111111111111';
  const projId = '22222222-2222-7222-8222-222222222222';
  const showId = '33333333-3333-7333-8333-333333333333';

  it('formats workspace channel', () => {
    expect(channelName.workspace(wsId)).toBe(`workspace:${wsId}`);
  });

  it('formats workspace presence channel', () => {
    expect(channelName.workspacePresence(wsId)).toBe(`workspace:${wsId}:presence`);
  });

  it('formats project channel', () => {
    expect(channelName.project(projId)).toBe(`project:${projId}`);
  });

  it('formats show channel', () => {
    expect(channelName.show(showId)).toBe(`show:${showId}`);
  });

  it('keeps prefixes distinct so subscribers can route by namespace', () => {
    const names = [
      channelName.workspace(wsId),
      channelName.workspacePresence(wsId),
      channelName.project(projId),
      channelName.show(showId),
    ];
    expect(new Set(names).size).toBe(4);
  });
});
