/**
 * El buzón sincronizado (ADR-099) sin red: cifrado, parsing de Gmail,
 * emparejado, consultas por dirección y la sincronización entera contra un
 * Gmail simulado (fetch falso) y una base en memoria.
 */

import { describe, expect, test } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  importMailKey,
  openJson,
  pkcePair,
  refreshTokenAad,
  sealJson,
  toBase64Url,
} from './crypto';
import {
  buildAddressQueries,
  parseMessageIds,
  buildRawMessage,
  decodeMimeWords,
  googleAdapter,
  googleAuthUrl,
  hasRequiredScopes,
  isAutoReply,
  parseAddressList,
  parseGmailMessage,
  ProviderAuthError,
  trimQuoted,
  type GmailRawMessage,
} from './gmail';
import { matchMessage, oldestFirst } from './provider';
import { syncAccount } from './sync';
import type { IngestPayload, MailAccountRow, MailDb } from './db';
import { displayWebsite, effectiveSignature, proposedSignature, withSignature, type SignatureParts } from '../../mail';

const KEY_B64 = toBase64Url(new Uint8Array(32).map((_, i) => i + 1));
const b64url = (s: string) => toBase64Url(new TextEncoder().encode(s));

// ── Cifrado ───────────────────────────────────────────────────────────────

describe('crypto', () => {
  test('round trip with the same AAD', async () => {
    const key = await importMailKey(KEY_B64);
    const aad = refreshTokenAad('ws-1', 'Anouk@Example.test');
    const sealed = await encryptSecret(key, '1//refresh-token', aad);
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain('refresh');
    expect(await decryptSecret(key, sealed, refreshTokenAad('ws-1', 'anouk@example.test'))).toBe(
      '1//refresh-token',
    );
  });

  test('a ciphertext moved to another mailbox or workspace does not open', async () => {
    const key = await importMailKey(KEY_B64);
    const sealed = await encryptSecret(key, 'secret', refreshTokenAad('ws-1', 'a@x.test'));
    await expect(decryptSecret(key, sealed, refreshTokenAad('ws-2', 'a@x.test'))).rejects.toThrow();
    await expect(decryptSecret(key, sealed, refreshTokenAad('ws-1', 'b@x.test'))).rejects.toThrow();
  });

  test('tampering and a different key fail', async () => {
    const key = await importMailKey(KEY_B64);
    const other = await importMailKey(toBase64Url(new Uint8Array(32).fill(9)));
    const sealed = await encryptSecret(key, 'secret', 'aad');
    const [v, iv, ct] = sealed.split('.');
    const flipped = `${v}.${iv}.${ct.slice(0, -2)}${ct.slice(-2) === 'AA' ? 'AB' : 'AA'}`;
    await expect(decryptSecret(key, flipped, 'aad')).rejects.toThrow();
    await expect(decryptSecret(other, sealed, 'aad')).rejects.toThrow();
    await expect(decryptSecret(key, 'v2.' + iv + '.' + ct, 'aad')).rejects.toThrow();
  });

  test('a standard base64 key (openssl rand -base64 32) works', async () => {
    const std = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => 250 - i)));
    expect(std).toMatch(/[+/=]/);
    const key = await importMailKey(std);
    expect(await decryptSecret(key, await encryptSecret(key, 'x', 'a'), 'a')).toBe('x');
  });

  test('the key must be 32 bytes and present', async () => {
    await expect(importMailKey(undefined)).rejects.toThrow(/not set/);
    await expect(importMailKey(toBase64Url(new Uint8Array(16)))).rejects.toThrow(/32 bytes/);
  });

  test('sealed flow state opens only for its purpose', async () => {
    const key = await importMailKey(KEY_B64);
    const sealed = await sealJson(key, { n: 'state', e: 1 }, 'oauth-flow');
    expect(await openJson(key, sealed, 'oauth-flow')).toEqual({ n: 'state', e: 1 });
    expect(await openJson(key, sealed, 'other')).toBeNull();
    expect(await openJson(key, 'garbage', 'oauth-flow')).toBeNull();
  });

  test('PKCE challenge is the S256 of the verifier', async () => {
    const { verifier, challenge } = await pkcePair();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    expect(challenge).toBe(toBase64Url(new Uint8Array(digest)));
  });
});

// ── OAuth ─────────────────────────────────────────────────────────────────

describe('google oauth', () => {
  test('auth url asks offline access with only readonly + send, and PKCE', () => {
    const u = new URL(
      googleAuthUrl({ clientId: 'cid', redirectUri: 'http://localhost:5173/cb', state: 's', codeChallenge: 'c' }),
    );
    expect(u.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
    );
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')).toBe('s');
  });

  test('both scopes must be granted', () => {
    expect(
      hasRequiredScopes(
        'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly',
      ),
    ).toBe(true);
    expect(hasRequiredScopes('https://www.googleapis.com/auth/gmail.send')).toBe(false);
    expect(hasRequiredScopes(undefined)).toBe(false);
  });
});

