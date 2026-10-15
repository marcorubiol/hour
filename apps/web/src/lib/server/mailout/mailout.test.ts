import { describe, expect, test, vi } from 'vitest';
import { buildDomainRecords, simulatedDkimTokens, SUGGESTED_DMARC } from './records';
import { simulatorProvider, SIMULATOR_REGION } from './simulator';
import { sesProvider } from './ses';
import { defaultProviderKind, mailoutMissing, recordDomainStatus, sendingProvider } from './index';
import { MailoutNotConfiguredError } from './provider';
import { domainState, MailDomainCreateSchema, normalizeDomain } from '$lib/mailout';
import * as v from 'valibot';

const identity = {
  domain: 'mamemi.example',
  mailFromSubdomain: 'bounce',
  tenantName: 'hour-ws',
  configurationSet: 'hour-ws',
};

describe('buildDomainRecords', () => {
  test('3 CNAME de DKIM, MX y SPF del MAIL FROM, y DMARC sugerido', () => {
    const records = buildDomainRecords({
      domain: 'MaMeMi.example',
      mailFromSubdomain: 'bounce',
      region: 'eu-central-1',
      dkimTokens: ['aaa', 'bbb', 'ccc'],
    });
    expect(records).toEqual([
      { type: 'CNAME', name: 'aaa._domainkey.mamemi.example', value: 'aaa.dkim.amazonses.com', purpose: 'dkim' },
      { type: 'CNAME', name: 'bbb._domainkey.mamemi.example', value: 'bbb.dkim.amazonses.com', purpose: 'dkim' },
      { type: 'CNAME', name: 'ccc._domainkey.mamemi.example', value: 'ccc.dkim.amazonses.com', purpose: 'dkim' },
      {
        type: 'MX',
        name: 'bounce.mamemi.example',
        value: 'feedback-smtp.eu-central-1.amazonses.com',
        priority: 10,
        purpose: 'mail_from',
      },
      { type: 'TXT', name: 'bounce.mamemi.example', value: '"v=spf1 include:amazonses.com ~all"', purpose: 'mail_from' },
      { type: 'TXT', name: '_dmarc.mamemi.example', value: SUGGESTED_DMARC, purpose: 'dmarc', suggested: true },
    ]);
  });

  test('con DMARC publicado no sugiere otro, y no toca el SPF del dominio raíz', () => {
    const records = buildDomainRecords({
      domain: 'mamemi.example',
      mailFromSubdomain: 'bounce',
      region: 'eu-west-1',
      dkimTokens: ['a', 'b', 'c'],
      dmarcRecord: 'v=DMARC1; p=quarantine;',
    });
    expect(records.some((r) => r.purpose === 'dmarc')).toBe(false);
    expect(records.filter((r) => r.type === 'TXT').map((r) => r.name)).toEqual(['bounce.mamemi.example']);
  });
});

describe('simulatedDkimTokens', () => {
  test('tres tokens de 32 caracteres en base 32, deterministas y distintos por dominio', async () => {
    const a = await simulatedDkimTokens('mamemi.example');
    expect(a).toHaveLength(3);
    for (const t of a) expect(t).toMatch(/^[a-z2-7]{32}$/);
    expect(new Set(a).size).toBe(3);
    expect(await simulatedDkimTokens('MAMEMI.example')).toEqual(a);
    expect(await simulatedDkimTokens('otra.example')).not.toEqual(a);
  });
});

