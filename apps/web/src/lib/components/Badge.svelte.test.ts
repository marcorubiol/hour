import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Badge from './Badge.svelte';

describe('Badge', () => {
  it('applies default tone + size when props omitted', () => {
    const { container } = render(Badge);
    const badge = container.querySelector('span')!;
    expect(badge).toBeInTheDocument();
    expect(badge.className).toBe('badge--neutral badge--s');
  });

  it('reflects tone variants in the class', () => {
    for (const tone of ['primary', 'info', 'success', 'warning', 'danger'] as const) {
      const { container } = render(Badge, { tone });
      const badge = container.querySelector('span')!;
      expect(badge.className).toContain(`badge--${tone}`);
    }
  });

  it('reflects size variants in the class', () => {
    const { container } = render(Badge, { size: 'xs' });
    expect(container.querySelector('span')!.className).toContain('badge--xs');
  });
});