// ── Parsing ───────────────────────────────────────────────────────────────

describe('gmail parsing', () => {
  test('address lists: names, quotes with commas, case', () => {
    expect(parseAddressList('"Valcárcel, Inés" <Ines@Pradillo.test>, otro@sala.test')).toEqual([
      'ines@pradillo.test',
      'otro@sala.test',
    ]);
    expect(parseAddressList('Anouk <anouk@muk.test>')).toEqual(['anouk@muk.test']);
    expect(parseAddressList(null)).toEqual([]);
    expect(parseAddressList('undisclosed-recipients:;')).toEqual([]);
  });

  test('RFC 2047 encoded words, B and Q, adjacent words joined', () => {
    expect(decodeMimeWords('=?UTF-8?B?UHJvcHVlc3RhIGRlIE1hTWVNaQ==?=')).toBe('Propuesta de MaMeMi');
    expect(decodeMimeWords('=?utf-8?Q?Gira_26/27_=C2=B7_Pradillo?=')).toBe('Gira 26/27 · Pradillo');
    expect(decodeMimeWords('=?UTF-8?Q?a?= =?UTF-8?Q?b?=')).toBe('ab');
    expect(decodeMimeWords('Plain')).toBe('Plain');
  });

  test('cuts the quoted previous message', () => {
    expect(trimQuoted('Perfecto, gracias.\n\nEl lun, 6 oct 2026 a las 10:00, Anouk escribió:\n> Hola')).toBe(
      'Perfecto, gracias.',
    );
    expect(trimQuoted('Thanks!\nOn Mon, Oct 6, 2026 Anouk wrote:\n> hi')).toBe('Thanks!');
    expect(trimQuoted('Una línea\n> citado')).toBe('Una línea');
    expect(trimQuoted('Sin cita\nDe: lunes a viernes')).toBe('Sin cita\nDe: lunes a viernes');
  });

  const multipart: GmailRawMessage = {
    id: 'm1',
    threadId: 't1',
    internalDate: String(Date.parse('2026-10-07T09:30:00Z')),
    labelIds: ['INBOX'],
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'Inés <ines@pradillo.test>' },
        { name: 'To', value: 'anouk@muk.test' },
        { name: 'Cc', value: 'difusion@muk.test' },
        { name: 'Subject', value: '=?UTF-8?B?UmU6IFByb3B1ZXN0YQ==?=' },
        { name: 'Message-ID', value: '<abc@pradillo.test>' },
      ],
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: b64url('Nos interesa.\n\n> antes') } },
            { mimeType: 'text/html', body: { data: b64url('<p>Nos interesa.</p>') } },
          ],
        },
        { mimeType: 'text/plain', filename: 'rider.txt', body: { attachmentId: 'x' } },
      ],
    },
  };

  test('a multipart message: headers, plain body, quote trimmed, date', () => {
    const m = parseGmailMessage(multipart);
    expect(m).toMatchObject({
      providerMessageId: 'm1',
      providerThreadId: 't1',
      rfcMessageId: '<abc@pradillo.test>',
      subject: 'Re: Propuesta',
      from: ['ines@pradillo.test'],
      to: ['anouk@muk.test'],
      cc: ['difusion@muk.test'],
      body: 'Nos interesa.',
      occurredAt: '2026-10-07T09:30:00.000Z',
      isDraft: false,
      auto: false,
    });
  });

  test('an automatic reply is flagged, a plain one is not (ADR-126 § 3)', () => {
    const get = (h: Record<string, string>) => (name: string) => h[name] ?? null;
    expect(isAutoReply(get({ 'Auto-Submitted': 'auto-replied' }))).toBe(true);
    expect(isAutoReply(get({ 'Auto-Submitted': 'no' }))).toBe(false);
    expect(isAutoReply(get({ 'X-Autoreply': 'yes' }))).toBe(true);
    expect(isAutoReply(get({ Precedence: 'auto_reply' }))).toBe(true);
    expect(isAutoReply(get({ Precedence: 'bulk' }))).toBe(false);
    expect(isAutoReply(get({}))).toBe(false);
  });

  test('html only falls back to text; drafts are flagged', () => {
    const m = parseGmailMessage({
      id: 'm2',
      labelIds: ['DRAFT'],
      payload: {
        mimeType: 'text/html',
        headers: [{ name: 'From', value: 'a@b.test' }],
        body: { data: b64url('<style>x{}</style><div>Hola&nbsp;<b>Inés</b></div><br>Adiós') },
      },
    });
    expect(m.body).toBe('Hola Inés\n\nAdiós');
    expect(m.isDraft).toBe(true);
  });
});

// ── Emparejado ────────────────────────────────────────────────────────────

