import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import RecordHead from './RecordHead.svelte';
import EmptyLine from './EmptyLine.svelte';

describe('RecordHead', () => {
  const crumbs = [
    { label: 'mük cia', href: '/h/muk-cia/', accent: 'var(--accent-3)' },
    { label: 'Sirena', href: '/h/muk-cia/project/sirena/' },
    { label: 'Función' },
  ];

  it('wears the lens head: one h1 in the lens title, at the lens size', () => {
    const { container } = render(RecordHead, { crumbs, title: 'Teatre Municipal de Girona' });
    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0].className).toContain('lenshead__title');
    expect(h1s[0].textContent).toBe('Teatre Municipal de Girona');
    expect(container.querySelector('header')!.className).toContain('lenshead');
  });

  it('ends the address with the kind, unlinked and current; the ancestry links', () => {
    const { container } = render(RecordHead, { crumbs, title: 'Teatre Municipal de Girona' });
    const nav = container.querySelector('nav.record-head__crumbs')!;
    const links = nav.querySelectorAll('a');
    expect([...links].map((a) => a.getAttribute('href'))).toEqual(['/h/muk-cia/', '/h/muk-cia/project/sirena/']);
    const here = nav.querySelector('[aria-current="page"]')!;
    expect(here.textContent).toBe('Función');
    expect(nav.querySelectorAll('.record-head__dot')).toHaveLength(1);
  });

  it('draws no address, facts or band when given none', () => {
    const { container } = render(RecordHead, { crumbs: [], title: 'x' });
    expect(container.querySelector('nav')).toBeNull();
    expect(container.querySelector('.lenshead__sub')).toBeNull();
    expect(container.querySelector('.record-head__band')).toBeNull();
  });
});

describe('EmptyLine', () => {
  it('is one line: a paragraph with its sentence', () => {
    const { container } = render(EmptyLine, { text: 'Sin mensajes.' });
    const p = container.querySelector('p.empty-line')!;
    expect(p.textContent).toBe('Sin mensajes.');
    expect(p.querySelector('.empty-line__label')).toBeNull();
  });

  it('stands for a whole empty block with its label', () => {
    const { container } = render(EmptyLine, { text: 'todavía ningún correo', label: 'Buzones' });
    const label = container.querySelector('.empty-line__label')!;
    expect(label.textContent).toBe('Buzones');
    expect(label.className).toContain('eyebrow--sub');
  });

  it('says it is busy while it loads', () => {
    const { container } = render(EmptyLine, { text: 'Cargando…', busy: true });
    expect(container.querySelector('p')!.getAttribute('aria-busy')).toBe('true');
  });
});
