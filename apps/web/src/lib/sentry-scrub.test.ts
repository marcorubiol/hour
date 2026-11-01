import { describe, expect, test } from 'vitest';
import { scrubTransaction } from './sentry-scrub';

describe('a transaction carries timings, not who or what (ADR-158)', () => {
  test('the page URL becomes the route; span URLs lose queries, ids and slugs', () => {
    const event = scrubTransaction({
      transaction: '/h/[workspace]/project/[slug]',
      request: { url: 'https://hour.zerosense.studio/h/muk-cia/project/obra?x=1', query_string: 'x=1' },
      contexts: { trace: { data: { 'url.full': 'https://hour.zerosense.studio/h/muk-cia', 'lcp.url': '/u/x.png', 'sentry.op': 'pageload' } } },
      spans: [
        { op: 'http.client', description: 'GET /api/team?workspace_ids=019e0bb1-8541', data: { url: '/api/team?workspace_ids=019e0bb1', 'http.query': '?workspace_ids=019e' } },
        { op: 'http.client', description: 'GET https://hour.zerosense.studio/api/persons/anouk-xyz/notes/7' },
        { op: 'http.client', description: 'GET /api/conversations/overview' },
        { op: 'resource.script', description: 'https://hour.zerosense.studio/_app/immutable/chunks/Ab12.js' },
        { op: 'resource.link', description: 'https://fonts.googleapis.com/css2?family=Inter' },
        { op: 'navigation', description: '/h/muk-cia/project/obra' },
        { op: 'mark', description: 'sentry-tracing-init' },
      ],
    });
    expect(event.request).toEqual({ url: '/h/[workspace]/project/[slug]' });
    expect(event.spans!.map((s) => s.description)).toEqual([
      'GET /api/team',
      'GET /api/persons/*',
      'GET /api/conversations/*',
      '/_app/immutable/chunks/Ab12.js',
      '/*',
      '/h/[workspace]/project/[slug]',
      'sentry-tracing-init',
    ]);
    expect(event.spans![0].data).toEqual({});
    expect(event.contexts!.trace!.data).toEqual({ 'sentry.op': 'pageload' });
  });
});