describe('matching (ADR-099 point 3)', () => {
  const contacts = new Set(['ines@pradillo.test', 'prog@nau.test']);
  const base = { isDraft: false, cc: [] as string[] };

  test('sent by the mailbox: outbound, counterparts are the known recipients', () => {
    expect(
      matchMessage(
        { ...base, from: ['anouk@muk.test'], to: ['ines@pradillo.test', 'stranger@x.test'], cc: ['prog@nau.test'] },
        'Anouk@Muk.test',
        contacts,
      ),
    ).toEqual({ direction: 'outbound', counterparts: ['ines@pradillo.test', 'prog@nau.test'] });
  });

  test('received from a contact: inbound', () => {
    expect(matchMessage({ ...base, from: ['ines@pradillo.test'], to: ['anouk@muk.test'] }, 'anouk@muk.test', contacts)).toEqual({
      direction: 'inbound',
      counterparts: ['ines@pradillo.test'],
    });
  });

  test('a stranger who copies a contact does not enter', () => {
    expect(
      matchMessage({ ...base, from: ['stranger@x.test'], to: ['anouk@muk.test'], cc: ['ines@pradillo.test'] }, 'anouk@muk.test', contacts),
    ).toBeNull();
  });

  test('no contact, or a draft: nothing', () => {
    expect(matchMessage({ ...base, from: ['x@y.test'], to: ['anouk@muk.test'] }, 'anouk@muk.test', contacts)).toBeNull();
    expect(
      matchMessage({ isDraft: true, from: ['anouk@muk.test'], to: ['ines@pradillo.test'], cc: [] }, 'anouk@muk.test', contacts),
    ).toBeNull();
  });
});

describe('address queries (minimisation)', () => {
  test('one OR group per chunk, with after:, and only the given addresses', () => {
    const addrs = Array.from({ length: 16 }, (_, i) => `c${i}@x.test`);
    const qs = buildAddressQueries([...addrs, 'C0@X.test', 'bad address', 'x"@y'], 1_700_000_000);
    expect(qs).toHaveLength(2);
    expect(qs[0].startsWith('after:1700000000 {from:c0@x.test to:c0@x.test cc:c0@x.test ')).toBe(true);
    expect(qs[1]).toBe('after:1700000000 {from:c15@x.test to:c15@x.test cc:c15@x.test}');
    expect(qs.join(' ')).not.toContain('bad');
  });

  test('no addresses, no query', () => {
    expect(buildAddressQueries([], null)).toEqual([]);
  });
});

describe('signature', () => {
  test('Hour signature goes under the standard delimiter; none, nothing added', () => {
    expect(withSignature('Hola.\n\n', 'Anouk\nMüK Cia')).toBe('Hola.\n\n-- \nAnouk\nMüK Cia');
    expect(withSignature('Hola.', '  ')).toBe('Hola.');
    expect(withSignature('Hola.', null)).toBe('Hola.');
  });

  const parts: SignatureParts = {
    full_name: 'Anouk Martí',
    title: 'Distribució',
    company_name: 'MüK Cia',
    company_website: 'https://www.mukcia.com/',
    company_phone: '+34 600 000 000',
    signature: null,
    company_signature: null,
  };

  test('Hour proposes one per person and company, with what exists', () => {
    expect(proposedSignature(parts, 'personal')).toBe('Anouk Martí\nDistribució, MüK Cia\nmukcia.com · +34 600 000 000');
    expect(proposedSignature(parts, 'workspace')).toBe('MüK Cia\nmukcia.com · +34 600 000 000');
    const bare = { ...parts, title: null, company_website: null, company_phone: '  ' };
    expect(proposedSignature(bare, 'personal')).toBe('Anouk Martí\nMüK Cia');
    expect(proposedSignature(bare, 'workspace')).toBe('MüK Cia');
    expect(displayWebsite('http://example.org')).toBe('example.org');
  });

  test('the stored signature wins; empty or null falls back to the proposal', () => {
    expect(effectiveSignature({ ...parts, signature: 'Anouk' }, 'personal')).toBe('Anouk');
    expect(effectiveSignature({ ...parts, signature: '  ' }, 'personal')).toBe(proposedSignature(parts, 'personal'));
    // El buzón común firma con la de la compañía, nunca con la de quien envía.
    expect(effectiveSignature({ ...parts, signature: 'Anouk', company_signature: 'MüK' }, 'workspace')).toBe('MüK');
    expect(effectiveSignature({ ...parts, signature: 'Anouk' }, 'workspace')).toBe(proposedSignature(parts, 'workspace'));
  });
});

