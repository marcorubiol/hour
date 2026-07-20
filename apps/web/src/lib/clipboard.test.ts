import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('copyText', () => {
  it('uses the async Clipboard API when permission is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(copyText('scoped link')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('scoped link');
  });

  it('falls back to a temporary textarea when the Clipboard API is denied', async () => {
    const textarea = {
      value: '',
      setAttribute: vi.fn(),
      style: {} as CSSStyleDeclaration,
      select: vi.fn(),
      remove: vi.fn(),
    };
    const appendChild = vi.fn();
    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue(textarea),
      body: { appendChild },
      execCommand,
    });

    await expect(copyText('private link')).resolves.toBe(true);
    expect(textarea.value).toBe('private link');
    expect(appendChild).toHaveBeenCalledWith(textarea);
    expect(textarea.select).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(textarea.remove).toHaveBeenCalledOnce();
  });

  it('reports failure and still removes the temporary element', async () => {
    const textarea = {
      value: '',
      setAttribute: vi.fn(),
      style: {} as CSSStyleDeclaration,
      select: vi.fn(),
      remove: vi.fn(),
    };
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue(textarea),
      body: { appendChild: vi.fn() },
      execCommand: vi.fn(() => {
        throw new Error('blocked');
      }),
    });

    await expect(copyText('link')).resolves.toBe(false);
    expect(textarea.remove).toHaveBeenCalledOnce();
  });
});
