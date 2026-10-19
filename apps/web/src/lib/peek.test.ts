import { describe, expect, it } from 'vitest';
import {
  PEEK_PARAM,
  formatPeek,
  fullHref,
  isLensPath,
  parsePeek,
  peekFromLink,
  peekHref,
  peekOpensFrom,
  samePeek,
  withPeek,
  type PeekTarget,
} from './peek';

const DATE = '0b6f3c1e-2a4d-4c8e-9f10-1a2b3c4d5e6f';
const PROJECT = '11111111-2222-4333-8444-555555555555';
const BOLO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ORIGIN = 'https://hour.test';

const url = (path: string) => new URL(path, ORIGIN);

describe('formatPeek / parsePeek', () => {
  const targets: PeekTarget[] = [
    { kind: 'date', id: DATE },
    { kind: 'bolo', projectId: PROJECT, id: BOLO },
    { kind: 'performance', ws: 'muk-cia', slug: 'girona-2026-11-14' },
    { kind: 'conversation', ws: 'muk-cia', slug: BOLO },
    { kind: 'person', ws: 'playwright', slug: 'laia-puig' },
  ];

  it('round-trips every kind', () => {
    for (const t of targets) expect(parsePeek(formatPeek(t))).toEqual(t);
  });

  it('spells each kind as a path the address bar can carry', () => {
    expect(formatPeek(targets[0]!)).toBe(`date/${DATE}`);
    expect(formatPeek(targets[1]!)).toBe(`bolo/${PROJECT}/${BOLO}`);
    expect(formatPeek(targets[2]!)).toBe('performance/muk-cia/girona-2026-11-14');
  });

  it('refuses what names nothing: no value, an unknown kind, a bad id, a missing part', () => {
    expect(parsePeek(null)).toBeNull();
    expect(parsePeek('')).toBeNull();
    expect(parsePeek(`show/${DATE}`)).toBeNull();
    expect(parsePeek('date/not-a-uuid')).toBeNull();
    expect(parsePeek(`bolo/${BOLO}`)).toBeNull();
    expect(parsePeek(`bolo/${PROJECT}/nope`)).toBeNull();
    expect(parsePeek('performance/muk-cia')).toBeNull();
    expect(parsePeek('performance/muk-cia/a/b')).toBeNull();
    expect(parsePeek(`date/${DATE}/extra`)).toBeNull();
  });

  it('reads an id in any case and keeps it lowercase', () => {
    expect(parsePeek(`date/${DATE.toUpperCase()}`)).toEqual({ kind: 'date', id: DATE });
  });

  it('compares by spelling', () => {
    expect(samePeek({ kind: 'date', id: DATE }, { kind: 'date', id: DATE })).toBe(true);
    expect(samePeek({ kind: 'date', id: DATE }, null)).toBe(false);
    expect(samePeek(null, null)).toBe(true);
  });
});

describe('withPeek / peekHref', () => {
  it('adds the peek and keeps what the lens had in the address', () => {
    const next = withPeek(url('/h/planner?view=month&ym=2026-11'), { kind: 'date', id: DATE });
    expect(next.searchParams.get('view')).toBe('month');
    expect(next.searchParams.get('ym')).toBe('2026-11');
    expect(parsePeek(next.searchParams.get(PEEK_PARAM))).toEqual({ kind: 'date', id: DATE });
  });

  it('takes it away again, leaving the rest and the hash', () => {
    const open = url(`/h/books?scope=p:${PROJECT}&peek=date/${DATE}#mny-ledger`);
    const closed = withPeek(open, null);
    expect(closed.searchParams.has(PEEK_PARAM)).toBe(false);
    expect(closed.searchParams.get('scope')).toBe(`p:${PROJECT}`);
    expect(closed.hash).toBe('#mny-ledger');
  });

  it('a link to a peek stays on the page it is drawn on', () => {
    const href = peekHref({ kind: 'date', id: DATE }, url('/h/desk'));
    expect(href.startsWith('/h/desk?')).toBe(true);
    expect(peekFromLink(url(href), url('/h/desk'))).toEqual({ kind: 'date', id: DATE });
  });
});