describe('outgoing message', () => {
  test('RFC 5322 with UTF-8 subject, threading headers and base64 body; no header injection', () => {
    const raw = buildRawMessage({
      from: 'anouk@muk.test',
      to: 'ines@pradillo.test',
      toName: 'Inés Valcárcel',
      subject: 'Re: Gira · Pradillo\r\nBcc: evil@x.test',
      body: 'Hola, Inés:\nTe paso el rider.',
      messageId: '<id@hour.test>',
      inReplyTo: '<abc@pradillo.test>',
      references: '<abc@pradillo.test>',
    });
    const text = new TextDecoder().decode(
      Uint8Array.from(atob(raw.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
    );
    const [head, body] = text.split('\r\n\r\n');
    expect(head).toContain('From: anouk@muk.test');
    expect(head).toContain('In-Reply-To: <abc@pradillo.test>');
    expect(head).not.toMatch(/^Bcc:/m);
    const subject = head.split('\r\n').find((l) => l.startsWith('Subject: '))!;
    expect(decodeMimeWords(subject.slice(9))).toBe('Re: Gira · Pradillo Bcc: evil@x.test');
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(body.replace(/\r\n/g, '')), (c) => c.charCodeAt(0)),
    );
    expect(decoded).toBe('Hola, Inés:\r\nTe paso el rider.');
  });
});

// ── Gmail simulado + base en memoria ──────────────────────────────────────

interface FakeGmail {
  messages: GmailRawMessage[];
  historyId: string;
  historyChanged: boolean;
  historyExpired: boolean;
  revoked: boolean;
  calls: string[];
}

function message(id: string, from: string, to: string, extra: Partial<GmailRawMessage> = {}): GmailRawMessage {
  return {
    id,
    threadId: `t-${id}`,
    internalDate: String(Date.parse('2026-10-07T09:00:00Z')),
    labelIds: ['INBOX'],
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: from },
        { name: 'To', value: to },
        { name: 'Subject', value: `Asunto ${id}` },
        { name: 'Message-ID', value: `<${id}@mail.test>` },
      ],
      body: { data: b64url(`Cuerpo ${id}`) },
    },
    ...extra,
  };
}

/** Un Gmail que entiende lo justo de `q`: las direcciones del grupo {…}. */
function fakeFetch(g: FakeGmail): typeof fetch {
  const respond = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    g.calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') {
      return g.revoked ? respond(400, { error: 'invalid_grant' }) : respond(200, { access_token: 'at' });
    }
    if (url.pathname.endsWith('/profile')) return respond(200, { emailAddress: 'anouk@muk.test', historyId: g.historyId });
    if (url.pathname.endsWith('/history')) {
      if (g.historyExpired) return respond(404, { error: { status: 'NOT_FOUND' } });
      return respond(200, {
        historyId: g.historyId,
        ...(g.historyChanged ? { history: [{ messagesAdded: [{ message: { id: 'x' } }] }] } : {}),
      });
    }
    if (url.pathname.endsWith('/messages')) {
      const q = url.searchParams.get('q') ?? '';
      const wanted = new Set([...q.matchAll(/(?:from|to|cc):(\S+?)(?=[\s}])/g)].map((m) => m[1]));
      const hits = g.messages.filter((m) =>
        parseAddressList(
          (m.payload?.headers ?? []).filter((h) => ['From', 'To', 'Cc'].includes(h.name)).map((h) => h.value).join(','),
        ).some((a) => wanted.has(a)),
      );
      const max = Number(url.searchParams.get('maxResults') ?? 100);
      const start = Number(url.searchParams.get('pageToken') ?? 0);
      const page = hits.slice(start, start + max);
      return respond(200, {
        messages: page.map((m) => ({ id: m.id, threadId: m.threadId })),
        ...(start + max < hits.length ? { nextPageToken: String(start + max) } : {}),
      });
    }
    const one = url.pathname.match(/\/messages\/([^/]+)$/);
    if (one) {
      const m = g.messages.find((x) => x.id === decodeURIComponent(one[1]));
      return m ? respond(200, m) : respond(404, { error: { status: 'NOT_FOUND' } });
    }
    return respond(500, { error: 'unexpected' });
  }) as typeof fetch;
}

/** La base en memoria, con la misma idempotencia que mail_ingest_message. */
function memoryDb(contacts: string[], backfilledFrom: string[] = []) {
  const processed = new Set<string>();
  const backfilled = new Set<string>(backfilledFrom);
  const events: { ref: string; payload: IngestPayload }[] = [];
  const finishes: Parameters<MailDb['finish']>[1][] = [];
  const db: MailDb = {
    claim: async () => [],
    account: async () => null,
    contactAddresses: async () => contacts.map((address) => ({ address, backfilled: backfilled.has(address) })),
    markBackfilled: async (_a, addresses) => {
      for (const a of addresses) backfilled.add(a);
    },
    knownMessages: async (_a, ids) => ids.filter((id) => processed.has(id)),
    deferredReady: async () => [],
    ingest: async (_a, p) => {
      if (processed.has(p.provider_message_id)) return 0;
      processed.add(p.provider_message_id);
      let n = 0;
      for (const c of p.counterparts) {
        const ref = `mail:${p.rfc_message_id}#${c}`;
        if (contacts.includes(c) && !events.some((e) => e.ref === ref)) {
          events.push({ ref, payload: p });
          n++;
        }
      }
      return n;
    },
    finish: async (_a, r) => {
      finishes.push(r);
    },
  };
  return { db, processed, events, finishes, backfilled };
}

