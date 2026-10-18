import { afterEach, describe, expect, test } from 'vitest';
import { currentTrade, setTrade, t, tradeOf } from './index';

afterEach(() => setTrade('stage'));

describe('t() and the trade (ADR-128)', () => {
  test('stage reads the plain key; music reads its variant', () => {
    expect(t('conversations.view_sales', 'es', undefined, 'stage')).toBe('Difusión');
    expect(t('conversations.view_sales', 'es', undefined, 'music')).toBe('Contratación');
    expect(t('perf.new_title', 'fr', undefined, 'music')).toBe('Nouveau concert');
  });

  test('a key with no variant speaks the same in every trade', () => {
    expect(t('desk.band_waiting', 'es', undefined, 'music')).toBe(t('desk.band_waiting', 'es', undefined, 'stage'));
  });

  test('the trade in context is the default, and setTrade moves it', () => {
    expect(currentTrade()).toBe('stage');
    expect(t('perf.cast', 'es')).toBe('Reparto');
    setTrade('music');
    expect(t('perf.cast', 'es')).toBe('Formación');
  });

  test('a variant interpolates like its key', () => {
    expect(t('perf.bolo_functions_other', 'es', { n: 3 }, 'music')).toBe('3 conciertos');
  });

  test('one trade for a screen: theirs when they agree, stage otherwise', () => {
    expect(tradeOf([])).toBe('stage');
    expect(tradeOf([{ trade: 'music' }, { trade: 'music' }])).toBe('music');
    expect(tradeOf([{ trade: 'music' }, { trade: 'stage' }])).toBe('stage');
    expect(tradeOf([{ trade: 'music' }, {}])).toBe('stage');
    expect(tradeOf([{ trade: 'comedy' }])).toBe('stage');
  });
});