describe('simulatorProvider', () => {
  test('el alta deja DKIM y MAIL FROM pendientes, con los registros que pediría SES', async () => {
    const s = await simulatorProvider().registerDomain(identity);
    expect(s).toMatchObject({ dkimStatus: 'PENDING', mailFromStatus: 'PENDING', dmarcRecord: null, error: null });
    expect(s.records.map((r) => r.type)).toEqual(['CNAME', 'CNAME', 'CNAME', 'MX', 'TXT', 'TXT']);
    expect(s.records[3].value).toBe(`feedback-smtp.${SIMULATOR_REGION}.amazonses.com`);
  });

  test('comprobar lo da por verificado, con los mismos registros', async () => {
    const p = simulatorProvider();
    const before = await p.registerDomain(identity);
    const after = await p.checkDomain(identity);
    expect(after).toMatchObject({ dkimStatus: 'SUCCESS', mailFromStatus: 'SUCCESS' });
    expect(after.records).toEqual(before.records);
    expect(domainState({ verified_at: 'x', dkim_status: 'SUCCESS', mail_from_status: 'SUCCESS' })).toBe('verified');
  });

  test('no llama a la red', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await simulatorProvider().checkDomain(identity);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('sesProvider', () => {
  test('sin configuración falla claro, nombrando lo que falta', () => {
    expect(() => sesProvider({})).toThrow(MailoutNotConfiguredError);
    try {
      sesProvider({ SES_REGION: 'eu-central-1' });
    } catch (err) {
      expect((err as MailoutNotConfiguredError).missing).toEqual(['SES_ACCESS_KEY_ID', 'SES_SECRET_ACCESS_KEY']);
    }
  });

  test('configurado, todavía no está escrito: falla al usarlo, no envía nada', async () => {
    const p = sesProvider({ SES_ACCESS_KEY_ID: 'x', SES_SECRET_ACCESS_KEY: 'y', SES_REGION: 'eu-central-1' });
    expect(p.kind).toBe('ses');
    await expect(p.registerDomain(identity)).rejects.toThrow(/not written yet/);
  });
});

describe('elegir adaptador', () => {
  test('el simulador por defecto; ses solo si se pide', () => {
    expect(defaultProviderKind({})).toBe('simulator');
    expect(defaultProviderKind({ MAILOUT_PROVIDER: 'otro' })).toBe('simulator');
    expect(defaultProviderKind({ MAILOUT_PROVIDER: 'ses' })).toBe('ses');
    expect(sendingProvider('simulator', {}).kind).toBe('simulator');
  });

  test('el simulador solo necesita la clave de servicio; ses, además, las suyas', () => {
    expect(mailoutMissing('simulator', { SUPABASE_SERVICE_ROLE_KEY: 'k' })).toEqual([]);
    expect(mailoutMissing('simulator', {})).toEqual(['SUPABASE_SERVICE_ROLE_KEY']);
    expect(mailoutMissing('ses', { SUPABASE_SERVICE_ROLE_KEY: 'k' })).toEqual([
      'SES_ACCESS_KEY_ID',
      'SES_SECRET_ACCESS_KEY',
      'SES_REGION',
    ]);
  });
});

describe('recordDomainStatus', () => {
  test('llama solo a mail_domain_record_status, como service_role', async () => {
    const fetchFn = vi.fn(async () => new Response('[]', { status: 200 }));
    const s = await simulatorProvider().checkDomain(identity);
    await recordDomainStatus(
      { PUBLIC_SUPABASE_URL: 'https://db.example', PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' },
      'dom-1',
      s,
      fetchFn as unknown as typeof fetch,
    );
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://db.example/rest/v1/rpc/mail_domain_record_status');
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe('sb_secret_x');
    expect(headers.authorization).toBeUndefined();
    expect(JSON.parse(String(init.body))).toMatchObject({
      p_id: 'dom-1',
      p_dkim_status: 'SUCCESS',
      p_mail_from_status: 'SUCCESS',
    });
  });

  test('sin clave de servicio, no configurado', async () => {
    const s = await simulatorProvider().checkDomain(identity);
    await expect(recordDomainStatus({ PUBLIC_SUPABASE_URL: 'https://db.example' }, 'x', s)).rejects.toThrow(
      MailoutNotConfiguredError,
    );
  });
});

describe('el formulario del dominio', () => {
  test('normaliza lo que se pega y pone difusion por defecto', () => {
    expect(normalizeDomain('  https://www.MaMeMi.cat/contacto ')).toBe('mamemi.cat');
    const ok = v.safeParse(MailDomainCreateSchema, {
      workspace_id: '0190a0a0-0000-7000-8000-000000000000',
      domain: 'https://MaMeMi.cat/',
    });
    expect(ok.success && ok.output).toMatchObject({ domain: 'mamemi.cat', from_local_part: 'difusion' });
    for (const domain of ['mamemi', 'mamemi .cat', 'gmail@mamemi.cat']) {
      expect(
        v.safeParse(MailDomainCreateSchema, { workspace_id: '0190a0a0-0000-7000-8000-000000000000', domain }).success,
        domain,
      ).toBe(false);
    }
    expect(
      v.safeParse(MailDomainCreateSchema, {
        workspace_id: '0190a0a0-0000-7000-8000-000000000000',
        domain: 'mamemi.cat',
        from_local_part: 'no vale',
      }).success,
    ).toBe(false);
  });
});