async function accountRow(over: Partial<MailAccountRow> = {}): Promise<MailAccountRow> {
  const key = await importMailKey(KEY_B64);
  return {
    id: 'acc-1',
    workspace_id: 'ws-1',
    scope: 'personal',
    owner_user_id: 'u-1',
    provider: 'google',
    address: 'anouk@muk.test',
    refresh_token_ciphertext: await encryptSecret(key, 'rt', refreshTokenAad('ws-1', 'anouk@muk.test')),
    token_key_version: 1,
    status: 'active',
    sync_cursor: null,
    sync_from: '2026-08-01T00:00:00Z',
    last_synced_at: null,
    ...over,
  };
}

function gmailWith(messages: GmailRawMessage[]): FakeGmail {
  return { messages, historyId: '500', historyChanged: true, historyExpired: false, revoked: false, calls: [] };
}

const INBOX = () => [
  message('in1', 'Inés <ines@pradillo.test>', 'anouk@muk.test'),
  message('out1', 'anouk@muk.test', 'ines@pradillo.test'),
  message('priv', 'amiga@personal.test', 'anouk@muk.test'),
  message('news', 'newsletter@shop.test', 'anouk@muk.test'),
];

describe('sync', () => {
  test('first pass: only contact mail is listed and downloaded, then registered both ways', async () => {
    const g = gmailWith(INBOX());
    const mem = memoryDb(['ines@pradillo.test']);
    const key = await importMailKey(KEY_B64);
    const adapter = googleAdapter(fakeFetch(g), { clientId: 'c', clientSecret: 's' });
    const r = await syncAccount({ db: mem.db, adapter: () => adapter, key }, await accountRow());

    expect(r).toMatchObject({ status: 'active', fetched: 2, ingested: 2, complete: true, error: null });
    // Nunca se pidió un correo que no fuera de un contacto.
    const fetchedIds = g.calls.filter((c) => /\/messages\/[^/]+$/.test(c)).map((c) => c.split('/').pop());
    expect(fetchedIds.sort()).toEqual(['in1', 'out1']);
    // Mismo instante: el orden entre los dos no importa (se ingiere del más viejo al más nuevo).
    expect(mem.events.map((e) => [e.payload.provider_message_id, e.payload.direction]).sort()).toEqual([
      ['in1', 'inbound'],
      ['out1', 'outbound'],
    ]);
    expect(mem.events.find((e) => e.payload.provider_message_id === 'in1')!.payload).toMatchObject({ subject: 'Asunto in1', body: 'Cuerpo in1', rfc_message_id: '<in1@mail.test>' });
    // El cursor sale del perfil, tomado antes de buscar.
    expect(mem.finishes.at(-1)).toMatchObject({ cursor: '500', complete: true, status: 'active' });
  });

  test('second pass is idempotent: known ids are not downloaded again', async () => {
    const g = gmailWith(INBOX());
    const mem = memoryDb(['ines@pradillo.test']);
    const key = await importMailKey(KEY_B64);
    const adapter = googleAdapter(fakeFetch(g), { clientId: 'c', clientSecret: 's' });
    const deps = { db: mem.db, adapter: () => adapter, key };
    await syncAccount(deps, await accountRow());
    g.calls = [];
    const r = await syncAccount(
      deps,
      await accountRow({ sync_cursor: '500', last_synced_at: '2026-10-07T10:00:00Z' }),
    );
    expect(r).toMatchObject({ fetched: 0, ingested: 0, complete: true });
    expect(g.calls.some((c) => /\/messages\/[^/]+$/.test(c))).toBe(false);
    expect(mem.events).toHaveLength(2);
  });

  test('no change since the cursor: no search at all', async () => {
    const g = gmailWith(INBOX());
    g.historyChanged = false;
    g.historyId = '777';
    const mem = memoryDb(['ines@pradillo.test'], ['ines@pradillo.test']);
    const adapter = googleAdapter(fakeFetch(g), { clientId: 'c', clientSecret: 's' });
    const r = await syncAccount(
      { db: mem.db, adapter: () => adapter, key: await importMailKey(KEY_B64) },
      await accountRow({ sync_cursor: '500', last_synced_at: '2026-10-07T10:00:00Z' }),
    );
    expect(r.complete).toBe(true);
    expect(g.calls.some((c) => c.endsWith('/messages'))).toBe(false);
    expect(mem.finishes.at(-1)).toMatchObject({ cursor: '777', complete: true });
  });

  test('an expired cursor falls back to a fresh profile cursor and a search', async () => {
    const g = gmailWith(INBOX());
    g.historyExpired = true;
    g.historyId = '900';
    const mem = memoryDb(['ines@pradillo.test'], ['ines@pradillo.test']);
    const adapter = googleAdapter(fakeFetch(g), { clientId: 'c', clientSecret: 's' });
    const r = await syncAccount(
      { db: mem.db, adapter: () => adapter, key: await importMailKey(KEY_B64) },
      await accountRow({ sync_cursor: '1', last_synced_at: '2026-10-01T10:00:00Z' }),
    );
    expect(r).toMatchObject({ ingested: 2, complete: true });
    expect(mem.finishes.at(-1)).toMatchObject({ cursor: '900' });
  });

  test('a truncated incremental pass does not advance the cursor, and the next one finishes the job', async () => {
    const many = Array.from({ length: 5 }, (_, i) => message(`m${i}`, 'ines@pradillo.test', 'anouk@muk.test'));
    const g = gmailWith(many);
    const mem = memoryDb(['ines@pradillo.test'], ['ines@pradillo.test']);
    const adapter = googleAdapter(fakeFetch(g), { clientId: 'c', clientSecret: 's' });
    const deps = { db: mem.db, adapter: () => adapter, key: await importMailKey(KEY_B64), maxMessages: 3 };
    const row = { sync_cursor: '400', last_synced_at: '2026-10-07T08:00:00Z' };
    const first = await syncAccount(deps, await accountRow(row));
    expect(first).toMatchObject({ ingested: 3, complete: false });
    expect(mem.finishes.at(-1)).toMatchObject({ complete: false });
    const second = await syncAccount(deps, await accountRow(row));
    // La segunda lista otra vez, salta las tres conocidas y baja las otras dos.
    expect(mem.events).toHaveLength(5);
    expect(second).toMatchObject({ fetched: 2, complete: true });
  });

  test('a truncated backfill leaves the contact pending until it finishes', async () => {
    const many = Array.from({ length: 5 }, (_, i) => message(`m${i}`, 'ines@pradillo.test', 'anouk@muk.test'));
    const g = gmailWith(many);
    const mem = memoryDb(['ines@pradillo.test']);
    const adapter = googleAdapter(fakeFetch(g), { clientId: 'c', clientSecret: 's' });
    const deps = { db: mem.db, adapter: () => adapter, key: await importMailKey(KEY_B64), maxMessages: 3 };
    await syncAccount(deps, await accountRow());
    expect(mem.backfilled.size).toBe(0);
    await syncAccount(deps, await accountRow({ sync_cursor: '500', last_synced_at: '2026-10-07T10:00:00Z' }));
    expect(mem.events).toHaveLength(5);
    expect(mem.backfilled.has('ines@pradillo.test')).toBe(true);
  });

  test('a contact copied by a stranger is marked processed without subject or body', async () => {
    const g = gmailWith([message('cc1', 'stranger@x.test', 'anouk@muk.test, ines@pradillo.test')]);
    const ingested: IngestPayload[] = [];
    const mem = memoryDb(['ines@pradillo.test']);
    const db: MailDb = { ...mem.db, ingest: async (a, p) => (ingested.push(p), mem.db.ingest(a, p)) };
    const adapter = googleAdapter(fakeFetch(g), { clientId: 'c', clientSecret: 's' });
    const r = await syncAccount({ db, adapter: () => adapter, key: await importMailKey(KEY_B64) }, await accountRow());
    expect(r.ingested).toBe(0);
    expect(ingested[0]).toMatchObject({ counterparts: [], subject: null, body: null, to: [], from: '' });
  });

  test('no contacts: nothing is asked to Gmail beyond the cursor', async () => {
    const g = gmailWith(INBOX());
    const mem = memoryDb([]);
    const adapter = googleAdapter(fakeFetch(g), { clientId: 'c', clientSecret: 's' });
    await syncAccount({ db: mem.db, adapter: () => adapter, key: await importMailKey(KEY_B64) }, await accountRow());
    expect(g.calls.some((c) => c.includes('/messages'))).toBe(false);
  });

  test('first pass brings 12 months per contact and marks them; a contact added later gets its 12 months too', async () => {
    const g = gmailWith([
      message('a1', 'ines@pradillo.test', 'anouk@muk.test'),
      message('b1', 'prog@nau.test', 'anouk@muk.test'),
    ]);
    const contacts = ['ines@pradillo.test'];
    const mem = memoryDb(contacts);
    const adapter = googleAdapter(fakeFetch(g), { clientId: 'c', clientSecret: 's' });
    const now = Date.parse('2026-10-11T12:00:00Z');
    const deps = { db: mem.db, adapter: () => adapter, key: await importMailKey(KEY_B64), now: () => now };
    const seen: string[] = [];
    const spy = fakeFetch(g);
    const spying: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input instanceof Request ? input.url : input));
      if (u.pathname.endsWith('/messages')) seen.push(u.searchParams.get('q') ?? '');
      return spy(input, init);
    }) as typeof fetch;
    const spyAdapter = googleAdapter(spying, { clientId: 'c', clientSecret: 's' });
    await syncAccount({ ...deps, adapter: () => spyAdapter }, await accountRow());
    const yearAgo = Math.floor((now - 365 * 86_400_000) / 1000);
    expect(seen[0]).toBe(`after:${yearAgo} {from:ines@pradillo.test to:ines@pradillo.test cc:ines@pradillo.test}`);
    expect([...mem.backfilled]).toEqual(['ines@pradillo.test']);
    expect(mem.events.map((e) => e.payload.provider_message_id)).toEqual(['a1']);

    // Entra un contacto nuevo: la siguiente pasada trae sus 12 meses aunque no haya historia nueva.
    contacts.push('prog@nau.test');
    g.historyChanged = false;
    seen.length = 0;
    await syncAccount(
      { ...deps, adapter: () => spyAdapter },
      await accountRow({ sync_cursor: '500', last_synced_at: '2026-10-11T11:00:00Z' }),
    );
    expect(seen).toEqual([`after:${yearAgo} {from:prog@nau.test to:prog@nau.test cc:prog@nau.test}`]);
    expect(mem.events.map((e) => e.payload.provider_message_id)).toEqual(['a1', 'b1']);
    expect(mem.backfilled.has('prog@nau.test')).toBe(true);
  });

  test('a revoked grant marks the mailbox revoked', async () => {
    const g = gmailWith(INBOX());
    g.revoked = true;
    const mem = memoryDb(['ines@pradillo.test']);
    const adapter = googleAdapter(fakeFetch(g), { clientId: 'c', clientSecret: 's' });
    const r = await syncAccount({ db: mem.db, adapter: () => adapter, key: await importMailKey(KEY_B64) }, await accountRow());
    expect(r.status).toBe('revoked');
    expect(mem.finishes.at(-1)).toMatchObject({ status: 'revoked', complete: false });
  });

  test('a ciphertext that does not open is an error, without calling Google', async () => {
    const g = gmailWith(INBOX());
    const mem = memoryDb(['ines@pradillo.test']);
    const adapter = googleAdapter(fakeFetch(g), { clientId: 'c', clientSecret: 's' });
    const r = await syncAccount(
      { db: mem.db, adapter: () => adapter, key: await importMailKey(KEY_B64) },
      await accountRow({ workspace_id: 'ws-other' }),
    );
    expect(r).toMatchObject({ status: 'error', error: 'token_unreadable' });
    expect(g.calls).toHaveLength(0);
  });

  test('refresh with invalid_grant throws ProviderAuthError', async () => {
    const g = gmailWith([]);
    g.revoked = true;
    const adapter = googleAdapter(fakeFetch(g), { clientId: 'c', clientSecret: 's' });
    await expect(adapter.accessToken('rt')).rejects.toBeInstanceOf(ProviderAuthError);
  });
});

