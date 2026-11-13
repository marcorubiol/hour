import { afterEach, describe, expect, test } from 'vitest';
import { currentTrade, setTrade, setWorkspaceTrades, t, tradeFor, tradeOf, voiceFor } from './index';

afterEach(() => {
  setTrade('stage');
  setWorkspaceTrades([]);
});

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

  test('one voice for a screen: their trade when they agree, mixed when not, stage with none', () => {
    expect(tradeOf([])).toBe('stage');
    expect(tradeOf([{ trade: 'music' }, { trade: 'music' }])).toBe('music');
    expect(tradeOf([{ trade: 'stage' }, {}])).toBe('stage');
    expect(tradeOf([{ trade: 'music' }, { trade: 'stage' }])).toBe('mixed');
    expect(tradeOf([{ trade: 'music' }, {}])).toBe('mixed');
    expect(tradeOf([{ trade: 'comedy' }])).toBe('stage');
  });
});

describe('the trade of one space (tarea 142)', () => {
  test('by id or by slug; stage for a space it does not know', () => {
    setWorkspaceTrades([
      { id: 'w-music', slug: 'banda', trade: 'music' },
      { id: 'w-stage', slug: 'cia', trade: 'stage' },
      { id: 'w-none', slug: 'old' },
    ]);
    expect(tradeFor('w-music')).toBe('music');
    expect(tradeFor('banda')).toBe('music');
    expect(tradeFor('cia')).toBe('stage');
    expect(tradeFor('w-none')).toBe('stage');
    expect(tradeFor('nobody')).toBe('stage');
    expect(tradeFor(null)).toBe('stage');
    expect(tradeFor(undefined)).toBe('stage');
  });

  test('a row speaks its space whatever the screen speaks', () => {
    setWorkspaceTrades([{ id: 'w-music', slug: 'banda', trade: 'music' }]);
    setTrade('mixed');
    expect(t('perf.cast', 'es', undefined, tradeFor('w-music'))).toBe('Formación');
  });

  test('a dialog speaks the space chosen inside, the screen until one is (142 D)', () => {
    setWorkspaceTrades([
      { id: 'w-music', slug: 'banda', trade: 'music' },
      { id: 'w-stage', slug: 'cia', trade: 'stage' },
    ]);
    setTrade('mixed');
    expect(voiceFor(null)).toBe('mixed');
    expect(voiceFor('')).toBe('mixed');
    expect(voiceFor('w-music')).toBe('music');
    expect(voiceFor('w-stage')).toBe('stage');
    expect(voiceFor([])).toBe('mixed');
    expect(voiceFor(['w-music', 'w-music'])).toBe('music');
    expect(voiceFor(['w-music', 'w-stage'])).toBe('mixed');
    setTrade('music');
    expect(voiceFor(undefined)).toBe('music');
    expect(voiceFor('w-stage')).toBe('stage');
  });
});

describe('t() with the mixed voice (tarea 142)', () => {
  test('without a @mixed variant it reads the plain key, as stage does', () => {
    expect(t('perf.cast', 'es', undefined, 'mixed')).toBe(t('perf.cast', 'es', undefined, 'stage'));
    setTrade('mixed');
    expect(t('perf.label', 'es')).toBe('Función');
  });

  test('the frame speaks the neutral word: both trades named, or the one they share', () => {
    setTrade('mixed');
    expect(t('conversations.view_sales', 'es')).toBe('Difusión y contratación');
    expect(t('picker.performances', 'es')).toBe('Funciones y conciertos');
    expect(t('hall.projects', 'es')).toBe('Proyectos');
    setTrade('stage');
    expect(t('conversations.view_sales', 'es')).toBe('Difusión');
    setTrade('music');
    expect(t('conversations.view_sales', 'es')).toBe('Contratación');
  });

  test('a @mixed variant wins; a locale without one keeps its own plain word', async () => {
    const esDict = (await import('./es.json')).default as Record<string, string>;
    const enDict = (await import('./en.json')).default as Record<string, string>;
    try {
      enDict['perf.cast@mixed'] = 'Line-up';
      expect(t('perf.cast', 'en', undefined, 'mixed')).toBe('Line-up');
      expect(t('perf.cast', 'es', undefined, 'mixed')).toBe('Reparto');
      esDict['perf.cast@mixed'] = 'Gente en escena';
      expect(t('perf.cast', 'es', undefined, 'mixed')).toBe('Gente en escena');
      expect(t('perf.cast', 'es', undefined, 'music')).toBe('Formación');
    } finally {
      delete esDict['perf.cast@mixed'];
      delete enDict['perf.cast@mixed'];
    }
  });
});
