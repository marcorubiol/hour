import { afterEach, describe, expect, it, vi } from 'vitest';

const serviceRpc = vi.fn(async () => 3);
const runMailSync = vi.fn(async () => undefined);
const runDomainRecheck = vi.fn(async () => undefined);
const runMailoutQueue = vi.fn(async () => undefined);

vi.mock('./lib/server/mailout/db', () => ({ serviceRpc }));
vi.mock('./lib/server/mail/sync', () => ({ runMailSync }));
vi.mock('./lib/server/mailout/recheck', () => ({ runDomainRecheck }));
vi.mock('./lib/server/mailout/queue', () => ({ runMailoutQueue }));

const { scheduled, isAudiencePurgeWindow } = await import('./worker-cron');

const at = (hh: number, mm: number) => Date.UTC(2026, 10, 3, hh, mm, 0);

async function run(cron: string, scheduledTime: number, key = 'k') {
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
  await scheduled(
    { cron, scheduledTime } as ScheduledController,
    { SUPABASE_SERVICE_ROLE_KEY: key } as never,
    ctx as unknown as ExecutionContext,
  );
  await Promise.all(waits);
}

afterEach(() => vi.clearAllMocks());

describe('cron de 10 minutos', () => {
  it('la ventana es 03:10 a 03:19 UTC', () => {
    expect(isAudiencePurgeWindow(at(3, 10))).toBe(true);
    expect(isAudiencePurgeWindow(at(3, 19))).toBe(true);
    expect(isAudiencePurgeWindow(at(3, 0))).toBe(false);
    expect(isAudiencePurgeWindow(at(3, 20))).toBe(false);
    expect(isAudiencePurgeWindow(at(4, 10))).toBe(false);
    expect(isAudiencePurgeWindow(at(15, 10))).toBe(false);
  });

  it('en la ventana purga, y sigue sincronizando y comprobando el DNS', async () => {
    await run('*/10 * * * *', at(3, 10));
    expect(serviceRpc).toHaveBeenCalledTimes(1);
    expect(serviceRpc).toHaveBeenCalledWith(expect.anything(), 'audience_purge_pending', {});
    expect(runMailSync).toHaveBeenCalledTimes(1);
    expect(runDomainRecheck).toHaveBeenCalledTimes(1);
  });

  it('fuera de la ventana no purga y hace lo de siempre', async () => {
    await run('*/10 * * * *', at(3, 20));
    await run('*/10 * * * *', at(14, 10));
    expect(serviceRpc).not.toHaveBeenCalled();
    expect(runMailSync).toHaveBeenCalledTimes(2);
    expect(runDomainRecheck).toHaveBeenCalledTimes(2);
  });

  it('sin clave de servicio no purga, pero sincroniza', async () => {
    await run('*/10 * * * *', at(3, 10), '');
    expect(serviceRpc).not.toHaveBeenCalled();
    expect(runMailSync).toHaveBeenCalledTimes(1);
  });

  it('el cron de cada minuto solo vacía la cola, aunque caiga en la ventana', async () => {
    await run('* * * * *', at(3, 10));
    expect(runMailoutQueue).toHaveBeenCalledTimes(1);
    expect(serviceRpc).not.toHaveBeenCalled();
    expect(runMailSync).not.toHaveBeenCalled();
  });
});