describe('GmailClient on a Worker', () => {
  test('calls fetch detached: a Worker throws «Illegal invocation» when fetch runs as a method', async () => {
    function strictFetch(this: unknown, _url: string | URL | Request, _init?: RequestInit): Promise<Response> {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(
        new Response(JSON.stringify({ emailAddress: 'Marco@Example.com', historyId: '42' }), { status: 200 }),
      );
    }
    const adapter = googleAdapter(strictFetch as typeof fetch, { clientId: 'c', clientSecret: 's' });
    await expect(adapter.profile('tok')).resolves.toEqual({ address: 'marco@example.com', cursor: '42' });
  });
});

describe('thread rule (ADR-102, añadido, punto 4)', () => {
  test('In-Reply-To and References are read with their angle brackets, in order', () => {
    expect(parseMessageIds('<a@x.test>')).toEqual(['<a@x.test>']);
    expect(parseMessageIds(' <a@x.test>\r\n <b@y.test> <c@z.test>')).toEqual(['<a@x.test>', '<b@y.test>', '<c@z.test>']);
    expect(parseMessageIds('')).toEqual([]);
    expect(parseMessageIds(null)).toEqual([]);
    expect(parseMessageIds('not an id')).toEqual([]);
  });

  test('oldest first, stable for equal or unreadable dates', () => {
    const m = (id: string, occurredAt: string) => ({ id, occurredAt });
    const sorted = oldestFirst([
      m('c', '2026-10-09T10:00:00Z'),
      m('a', '2026-10-07T10:00:00Z'),
      m('x', 'nope'),
      m('b', '2026-10-07T10:00:00Z'),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(['x', 'a', 'b', 'c']);
  });

  test('a pass registers the thread from its first message, and sends the reply headers', async () => {
    const at = (iso: string) => String(Date.parse(iso));
    const first = message('q1', 'Inés <ines@pradillo.test>', 'anouk@muk.test', {
      threadId: 't-1',
      internalDate: at('2026-10-01T09:00:00Z'),
    });
    const reply = message('q2', 'Inés <ines@pradillo.test>', 'anouk@muk.test', {
      threadId: 't-1',
      internalDate: at('2026-10-05T09:00:00Z'),
    });
    reply.payload!.headers!.push(
      { name: 'In-Reply-To', value: '<q1@mail.test>' },
      { name: 'References', value: '<q0@mail.test> <q1@mail.test>' },
    );
    // Gmail lists the newest first.
    const g = gmailWith([reply, first]);
    const mem = memoryDb(['ines@pradillo.test']);
    const key = await importMailKey(KEY_B64);
    const adapter = googleAdapter(fakeFetch(g), { clientId: 'c', clientSecret: 's' });
    await syncAccount({ db: mem.db, adapter: () => adapter, key }, await accountRow());

    expect(mem.events.map((e) => e.payload.provider_message_id)).toEqual(['q1', 'q2']);
    const sent = mem.events[1]!.payload;
    expect(sent.in_reply_to).toBe('<q1@mail.test>');
    expect(sent.references).toEqual(['<q0@mail.test>', '<q1@mail.test>']);
    expect(mem.events[0]!.payload.in_reply_to).toBeNull();
  });

  test('an unmatched message carries no thread headers either', async () => {
    const stray = message('s1', 'newsletter@shop.test', 'anouk@muk.test');
    stray.payload!.headers!.push({ name: 'In-Reply-To', value: '<zz@mail.test>' });
    const g = gmailWith([stray, message('in1', 'Inés <ines@pradillo.test>', 'anouk@muk.test')]);
    const seen: IngestPayload[] = [];
    const mem = memoryDb(['ines@pradillo.test']);
    const ingest = mem.db.ingest;
    mem.db.ingest = async (a, p, c) => {
      seen.push(p);
      return ingest(a, p, c);
    };
    const key = await importMailKey(KEY_B64);
    const adapter = googleAdapter(fakeFetch(g), { clientId: 'c', clientSecret: 's' });
    await syncAccount({ db: mem.db, adapter: () => adapter, key }, await accountRow());
    for (const p of seen.filter((x) => x.counterparts.length === 0)) {
      expect(p.in_reply_to ?? null).toBeNull();
      expect(p.references ?? []).toEqual([]);
    }
  });
});

describe('a reply that arrives before its thread waits, it is not lost (ADR-102)', () => {
  test('deferred on the first pass, ingested once the original is in (from another mailbox)', async () => {
    const at = (iso: string) => String(Date.parse(iso));
    const reply = message('late', 'Inés <ines@pradillo.test>', 'anouk@muk.test', {
      threadId: 't-9',
      internalDate: at('2026-10-05T09:00:00Z'),
    });
    reply.payload!.headers!.push({ name: 'In-Reply-To', value: '<orig@mail.test>' });

    // Una base en memoria con la regla del hilo: sin el original, espera.
    const processed = new Map<string, { deferred: boolean; refs: string[] }>();
    const rfcIn = new Set<string>();
    const entered: string[] = [];
    const db: MailDb = {
      claim: async () => [],
      account: async () => null,
      contactAddresses: async () => [{ address: 'ines@pradillo.test', backfilled: true }],
      markBackfilled: async () => {},
      knownMessages: async (_a, ids) => ids.filter((id) => processed.has(id)),
      deferredReady: async () =>
        [...processed.entries()].filter(([, m]) => m.deferred && m.refs.some((r) => rfcIn.has(r))).map(([id]) => id),
      ingest: async (_a, p) => {
        const prev = processed.get(p.provider_message_id);
        if (prev && !prev.deferred) return 0;
        const refs = [p.in_reply_to, ...(p.references ?? [])].filter((x): x is string => Boolean(x));
        if (refs.length && !refs.some((r) => rfcIn.has(r))) {
          processed.set(p.provider_message_id, { deferred: true, refs });
          return 0;
        }
        processed.set(p.provider_message_id, { deferred: false, refs: [] });
        if (p.rfc_message_id) rfcIn.add(p.rfc_message_id);
        entered.push(p.provider_message_id);
        return 1;
      },
      finish: async () => {},
    };
    const g = gmailWith([reply]);
    const key = await importMailKey(KEY_B64);
    const adapter = googleAdapter(fakeFetch(g), { clientId: 'c', clientSecret: 's' });
    const row = await accountRow({ sync_cursor: '400', last_synced_at: '2026-10-06T00:00:00Z' });

    await syncAccount({ db, adapter: () => adapter, key }, row);
    expect(entered).toEqual([]);
    expect(processed.get('late')?.deferred).toBe(true);

    // El original entra por el buzón común.
    rfcIn.add('<orig@mail.test>');
    await syncAccount({ db, adapter: () => adapter, key }, row);
    expect(entered).toEqual(['late']);
    expect(processed.get('late')?.deferred).toBe(false);
  });
});