describe('fullHref', () => {
  it('a record opens its page, a bolo its row in Cuentas, a date nothing', () => {
    expect(fullHref({ kind: 'performance', ws: 'muk-cia', slug: 'g' })).toBe('/h/muk-cia/performance/g');
    expect(fullHref({ kind: 'conversation', ws: 'muk-cia', slug: 'c' })).toBe('/h/muk-cia/conversation/c');
    expect(fullHref({ kind: 'person', ws: 'muk-cia', slug: 'p' })).toBe('/h/muk-cia/person/p');
    expect(fullHref({ kind: 'bolo', projectId: PROJECT, id: BOLO })).toBe(`/h/books?scope=p:${PROJECT}#bolo-${BOLO}`);
    expect(fullHref({ kind: 'date', id: DATE })).toBeNull();
  });

  it("a bolo's full link is read back as the same bolo from outside Cuentas", () => {
    const href = fullHref({ kind: 'bolo', projectId: PROJECT, id: BOLO })!;
    expect(peekFromLink(url(href), url('/h/planner'))).toEqual({ kind: 'bolo', projectId: PROJECT, id: BOLO });
  });
});

describe('peekFromLink', () => {
  const lens = url('/h/planner?view=month');

  it("reads a record's page as its peek", () => {
    expect(peekFromLink(url('/h/muk-cia/performance/girona'), lens)).toEqual({
      kind: 'performance',
      ws: 'muk-cia',
      slug: 'girona',
    });
    expect(peekFromLink(url('/h/muk-cia/person/laia/'), lens)).toEqual({ kind: 'person', ws: 'muk-cia', slug: 'laia' });
    expect(peekFromLink(url(`/h/muk-cia/conversation/${BOLO}`), lens)).toEqual({
      kind: 'conversation',
      ws: 'muk-cia',
      slug: BOLO,
    });
  });

  it('a link to a block of a page goes to the page, where the block is', () => {
    expect(peekFromLink(url(`/h/muk-cia/conversation/${BOLO}#team`), lens)).toBeNull();
    expect(peekFromLink(url('/h/muk-cia/performance/girona#who-goes'), lens)).toBeNull();
  });

  it('leaves alone what is not a record: a road sheet, a project, Settings, another site', () => {
    expect(peekFromLink(url('/h/muk-cia/performance/girona/roadsheet'), lens)).toBeNull();
    expect(peekFromLink(url('/h/muk-cia/project/sirena/'), lens)).toBeNull();
    expect(peekFromLink(url('/h/muk-cia/settings'), lens)).toBeNull();
    expect(peekFromLink(new URL('https://elsewhere.test/h/muk-cia/performance/girona'), lens)).toBeNull();
  });

  it("reads Cuentas' bolo link (booksHref) as the bolo, but not from Cuentas itself", () => {
    const href = url(`/h/books?scope=p:${PROJECT}#bolo-${BOLO}`);
    expect(peekFromLink(href, lens)).toEqual({ kind: 'bolo', projectId: PROJECT, id: BOLO });
    expect(peekFromLink(href, url(`/h/books?scope=p:${PROJECT}`))).toBeNull();
    // A new deal is not a bolo to look at.
    expect(peekFromLink(url(`/h/books?scope=p:${PROJECT}&new_bolo=${PROJECT}`), lens)).toBeNull();
  });

  it('a ?peek= link on another page is that page, not a peek here', () => {
    expect(peekFromLink(url(`/h/desk?peek=date/${DATE}`), lens)).toBeNull();
    expect(peekFromLink(url(`/h/planner?peek=date/${DATE}`), lens)).toEqual({ kind: 'date', id: DATE });
  });
});

describe('peekOpensFrom', () => {
  const perf: PeekTarget = { kind: 'performance', ws: 'w', slug: 's' };
  const date: PeekTarget = { kind: 'date', id: DATE };
  const bolo: PeekTarget = { kind: 'bolo', projectId: PROJECT, id: BOLO };

  it('from every lens, a record opens in the vistazo', () => {
    for (const path of ['/h/desk', '/h/planner', '/h/conversations', '/h/books', '/h/muk-cia/planner', '/h/muk-cia/money']) {
      expect(isLensPath(path)).toBe(true);
      expect(peekOpensFrom(perf, path, false)).toBe(true);
    }
  });

  it("from a record's page, a page link stays a page; a date and a bolo still peek", () => {
    const page = '/h/muk-cia/performance/girona';
    expect(isLensPath(page)).toBe(false);
    expect(peekOpensFrom(perf, page, false)).toBe(false);
    expect(peekOpensFrom(date, page, false)).toBe(true);
    expect(peekOpensFrom(bolo, page, false)).toBe(true);
  });

  it('inside the panel, every link follows in the panel', () => {
    expect(peekOpensFrom(perf, '/h/muk-cia/project/sirena', true)).toBe(true);
  });
});
