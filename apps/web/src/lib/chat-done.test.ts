import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const toast = vi.fn();
vi.mock('$lib/api', () => ({ mutateJSON: (...args: unknown[]) => post(...args) }));
vi.mock('$lib/components/Toast.svelte', () => ({ addToast: (...args: unknown[]) => toast(...args) }));

const { commitDone, done, flushDone, holdDone, revertDone, settleDone } = await import('./chat-done.svelte');

const settled = { done: ['c1'], failed: [], undo: [{ id: 'c1', columns: { reply_settled_at: null } }] };

beforeEach(() => {
  post.mockReset();
  toast.mockReset();
  holdDone();
  done.pending = null;
  done.busy = null;
});

describe('«Ya está» (ADR-177)', () => {
  it('un toque marca y deja pendiente el cómo; la nota lleva el cómo', async () => {
    const refresh = vi.fn();
    post.mockResolvedValueOnce(settled).mockResolvedValueOnce({});
    await settleDone('c1', 'Teatre de la Llum', 'es', refresh);
    expect(post).toHaveBeenCalledWith('POST', '/api/conversations/bulk', { action: 'settle', ids: ['c1'] });
    expect(done.pending?.id).toBe('c1');
    done.pending!.how = 'por teléfono';
    await commitDone();
    expect(post).toHaveBeenLastCalledWith('POST', '/api/conversations/c1/events', { kind: 'note', body: 'Ya está: por teléfono' });
    expect(done.pending).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('deshacer que la base rechaza no dice «deshecho»', async () => {
    post.mockResolvedValueOnce(settled).mockResolvedValueOnce({ done: [], failed: [{ id: 'c1', reason: 'error' }], undo: [] });
    await settleDone('c1', 'X', 'es', vi.fn());
    await revertDone();
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'danger' }));
    // Deshacer nunca escribe la nota; si falla, lo pendiente se queda y su nota saldrá.
    expect(post).not.toHaveBeenCalledWith('POST', '/api/conversations/c1/events', expect.anything());
    expect(done.pending?.id).toBe('c1');
    expect(done.busy).toBeNull();
  });

  it('dos toques seguidos: el segundo espera y la nota del primero sale', async () => {
    let release!: (v: unknown) => void;
    post
      .mockResolvedValueOnce(settled)
      .mockImplementationOnce(() => new Promise((r) => (release = r)))
      .mockResolvedValueOnce({ ...settled, done: ['c2'] });
    await settleDone('c1', 'A', 'es', vi.fn());
    const second = settleDone('c2', 'B', 'es', vi.fn());
    // A third tap while the first note is in flight does nothing.
    await settleDone('c3', 'C', 'es', vi.fn());
    release({});
    await second;
    expect(post.mock.calls.map((c) => c[1])).toEqual(['/api/conversations/bulk', '/api/conversations/c1/events', '/api/conversations/bulk']);
    expect(done.pending?.id).toBe('c2');
  });

  it('al cerrar la pestaña, la nota sale con keepalive', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    post.mockResolvedValueOnce(settled);
    await settleDone('c1', 'A', 'es', vi.fn());
    flushDone();
    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/c1/events', expect.objectContaining({ keepalive: true, method: 'POST' }));
    expect(done.pending).toBeNull();
    vi.unstubAllGlobals();
  });

  it('una nota que no se guarda avisa', async () => {
    post.mockResolvedValueOnce(settled).mockRejectedValueOnce(new Error('500'));
    await settleDone('c1', 'X', 'es', vi.fn());
    await commitDone();
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'warning', message: 'X: marcada, pero la nota del hilo no se ha guardado' }));
  });

  it('otro «ya está» escribe antes la nota del anterior', async () => {
    post.mockResolvedValueOnce(settled).mockResolvedValueOnce({}).mockResolvedValueOnce({ ...settled, done: ['c2'] });
    await settleDone('c1', 'A', 'es', vi.fn());
    await settleDone('c2', 'B', 'es', vi.fn());
    expect(post.mock.calls[1]).toEqual(['POST', '/api/conversations/c1/events', { kind: 'note', body: 'Ya está' }]);
    expect(done.pending?.id).toBe('c2');
  });
});
