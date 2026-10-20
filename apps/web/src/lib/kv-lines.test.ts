import { describe, expect, it } from 'vitest';
import { KV_LINES_MAX, kvAdd, kvObject, kvRemove, kvSet } from './kv-lines';

describe('kv-lines: logistics, hospitality and technical, a line at a time', () => {
  it('an empty column is an empty object; an array or a scalar is read, not edited', () => {
    expect(kvObject({})).toEqual({});
    expect(kvObject(null)).toEqual({});
    expect(kvObject({ parking: 'sí' })).toEqual({ parking: 'sí' });
    expect(kvObject([1, 2])).toBeNull();
    expect(kvObject('texto')).toBeNull();
  });

  it('editing a value writes the whole object, and nothing when nothing changed', () => {
    const obj = { parking: 'sí', carga: 'muelle' };
    expect(kvSet(obj, 'parking', '  no  ')).toEqual({ parking: 'no', carga: 'muelle' });
    expect(kvSet(obj, 'parking', 'sí')).toBeNull();
    expect(kvSet({ plazas: 2 }, 'plazas', '2')).toBeNull();
  });

  it('removing a line keeps the others, nested ones included', () => {
    const obj = { parking: 'sí', rider: { luz: 'dmx' } };
    expect(kvRemove(obj, 'parking')).toEqual({ rider: { luz: 'dmx' } });
    expect(obj).toEqual({ parking: 'sí', rider: { luz: 'dmx' } });
  });

  it('a new line needs a key that is not already there', () => {
    expect(kvAdd({}, '  hotel ', ' Ibis ')).toEqual({ ok: true, key: 'hotel', next: { hotel: 'Ibis' } });
    expect(kvAdd({}, '  ', 'x')).toEqual({ ok: false, error: 'key_required' });
    expect(kvAdd({ hotel: 'Ibis' }, 'hotel', 'x')).toEqual({ ok: false, error: 'duplicate' });
    const full = Object.fromEntries(Array.from({ length: KV_LINES_MAX }, (_, i) => [`k${i}`, '']));
    expect(kvAdd(full, 'one more', '')).toEqual({ ok: false, error: 'too_many' });
  });
});
