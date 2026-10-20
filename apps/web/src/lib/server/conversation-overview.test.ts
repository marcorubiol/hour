import { describe, expect, it } from 'vitest';
import { taggedIdsSearch } from './conversation-overview';

describe('taggedIdsSearch', () => {
  it('selects every column it orders by (PostgREST 42703 on rpc/conversation_search)', () => {
    const search = taggedIdsSearch(new URLSearchParams({ p_q: 'sala' }), 0);
    const selected = search.get('select')!.split(',').map((c) => c.split(':')[0]);
    const ordered = search.get('order')!.split(',').map((o) => o.split('.')[0]);
    for (const col of ordered) expect(selected).toContain(col);
  });

  it('keeps the base filters and pages by offset', () => {
    const search = taggedIdsSearch(new URLSearchParams({ p_q: 'sala', deleted_at: 'is.null' }), 1000);
    expect(search.get('p_q')).toBe('sala');
    expect(search.get('deleted_at')).toBe('is.null');
    expect(search.get('offset')).toBe('1000');
  });
});
