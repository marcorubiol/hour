import { describe, expect, test, vi } from 'vitest';
import { MailoutDbError } from './db';
import type { DomainStatus } from './provider';
import { domainsToRecheck, recheckDomains, runDomainRecheck, type PendingDomainRow, type RecheckDeps } from './recheck';
import type { MailoutEnv } from './index';

const NOW = new Date('2026-11-01T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function row(over: Partial<PendingDomainRow> = {}): PendingDomainRow {
  return {
    id: 'd1',
    provider: 'ses',
    domain: 'mamemi.example',
    mail_from_subdomain: 'mail',
    tenant_name: null,
    configuration_set: null,
    dkim_status: 'PENDING',
    mail_from_status: 'PENDING',
    verified_at: null,
    created_at: hoursAgo(2),
    ...over,
  };
}

const OK: DomainStatus = { dkimStatus: 'SUCCESS', mailFromStatus: 'SUCCESS', records: [], dmarcRecord: null, error: null };

describe('domainsToRecheck (ADR-169)', () => {
  test('a pending domain from the last 72 h is checked', () => {
    expect(domainsToRecheck([row()], NOW).map((d) => d.id)).toEqual(['d1']);
  });

  test('a verified domain is not', () => {
    expect(domainsToRecheck([row({ verified_at: hoursAgo(1) })], NOW)).toEqual([]);
  });

  test('past 72 h it is left to «Comprobar»', () => {
    expect(domainsToRecheck([row({ created_at: hoursAgo(72) })], NOW)).toEqual([]);
    expect(domainsToRecheck([row({ created_at: hoursAgo(71.9) })], NOW)).toHaveLength(1);
  });

  test('a failed identity and the simulator are left alone', () => {
    expect(domainsToRecheck([row({ dkim_status: 'FAILED' })], NOW)).toEqual([]);
    expect(domainsToRecheck([row({ provider: 'simulator' })], NOW)).toEqual([]);
  });
});

function deps(over: Partial<RecheckDeps> = {}): RecheckDeps {
  return {
    pending: async () => [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })],
    check: async () => OK,
    record: async () => {},
    now: () => NOW,
    ...over,
  };
}

describe('recheckDomains', () => {
  test('one domain failing does not stop the others', async () => {
    const record = vi.fn(async () => {});
    const result = await recheckDomains(
      deps({
        check: async (r) => {
          if (r.id === 'b') throw new Error('ses down');
          return OK;
        },
        record,
      }),
    );
    expect(result.checked).toBe(2);
    expect(result.verified).toBe(2);
    expect(result.errors).toEqual([{ id: 'b', error: 'ses down' }]);
    expect(record.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['a', 'c']);
  });
});

describe('runDomainRecheck', () => {
  const env = { SUPABASE_SERVICE_ROLE_KEY: 'k', PUBLIC_SUPABASE_URL: 'https://x', PUBLIC_SUPABASE_ANON_KEY: 'a' } as MailoutEnv;

  test('without the service key it does nothing', async () => {
    const pending = vi.fn(async () => []);
    expect(await runDomainRecheck({ ...env, SUPABASE_SERVICE_ROLE_KEY: undefined }, deps({ pending }))).toBeNull();
    expect(pending).not.toHaveBeenCalled();
  });

  test('a database without the RPC yet is a quiet no-op', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await runDomainRecheck(
      env,
      deps({
        pending: async () => {
          throw new MailoutDbError(404, '{"code":"PGRST202"}');
        },
      }),
    );
    expect(result).toBeNull();
    log.mockRestore();
  });
});
