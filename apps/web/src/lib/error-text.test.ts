import { describe, expect, it } from 'vitest';
import { readableError } from './error-text';
import { loadLocale, t } from '$lib/i18n';

describe('readableError', () => {
  it('says a dead network in the app language, whatever the browser called it', async () => {
    await loadLocale('es');
    for (const raw of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']) {
      expect(readableError(raw, 'es')).toBe(t('ui.no_connection', 'es'));
    }
  });
  it('says a bare server failure without its code', async () => {
    await loadLocale('es');
    expect(readableError('Error 500', 'es')).toBe(t('ui.failed', 'es'));
    expect(readableError('Internal Server Error', 'es')).toBe(t('ui.failed', 'es'));
  });
  it('leaves the caller’s own words alone', () => {
    expect(readableError('Ya existe una conversación con esa sala.', 'es')).toBe('Ya existe una conversación con esa sala.');
    expect(readableError('Error 409', 'es')).toBe('Error 409');
  });
});
